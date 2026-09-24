// @flow
import { getAllSubAgentFunctionCalls } from '../AiRequestUtils';
import {
  type AiRequest,
  type AiRequestMessageAssistantFunctionCall,
} from '../../Utils/GDevelopServices/Generation';

/**
 * The `spawn_agent` call that launched a sub-agent, read back from its
 * parent's output — or null when it cannot be resolved (a top-level request,
 * a missing parent, pruned history, or a persisted null hole).
 *
 * The edit-approval prompt names the agent after this call (its short title,
 * the same name shown in the chat); a null falls back to the tool labels of
 * the batch itself. Lives here rather than inline in the dispatcher so a
 * spec can pin the resolution: Utils.js pulls in three.js through the
 * editor-function map and cannot be loaded by a test.
 */
export const getEditApprovalLaunchingCall = ({
  aiRequest,
  aiRequests,
}: {|
  aiRequest: AiRequest,
  aiRequests: { [string]: AiRequest },
|}): AiRequestMessageAssistantFunctionCall | null => {
  if (!aiRequest.parentAiRequestId) return null;
  const parentRequest = aiRequests[aiRequest.parentAiRequestId] || null;
  if (!parentRequest) return null;
  return (
    getAllSubAgentFunctionCalls({ aiRequest: parentRequest }).find(
      functionCall => functionCall.subAgentAiRequestId === aiRequest.id
    ) || null
  );
};
