// @flow

import { type AiRequest } from '../../Utils/GDevelopServices/Generation';
import { type EditorFunctionCallResult } from '../../EditorFunctions';
import {
  getAllSubAgentFunctionCalls,
  getFunctionCallsToProcess,
  getPendingSubAgentFunctionCalls,
} from '../AiRequestUtils';
import { getStudioRole, type StudioRoleId } from './Roles';
import { isSpawnAgentCall, parseSpawnAgentArgs } from './SpawnSubAgents';

/**
 * The role a studio sub-agent was spawned with, read back from its parent's
 * `spawn_agent` call. Null for a hosted sub-agent (`run_edit_agent` /
 * `run_explorer_agent`) or when the launch call cannot be resolved.
 */
export const getSubAgentRoleId = ({
  aiRequest,
  aiRequests,
}: {|
  aiRequest: AiRequest,
  aiRequests: { [string]: AiRequest },
|}): StudioRoleId | null => {
  if (!aiRequest.parentAiRequestId) return null;
  const parentRequest = aiRequests[aiRequest.parentAiRequestId] || null;
  if (!parentRequest) return null;
  const launchingCall = getAllSubAgentFunctionCalls({
    aiRequest: parentRequest,
  }).find(functionCall => functionCall.subAgentAiRequestId === aiRequest.id);
  if (!launchingCall || !isSpawnAgentCall(launchingCall)) return null;
  const parsedArgs = parseSpawnAgentArgs(launchingCall);
  return parsedArgs ? parsedArgs.role : null;
};

/** How many model turns a sub-agent has taken: one assistant message each. */
export const countAssistantTurns = (aiRequest: AiRequest): number =>
  (aiRequest.output || []).filter(
    message => message.type === 'message' && message.role === 'assistant'
  ).length;

/**
 * True when a studio sub-agent has used up its role's turn budget.
 *
 * The dispatcher stops processing its remaining calls at that point and the
 * studio runtime finalizes it, so a runaway sub-agent cannot run forever.
 */
export const isSubAgentAtTurnCap = ({
  aiRequest,
  aiRequests,
}: {|
  aiRequest: AiRequest,
  aiRequests: { [string]: AiRequest },
|}): boolean => {
  const roleId = getSubAgentRoleId({ aiRequest, aiRequests });
  if (!roleId) return false;
  return countAssistantTurns(aiRequest) >= getStudioRole(roleId).maxTurns;
};

/**
 * A sub-agent is finished when it has nothing left to do locally: it is not
 * working, it has no unexecuted function calls, and it has no pending sub-agent
 * of its own.
 *
 * A hosted sub-agent (`run_edit_agent`) is polled until the server retires it;
 * this only decides when the *studio* may write its report back.
 */
export const isSubAgentFinished = ({
  subAgentRequest,
  editorFunctionCallResults,
  aiRequests,
}: {|
  subAgentRequest: AiRequest,
  editorFunctionCallResults: Array<EditorFunctionCallResult> | null,
  aiRequests?: { [string]: AiRequest } | null,
|}): boolean => {
  // A sub-agent at its turn cap is finalized with its last message even if it
  // still has calls left: the dispatcher has stopped issuing its turns.
  if (
    aiRequests &&
    isSubAgentAtTurnCap({ aiRequest: subAgentRequest, aiRequests })
  ) {
    return true;
  }
  // The loop guard's terminal state is 'error'; treat it as finished so the
  // studio writes its (failed) report back instead of waiting forever.
  if (
    subAgentRequest.status !== 'ready' &&
    subAgentRequest.status !== 'error'
  ) {
    return false;
  }
  if (
    getFunctionCallsToProcess({
      aiRequest: subAgentRequest,
      editorFunctionCallResults,
    }).length > 0
  ) {
    return false;
  }
  if (
    getPendingSubAgentFunctionCalls({ aiRequest: subAgentRequest }).length > 0
  ) {
    return false;
  }
  if (
    editorFunctionCallResults &&
    editorFunctionCallResults.some(result => result.status === 'working')
  ) {
    return false;
  }
  // A result that was executed but whose output has not landed in the child's
  // transcript yet: finalizing now would drop the child's real wrap-up forever.
  const writtenBackCallIds = new Set(
    (subAgentRequest.output || [])
      .filter(message => message.type === 'function_call_output')
      .map(message => (message: any).call_id)
  );
  if (
    editorFunctionCallResults &&
    editorFunctionCallResults.some(
      result => !writtenBackCallIds.has(result.call_id)
    )
  ) {
    return false;
  }
  return true;
};

