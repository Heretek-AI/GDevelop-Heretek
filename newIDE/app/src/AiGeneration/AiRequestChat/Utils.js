// @flow
import {
  type AiRequestMessageAssistantFunctionCall,
  type AiRequestAssistantMessage,
  type AiRequestFunctionCallOutput,
  type AiRequestMessage,
  type AiRequestUserMessage,
  type AiRequestPlanTask,
} from '../../Utils/GDevelopServices/Generation';
import { type EditorFunctionCallResult } from '../../EditorFunctions';
import {
  type Quota,
  type UsagePrice,
} from '../../Utils/GDevelopServices/Usage';

export type FunctionCallItem = {|
  key: string,
  messageContent: AiRequestMessageAssistantFunctionCall,
  existingFunctionCallOutput: AiRequestFunctionCallOutput | null | void,
  editorFunctionCallResult: EditorFunctionCallResult | null,
|};

export type UserMessageRenderItem = {|
  type: 'user_message',
  messageIndex: number,
  message: AiRequestUserMessage,
|};

export type MessageContentRenderItem = {|
  type: 'message_content',
  messageIndex: number,
  messageContentIndex: number,
  message: AiRequestAssistantMessage,
  messageContent: {|
    type: 'output_text' | 'reasoning',
    status: 'completed',
    text?: string,
    summary?: {
      text: string,
      type: 'summary_text',
    },
    annotations?: Array<{}>,
  |},
  isLastMessage: boolean,
  functionCallItems?: Array<FunctionCallItem>,
|};

export type FunctionCallGroupRenderItem = {|
  type: 'function_call_group',
  items: Array<FunctionCallItem>,
|};

export type SaveRenderItem = {|
  type: 'save',
  messageIndex: number,
  message: AiRequestMessage,
  isRestored: boolean,
  isSaving: boolean,
|};

export type SuggestionsRenderItem = {|
  type: 'suggestions',
  messageIndex: number,
  message: AiRequestAssistantMessage | AiRequestFunctionCallOutput,
  onlyShowExplanationMessage: boolean,
  functionCallItems?: Array<FunctionCallItem>,
|};

export type OrchestratorPlanRenderItem = {|
  type: 'orchestrator_plan',
  plan: {| tasks: Array<AiRequestPlanTask> |},
  messageIndex: number,
  messageId: string,
|};

export type RenderItem =
  | UserMessageRenderItem
  | MessageContentRenderItem
  | FunctionCallGroupRenderItem
  | SaveRenderItem
  | SuggestionsRenderItem
  | OrchestratorPlanRenderItem;

/**
 * Whether the user can pay for one more AI request right now: either their AI
 * usage allowance is not exhausted, or they chose to pay with GDevelop credits
 * and have enough of them.
 *
 * Everything this reads comes from the user limits, so the answer follows the
 * user buying credits, subscribing or their allowance resetting. Anything gating
 * the chat on it must be derived from it (never latched), or the chat stays
 * blocked after the user unblocked themselves.
 */
export const canPayForAiRequest = ({
  quota,
  price,
  availableCredits,
  automaticallyUseCreditsForAiRequests,
}: {|
  quota: Quota | null,
  price: UsagePrice | null,
  availableCredits: number,
  automaticallyUseCreditsForAiRequests: boolean,
|}): boolean => {
  // The request is covered by the allowance included in the user's plan.
  if (!quota || !quota.limitReached) return true;
  // The allowance is exhausted and the user didn't accept to pay with credits.
  if (!automaticallyUseCreditsForAiRequests) return false;
  // The price is not known yet: let the user try rather than blocking them on a
  // missing price (the backend refuses the request if they can't pay for it).
  if (!price) return true;
  return availableCredits >= price.priceInCredits;
};

/**
 * Whether a send may proceed for this endpoint mode. Local/BYOK never depends
 * on GDevelop credits or hosted quotas — the send button already
 * short-circuits on `!isCustomEndpointEnabled() && !canPay`; create/continue
 * paths must use the same rule so an exhausted hosted quota cannot silently
 * drop a local request.
 *
 * Besides the endpoint toggle, a local session is identified by:
 * - `aiRequestId` starting with `local-ai-` (chats that live only in the
 *   local cache — still sendable after logout / endpoint toggle-off), or
 * - `userId` starting with `local-` (the offline BYOK session id used when
 *   there is no profile).
 */
export const canAffordAiRequest = ({
  isCustomEndpointEnabled,
  aiRequestId,
  userId,
  quota,
  price,
  availableCredits,
  automaticallyUseCreditsForAiRequests,
}: {|
  isCustomEndpointEnabled: boolean,
  aiRequestId?: ?string,
  userId?: ?string,
  quota: Quota | null,
  price: UsagePrice | null,
  availableCredits: number,
  automaticallyUseCreditsForAiRequests: boolean,
|}): boolean => {
  if (isCustomEndpointEnabled) return true;
  if (aiRequestId && aiRequestId.startsWith('local-ai-')) return true;
  if (userId && userId.startsWith('local-')) return true;
  return canPayForAiRequest({
    quota,
    price,
    availableCredits,
    automaticallyUseCreditsForAiRequests,
  });
};

/**
 * Whether the new-chat Stop control may cancel a create that has not produced
 * an AiRequest yet.
 *
 * Allowed while the custom endpoint is on (Stop can arm `createAbortRequested`
 * before the create registers), OR while a create is already in the pending
 * registry — so flipping the endpoint off mid-hung-create does not remove the
 * only way to abort an Ollama/VRAM first turn.
 */
export const canCancelPendingCreateAiRequest = ({
  isCustomEndpointEnabled,
  hasPendingCreate,
  isSending,
  hasAiRequest,
}: {|
  isCustomEndpointEnabled: boolean,
  hasPendingCreate: boolean,
  isSending: boolean,
  hasAiRequest: boolean,
|}): boolean =>
  (isCustomEndpointEnabled || hasPendingCreate) && isSending && !hasAiRequest;

/**
 * Whether the send control should show a "Send again" label after a failed
 * send (lastSendError set). Hidden while a request is working so Stop /
 * send-in-progress icons stay unchanged.
 */
export const shouldShowSendAgainLabel = ({
  hasSendError,
  isWorking,
}: {|
  hasSendError: boolean,
  isWorking: boolean,
|}): boolean => hasSendError && !isWorking;
