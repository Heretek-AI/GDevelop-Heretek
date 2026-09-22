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
}: {|
  subAgentRequest: AiRequest,
  editorFunctionCallResults: Array<EditorFunctionCallResult> | null,
|}): boolean => {
  if (subAgentRequest.status !== 'ready') return false;
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
  return true;
};

/**
 * The text written into the parent's `function_call_output`: the sub-agent's
 * last assistant message, prefixed with the role's display name.
 *
 * The message's text lives in a `content` entry whose type is `'output_text'`
 * for a message the server produced, and `'text'` for one the local BYOK path
 * parsed (`parseAssistantMessage` emits `'text'`); both are read, and the
 * message's own `text` field is the fallback, so a report is never lost to the
 * difference.
 */
export const buildSubAgentReport = (subAgentRequest: AiRequest): string => {
  const output = subAgentRequest.output || [];
  for (let i = output.length - 1; i >= 0; i--) {
    const message = output[i];
    if (message.type !== 'message' || message.role !== 'assistant') continue;
    const textContent = message.content.find(
      content => content.type === 'output_text' || content.type === 'text'
    );
    const textFromContent = textContent ? (textContent: any).text : null;
    if (typeof textFromContent === 'string' && textFromContent) {
      return textFromContent;
    }
    const messageText = (message: any).text;
    if (typeof messageText === 'string' && messageText) return messageText;
    return '(no report)';
  }
  return '(no report)';
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