/** Reports are capped so one runaway sub-agent cannot flood the parent. */
export const MAX_SUB_AGENT_REPORT_LENGTH = 4000;

/**
 * Cut a report to `maxLength` without splitting a surrogate pair.
 *
 * A plain `slice` can land between the halves of an astral character (an emoji
 * or rare CJK in a sub-agent's report — realistic for a game studio naming
 * scenes and objects), leaving a lone high surrogate that encodes to U+FFFD.
 * The result is written into the parent transcript and sent to the model, so
 * the replacement character would appear in place of the real text.
 */
export const truncateReport = (report: string, maxLength: number): string => {
  if (report.length <= maxLength) return report;
  let end = maxLength;
  const lastCode = report.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
  return report.slice(0, end) + '\n…(report truncated)';
};

/**
 * The text written into the parent's `function_call_output`: the sub-agent's
 * last assistant message, prefixed with any failure or turn-limit context and
 * suffixed with its failed calls, then truncated. The message's text is read
 * from a `content` entry (`'output_text'` from the server, `'text'` from the
 * local BYOK parser) with the message's own `text` field as fallback.
 */
export const buildSubAgentReport = (
  subAgentRequest: AiRequest,
  aiRequests?: { [string]: AiRequest } | null
): string => {
  const output = subAgentRequest.output || [];
  let report = '';

  if (subAgentRequest.error) {
    report += `Failed: ${subAgentRequest.error.message}\n\n`;
  }
  if (
    aiRequests &&
    isSubAgentAtTurnCap({ aiRequest: subAgentRequest, aiRequests })
  ) {
    report += 'Reached its turn limit.\n\n';
  }

  // The sub-agent's last assistant message is the core of the report. Its text
  // lives in a `content` entry whose type is `'output_text'` for a message the
  // server produced, and `'text'` for one the local BYOK path parsed; both are
  // read, and the message's own `text` field is the fallback.
  let core = '(no report)';
  for (let i = output.length - 1; i >= 0; i--) {
    const message = output[i];
    if (message.type !== 'message' || message.role !== 'assistant') continue;
    // A sub-agent message from the server may lack its content array; the
    // report falls back to the message's own `text` field below.
    const content = message.content;
    const textContent = Array.isArray(content)
      ? content.find(
          entry =>
            entry && (entry.type === 'output_text' || entry.type === 'text')
        )
      : null;
    const textFromContent = textContent ? (textContent: any).text : null;
    if (typeof textFromContent === 'string' && textFromContent) {
      core = textFromContent;
    } else {
      const messageText = (message: any).text;
      core =
        typeof messageText === 'string' && messageText
          ? messageText
          : '(no report)';
    }
    break;
  }
  report += core;

  // Surface failed tool calls so the parent sees what went wrong.
  const failedMessages = output
    .filter(
      message =>
        message.type === 'function_call_output' &&
        (message: any).success === false
    )
    .map(message => {
      const messageOutput = (message: any).output;
      return (messageOutput && messageOutput.message) || '(failed call)';
    });
  if (failedMessages.length > 0) {
    report += `\n\nFailed calls:\n- ${failedMessages.join('\n- ')}`;
  }

  if (report.length > MAX_SUB_AGENT_REPORT_LENGTH) {
    return truncateReport(report, MAX_SUB_AGENT_REPORT_LENGTH);
  }
  return report;
};

/**
 * The label shown for the sub-agent's report. Falls back to the generic name for
 * a hosted sub-agent, whose role this fork does not know.
 */
export const getSubAgentReportLabel = ({
  aiRequest,
  aiRequests,
}: {|
  aiRequest: AiRequest,
  aiRequests: { [string]: AiRequest },
|}): string => {
  const roleId = getSubAgentRoleId({ aiRequest, aiRequests });
  return roleId ? getStudioRole(roleId).displayName : 'Agent';
};
