// @flow
import {
  type AiRequest,
  type AiRequestMessage,
  type AiRequestMessageAssistantFunctionCall,
  type AiRequestFunctionCallOutput,
  type AiRequestPlan,
  type AiRequestSummary,
  type AiRequestUserMessage,
} from '../Utils/GDevelopServices/Generation';
import { type EditorFunctionCallResult } from '../EditorFunctions';
import { type RelatedAiRequestLastMessages } from '../EditorFunctions';

/** The text typed by the user in one of their messages. */
export const getUserRequestText = (message: AiRequestUserMessage): string => {
  // `content` comes from the server unvalidated (a hosted summary carries the
  // raw first message). A payload missing it, or holding a non-array, would
  // throw here and take the chat list down with it, so tolerate both.
  const content = message && message.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(item => item && item.type === 'user_request' && item.text)
    .map(item => item.text)
    .join(' ');
};

/**
 * The name of a chat: the title the user gave to it, or its first message
 * otherwise. Empty when the chat has neither.
 */
export const getAiRequestSummaryTitle = (
  aiRequestSummary: AiRequestSummary
): string =>
  aiRequestSummary.title ||
  (aiRequestSummary.firstUserMessage
    ? getUserRequestText(aiRequestSummary.firstUserMessage)
    : '');

/**
 * Maximum number of times a failed AI request can be continued without making
 * any progress in between - kept in sync with the API, which is what really
 * enforces it.
 */
export const MAX_AI_REQUEST_RETRIES_IN_A_ROW = 3;

/**
 * Whether the API would still accept to continue this failed request, so that
 * a retry is only offered when it can work. Like the API, the retries only
 * count while nothing was written to the conversation in between.
 */
export const canRetryAiRequest = (aiRequest: AiRequest): boolean =>
  aiRequest.status === 'error' &&
  !(
    aiRequest.retriedAfterMessagesCount === (aiRequest.output || []).length &&
    (aiRequest.retriesInARowCount || 0) >= MAX_AI_REQUEST_RETRIES_IN_A_ROW
  );

/**
 * Whether this session may offer the error row's Retry for one request id.
 * Mirrors canSendAiRequestForSession: any profile, or a local-ai-* id that
 * lives only in the local cache (no hosted API / auth needed). Non-local ids
 * without a profile are refused — hosted /action/retry requires a userId.
 */
export const canRetryAiRequestForSession = (
  profile: ?{ id: string },
  aiRequestId: string
): boolean => !!profile || aiRequestId.startsWith('local-ai-');

/**
 * Whether this session may send message feedback for one request id.
 * Mirrors canRetryAiRequestForSession: any profile, or a local-ai-* id that
 * lives only in the local cache (the Generation layer short-circuits those
 * before any hosted call). Hosted non-local ids without a profile are refused.
 */
export const canSendFeedbackForSession = (
  profile: ?{ id: string },
  aiRequestId: string
): boolean => !!profile || aiRequestId.startsWith('local-ai-');

/**
 * Whether a createAiRequest return value is a first-turn failure or cancel
 * that must not be treated as a successful start (local BYOK returns
 * status:'error' on failure and status:'suspended' when the user aborts a hung
 * create, instead of throwing).
 */
export const isFailedAiRequestStart = (aiRequest: {
  status: string,
  ...
}): boolean => aiRequest.status === 'error' || aiRequest.status === 'suspended';

/**
 * Standalone create outcome: failed or cancelled first-turn starts stay on the
 * error row (project left open so an offline failure or Stop does not discard
 * the user's work); only successful starts hand off to the Ask AI tab / close
 * the project.
 */
export const getStandaloneCreateOutcome = (aiRequest: {
  status: string,
  ...
}): 'error-row' | 'handoff' =>
  isFailedAiRequestStart(aiRequest) ? 'error-row' : 'handoff';

/**
 * Whether a send/continue of an AI request may proceed for this session:
 * any logged-in profile, or a local/BYOK session with a custom endpoint
 * enabled (the hosted API is never involved for those). Hosted non-local
 * requests without a profile are refused.
 *
 * Shared by the editor container and the stand-alone form so the two cannot
 * drift — the stand-alone form used to require a profile for function-call
 * outputs even when a custom endpoint was enabled, which silently broke the
 * agent loop for offline BYOK sessions.
 *
 * A local-ai-* id is also allowed without a profile or custom endpoint: those
 * chats live only in the local cache (cycle 64 lists them after logout /
 * toggle-off, and Generation addMessage short-circuits them before any
 * hosted call).
 */
export const canSendAiRequestForSession = (
  profile: ?{ id: string },
  customEndpointEnabled: boolean,
  aiRequestId: ?string
): boolean =>
  !!profile ||
  customEndpointEnabled ||
  (!!aiRequestId && aiRequestId.startsWith('local-ai-'));

/**
 * Whether the AI editor tools (event generation, asset search, resource
 * search) may run for this session.
 *
 * Always allowed: a profile uses the hosted APIs when the custom endpoint is
 * off (or the local client when it is on). Without a profile the hooks set
 * activeUserId to LOCAL_BYOK_USER_ID ('local-byok-user'), which Generation
 * and prepareAiUserContent dual-gate onto the offline client before any
 * authorized call — so a missing profile must not throw.
 *
 * The old `!profile && !customEndpointEnabled` throw blocked agent
 * function-calls for local-ai-* chats after logout / endpoint toggle-off
 * (cycles 64–66 list, send, and watch those chats offline).
 */
export const canUseEditorAiTools = (
  profile: ?{ id: string },
  customEndpointEnabled: boolean
): boolean => {
  if (profile) return true;
  // Logged-out: LOCAL_BYOK_USER_ID starts with 'local-', so every Generation
  // dual-gate accepts it regardless of the endpoint toggle. Accept the flag
  // for call-site symmetry with canSendAiRequestForSession but do not require it.
  return customEndpointEnabled || !profile;
};

/**
 * Whether a new AI request may be created for this session (the stand-alone
 * form and the editor container's create effect).
 *
 * Always allowed: a profile uses the hosted API when the custom endpoint is
 * off (or the local client when it is on). Without a profile the forms set
 * activeUserId to LOCAL_BYOK_USER_ID ('local-byok-user'), which Generation
 * and prepareAiUserContent dual-gate onto the offline client — so create
 * must not open the account dialog first.
 *
 * The old `!profile && !customEndpointEnabled` account-dialog gate blocked
 * new local chats after logout / endpoint toggle-off even though cycles 64–66
 * already list, send, and watch those sessions offline.
 */
export const canStartAiRequestCreate = (
  profile: ?{ id: string },
  customEndpointEnabled: boolean
): boolean => {
  if (profile) return true;
  // Logged-out create uses LOCAL_BYOK_USER_ID → Generation local path.
  return customEndpointEnabled || !profile;
};

/**
 * Whether the editor container's mount-time "tab open" full fetch should run
 * for the currently selected chat. Mirrors AiRequestContext.loadAiRequest:
 * a profile always can; without one, local-ai-* ids (cache-only) and any id
 * while a custom endpoint is enabled may fetch. Hosted non-local ids without
 * a profile and without a custom endpoint are refused (the hosted API would
 * 401).
 */
export const shouldFetchAiRequestOnTabOpen = (options: {|
  selectedAiRequest: ?{ id: string },
  profile: ?{ id: string },
  customEndpointEnabled: boolean,
|}): boolean => {
  const { selectedAiRequest, profile, customEndpointEnabled } = options;
  if (!selectedAiRequest) return false;
  if (profile) return true;
  if (selectedAiRequest.id.startsWith('local-ai-')) return true;
  return customEndpointEnabled;
};

/**
 * Whether the suggestions side-fetch should run for this session and request
 * state: an agent/orchestrator request that is ready with a project loaded,
 * not mid-send, and allowed for this session (profile or custom endpoint).
 *
 * Offline BYOK without a profile used to be refused by a bare `!profile`
 * guard in Utils, so local chats never received next-step suggestions even
 * though the local client can generate them without the hosted API.
 */
export const shouldFetchAiRequestSuggestions = (options: {|
  selectedAiRequest: ?AiRequest,
  isSending: boolean,
  isFetchingSuggestions: boolean,
  profile: ?{ id: string },
  customEndpointEnabled: boolean,
  hasProject: boolean,
|}): boolean => {
  const {
    selectedAiRequest,
    isSending,
    isFetchingSuggestions,
    profile,
    customEndpointEnabled,
    hasProject,
  } = options;
  if (!selectedAiRequest) return false;
  if (
    selectedAiRequest.mode !== 'agent' &&
    selectedAiRequest.mode !== 'orchestrator'
  ) {
    return false;
  }
  if (isSending) return false;
  if (!selectedAiRequest.output || selectedAiRequest.output.length === 0) {
    return false;
  }
  if (selectedAiRequest.status !== 'ready') return false;
  if (
    !canSendAiRequestForSession(
      profile,
      customEndpointEnabled,
      selectedAiRequest.id
    )
  ) {
    return false;
  }
  if (isFetchingSuggestions) return false;
  if (!hasProject) return false;
  return true;
};

/**
 * The share of the model's context window the opened chat has used, 0 to 1
 * (it can exceed 1), or null when it is not known.
 *
 * The hosted path reports this on `aiRequest.contextStats`. The local BYOK
 * path never sets that field — it accounts token counts itself — so without
 * this the usage indicator stayed empty in exactly the mode where small local
 * context windows make the number most useful.
 *
 * `totalTokens` is the chat's cumulative token count and `budgetTokens` the
 * per-request input budget; both come from the caller so this stays pure.
 */
export const getLocalAiRequestContextUsedRatio = (
  totalTokens: number,
  budgetTokens: number
): ?number => {
  const usable = (value: number): boolean =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (!usable(totalTokens) || !usable(budgetTokens)) return null;
  return totalTokens / budgetTokens;
};
/**
 * Whether a persisted output entry is a user chat message. Output entries are
 * not shape-validated on load, so every `.filter(message => ...)` over them
 * must tolerate a null hole — and this predicate lives here (not inline in
 * the dispatcher) so a spec can pin it: Utils.js pulls in three.js through
 * the editor-function map and cannot be loaded by a test.
 */
/**
 * How many sub-agents a request spawned and how many are finished (their call
 * has a `function_call_output`). The chat shows this as a small audit line so
 * the multi-agent activity is visible without opening each sub-agent. Derived
 * purely from the request output, so it is also usable as the data layer for a
 * per-agent dashboard.
 */
export const summarizeSubAgentActivity = (aiRequest: {
  output?: Array<any>,
}): { total: number, done: number, running: number } => {
  const calls = getAllSubAgentFunctionCalls({ aiRequest: (aiRequest: any) });
  // A spawn call is counted once per call_id: a transcript that repeats the
  // same function_call (e.g. after a fork/merge) must not inflate the count.
  const uniqueCallIds = new Set();
  for (const call of calls) {
    if (typeof call.call_id === 'string') uniqueCallIds.add(call.call_id);
  }
  const answeredCallIds = new Set();
  for (const message of aiRequest.output || []) {
    if (
      message &&
      message.type === 'function_call_output' &&
      typeof message.call_id === 'string'
    ) {
      answeredCallIds.add(message.call_id);
    }
  }
  let done = 0;
  uniqueCallIds.forEach(callId => {
    if (answeredCallIds.has(callId)) done++;
  });
  const total = uniqueCallIds.size;
  return { total, done, running: total - done };
};

export const isUserMessage = (message: any): boolean =>
  !!message && message.type === 'message' && message.role === 'user';

export const getFunctionCallToFunctionCallOutputMap = ({
  aiRequest,
}: {|
  aiRequest: AiRequest,
|}): Map<
  AiRequestMessageAssistantFunctionCall,
  AiRequestFunctionCallOutput | null
> => {
  // Maps each function call to its corresponding output (or null if no output)
  const functionCallsToOutputs = new Map<
    AiRequestMessageAssistantFunctionCall,
    AiRequestFunctionCallOutput | null
  >();

  // Track function calls by their call_id to match with outputs
  const functionCallsByCallId = new Map<
    string,
    AiRequestMessageAssistantFunctionCall
  >();

  // Process messages in a single loop
  const output = aiRequest.output || [];
  for (let i = 0; i < output.length; i++) {
    const message = output[i];
    // Persisted output is only checked for id/status on load and
    // normalizePersistedMessages passes non-message entries through, so a
    // null hole reaches this loop and its first read threw.
    if (!message || typeof message !== 'object') continue;

    if (message.type === 'message' && message.role === 'assistant') {
      // Process function calls in this message. `content` is network-supplied
      // and only type-asserted, and this runs on every chat render (the map
      // feeds ChatMessages), so a payload without an array would crash the
      // chat view itself rather than one field of it.
      if (!Array.isArray(message.content)) continue;
      message.content.forEach(content => {
        if (!content || typeof content !== 'object') return;
        if (content.type === 'function_call') {
          // Initialize with null output - will be updated if we find a matching output
          functionCallsToOutputs.set(content, null);

          // Store function call by call_id for later matching
          functionCallsByCallId.set(content.call_id, content);
        }
      });
    } else if (message.type === 'function_call_output') {
      // Find the corresponding function calls with this call_id
      const functionCall = functionCallsByCallId.get(message.call_id);
      functionCallsByCallId.delete(message.call_id);

      // Match with the most recent function call with this call_id
      if (functionCall) {
        functionCallsToOutputs.set(functionCall, message);
      }
    }
  }

  return functionCallsToOutputs;
};

export const getFunctionCallsToProcess = ({
  aiRequest,
  editorFunctionCallResults,
}: {|
  aiRequest: AiRequest,
  editorFunctionCallResults: Array<EditorFunctionCallResult> | null,
|}): Array<AiRequestMessageAssistantFunctionCall> => {
  const functionCallsToProcess: AiRequestMessageAssistantFunctionCall[] = [];
  const appliedFunctionCallIds = new Set<string>();
  const alreadyProcessedFunctionCallIds = new Set<string>();

  // Track already applied function calls
  (editorFunctionCallResults || []).forEach(functionCallOutput => {
    appliedFunctionCallIds.add(functionCallOutput.call_id);
  });

  // Process from the end and collect function calls until we hit a message with no function calls
  let foundFunctionCall = false;

  const output = aiRequest.output || [];
  for (let i = output.length - 1; i >= 0; i--) {
    const message = output[i];
    if (!message || typeof message !== 'object') continue;

    // Track already processed function call outputs
    if (message.type === 'function_call_output') {
      alreadyProcessedFunctionCallIds.add(message.call_id);
    }

    // Collect function calls that need processing
    if (message.type === 'message' && message.role === 'assistant') {
      // Network-supplied and only type-asserted: a missing array would crash
      // the caller that builds the function-call list for the chat.
      if (!Array.isArray(message.content)) continue;
      const functionCalls = message.content.filter(
        content =>
          content &&
          typeof content === 'object' &&
          content.type === 'function_call'
      );

      if (functionCalls.length > 0) {
        foundFunctionCall = true;

        // Add new unique function calls that haven't been processed or applied
        for (let j = functionCalls.length - 1; j >= 0; j--) {
          const functionCall = functionCalls[j];
          if (functionCall.type !== 'function_call') continue;

          // A function call which launched a sub-agent AI request is not processed by the editor.
          if (functionCall.subAgentAiRequestId) continue;

          if (
            !alreadyProcessedFunctionCallIds.has(functionCall.call_id) &&
            !appliedFunctionCallIds.has(functionCall.call_id)
          ) {
            functionCallsToProcess.unshift(functionCall); // Add to beginning to preserve original order
          }
        }
      } else if (foundFunctionCall) {
        // If we've found function calls and now hit a message with no function calls, stop
        break;
      }
    }
  }

  return functionCallsToProcess;
};

/**
 * Returns all sub-agent function calls (those with a subAgentAiRequestId) in
 * the AI request output, regardless of whether their sub-agent has completed.
 */
export const getAllSubAgentFunctionCalls = ({
  aiRequest,
}: {|
  aiRequest: AiRequest,
|}): Array<AiRequestMessageAssistantFunctionCall> => {
  const subAgentCalls: AiRequestMessageAssistantFunctionCall[] = [];

  const output = aiRequest.output || [];
  for (let i = 0; i < output.length; i++) {
    const message = output[i];
    if (!message || typeof message !== 'object') continue;
    if (message.type === 'message' && message.role === 'assistant') {
      if (!Array.isArray(message.content)) continue;
      for (const content of message.content) {
        if (!content || typeof content !== 'object') continue;
        if (content.type === 'function_call' && content.subAgentAiRequestId) {
          subAgentCalls.push(content);
        }
      }
    }
  }

  return subAgentCalls;
};

/**
 * Determine which kind of sub-agent an AI request is, by looking at the call
 * that launched it in its parent request (`run_edit_agent` vs
 * `run_explorer_agent`). Returns null for a top-level request (no parent) or
 * when the parent/launching call cannot be resolved.
 *
 * Used to gate script behavior by mode: an explorer sub-agent's `run_script`
 * is read-only, so it is neither exposed mutating functions nor gated behind
 * the edit approval.
 */
export const getSubAgentKind = ({
  aiRequest,
  aiRequests,
}: {|
  aiRequest: AiRequest,
  aiRequests: { [string]: AiRequest },
|}): 'edit' | 'explorer' | null => {
  if (!aiRequest.parentAiRequestId) return null;
  const parentRequest = aiRequests[aiRequest.parentAiRequestId] || null;
  if (!parentRequest) return null;
  const launchingCall = getAllSubAgentFunctionCalls({
    aiRequest: parentRequest,
  }).find(functionCall => functionCall.subAgentAiRequestId === aiRequest.id);
  if (!launchingCall) return null;
  if (launchingCall.name === 'run_explorer_agent') return 'explorer';
  if (launchingCall.name === 'run_edit_agent') return 'edit';
  return null;
};

/**
 * Returns sub-agent function calls (those with a subAgentAiRequestId)
 * that don't yet have a corresponding function_call_output in the AI request output.
 */
export const getPendingSubAgentFunctionCalls = ({
  aiRequest,
}: {|
  aiRequest: AiRequest,
|}): Array<AiRequestMessageAssistantFunctionCall> => {
  const processedCallIds = new Set<string>();
  const output = aiRequest.output || [];
  for (let i = 0; i < output.length; i++) {
    const message = output[i];
    if (!message || typeof message !== 'object') continue;
    if (message.type === 'function_call_output') {
      processedCallIds.add(message.call_id);
    }
  }

  return getAllSubAgentFunctionCalls({ aiRequest }).filter(
    call => !processedCallIds.has(call.call_id)
  );
};

export const getFunctionCallNameByCallId = ({
  aiRequest,
  callId,
}: {|
  aiRequest: AiRequest,
  callId: string,
|}): string | null => {
  const output = aiRequest.output || [];
  for (let i = 0; i < output.length; i++) {
    const message = output[i];
    if (!message || typeof message !== 'object') continue;
    if (message.type === 'message' && message.role === 'assistant') {
      if (!Array.isArray(message.content)) continue;
      for (const content of message.content) {
        if (!content || typeof content !== 'object') continue;
        if (content.type === 'function_call' && content.call_id === callId) {
          return content.name;
        }
      }
    }
  }
  return null;
};

/**
 * Extract the latest plan from the AI request if it exists and should be displayed.
 * Returns null if no plan should be displayed (no plan exists, or all tasks are done/voided).
 */
export const getLatestActivePlan = (
  aiRequest: AiRequest
): AiRequestPlan | null => {
  let latestPlan = null;
  const outputMessages = aiRequest.output || [];
  for (let i = outputMessages.length - 1; i >= 0; i--) {
    const message = outputMessages[i];
    if (!message || typeof message !== 'object') continue;
    if (message.type === 'function_call_output' && message.output) {
      try {
        const output = JSON.parse(message.output);
        // `tasks` must be an array, not merely truthy: a non-array (an object,
        // a string) satisfies the truthiness test but throws on `.some` below,
        // and the try/catch above only covers JSON.parse. A request restored
        // from localStorage is not shape-revalidated on load, and the plan
        // output is model-authored, so neither the array nor the shape is
        // guaranteed by the time this runs.
        if (output && output.plan && Array.isArray(output.plan.tasks)) {
          // Sanitize here, at the single choke point every consumer reads:
          // drop non-object task entries so `tasks.some(task => task.status)`
          // below (and OrchestratorPlan's filter, and the studio's scans)
          // cannot throw on a hole in the model-authored plan JSON.
          latestPlan = {
            ...output.plan,
            tasks: output.plan.tasks.filter(
              task => task && typeof task === 'object'
            ),
          };
          break;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  if (!latestPlan) return null;

  const hasActiveTasks = latestPlan.tasks.some(
    task => task.status !== 'done' && task.status !== 'voided'
  );

  if (!hasActiveTasks) return null;

  return latestPlan;
};

/**
 * Returns true if the AI request needs to be polled for updates:
 * - The server is actively processing (status === 'working')
 * - OR the request is 'ready' but has sub-agent calls without a
 *   function_call_output yet (sub-agents are still running and the backend
 *   will add output to the parent when they complete)
 */
export const aiRequestShouldBeWatched = (aiRequest: AiRequest): boolean => {
  if (aiRequest.status === 'working') return true;
  if (aiRequest.status === 'ready') {
    return getPendingSubAgentFunctionCalls({ aiRequest }).length > 0;
  }
  return false;
};

/**
 * Whether a poll observed activity (a status change or new messages) for an AI
 * request, used to drive adaptive polling.
 *
 * A full fetch is incremental from the last already-known message, which is
 * echoed back: so when there was a known message, a returned count > 1 means at
 * least one new message; when there was no known message yet, every returned
 * message is new.
 */
export const aiRequestPollSawActivity = (
  previousAiRequest: ?AiRequest,
  fetchedAiRequest: AiRequest
): boolean => {
  const previousOutput = (previousAiRequest && previousAiRequest.output) || [];
  const lastKnownMessage =
    previousOutput.length > 0
      ? previousOutput[previousOutput.length - 1]
      : null;
  const wasIncrementalFetch = !!(
    lastKnownMessage && lastKnownMessage.messageId
  );
  const fetchedMessageCount =
    (fetchedAiRequest.output && fetchedAiRequest.output.length) || 0;
  const newMessageCount = wasIncrementalFetch
    ? Math.max(0, fetchedMessageCount - 1)
    : fetchedMessageCount;

  const previousStatus = previousAiRequest ? previousAiRequest.status : null;
  return fetchedAiRequest.status !== previousStatus || newMessageCount > 0;
};

// TODO: can we merge these two functions?

/**
 * Returns true if the AI request has work in progress that should be suspended:
 * - The server is actively processing (status === 'working')
 * - OR the request has sub-agent calls still running
 * - OR the request is ready with function calls that still need to be processed and sent back
 */
export const aiRequestHasWorkInProgress = (
  aiRequest: AiRequest,
  editorFunctionCallResults: Array<EditorFunctionCallResult> | null
): boolean => {
  if (aiRequest.status === 'working') return true;
  // A function call is either being processed or has been processed by the editor but not yet sent back
  // (e.g. generateEvents that finished execution but the output hasn't been sent back to the AI with the follow-up request).
  // This means there's still work in progress from the AI perspective, even if the editor is not actively working on a function call.
  if (
    editorFunctionCallResults &&
    editorFunctionCallResults.some(
      r => r.status === 'finished' || r.status === 'working'
    )
  )
    return true;
  if (aiRequest.status === 'ready') {
    if (getPendingSubAgentFunctionCalls({ aiRequest }).length > 0) return true;
    return (
      getFunctionCallsToProcess({
        aiRequest,
        editorFunctionCallResults,
      }).length > 0
    );
  }
  return false;
};

export const getFunctionCallOutputsFromEditorFunctionCallResults = (
  editorFunctionCallResults: Array<EditorFunctionCallResult> | null
): {|
  hasUnfinishedResult: boolean,
  functionCallOutputs: Array<AiRequestFunctionCallOutput>,
|} => {
  if (!editorFunctionCallResults)
    return { hasUnfinishedResult: false, functionCallOutputs: [] };

  let hasUnfinishedResult = false;
  const functionCallOutputs = editorFunctionCallResults
    .map(functionCallOutput => {
      // Skip malformed entries rather than throwing out of the turn: the
      // results array is app-built, but the sibling reads all tolerate a hole.
      if (!functionCallOutput || typeof functionCallOutput !== 'object') {
        return null;
      }
      if (functionCallOutput.status === 'finished') {
        // `output: any`: spreading a non-object (a string becomes {0:'a',...},
        // an array becomes {0:...}) corrupts the JSON the model receives, so
        // only a plain object is spread; anything else is nested under
        // `output` so its value survives without numeric keys.
        // `output: any`: spreading a non-object (a string becomes {0:'a',...},
        // an array becomes {0:...}) corrupts the JSON the model receives, so
        // only a plain object is spread; anything else is nested under
        // `output` so its value survives without numeric keys.
        const rawOutput = functionCallOutput.output;
        const outputFields =
          rawOutput &&
          typeof rawOutput === 'object' &&
          !Array.isArray(rawOutput)
            ? (rawOutput: Object)
            : { output: rawOutput };
        return {
          type: 'function_call_output',
          call_id: functionCallOutput.call_id,
          output: JSON.stringify({
            success: functionCallOutput.success,
            ...outputFields,
          }),
        };
      }

      hasUnfinishedResult = true;
      return null;
    })
    .filter(Boolean);

  return {
    // $FlowFixMe[incompatible-type]
    functionCallOutputs,
    hasUnfinishedResult,
  };
};

/**
 * Extract the last user message and last assistant messages from an AI request's
 * output, to provide context for enhanced LLM reranking (e.g., asset search).
 *
 * Collects up to 5 assistant `output_text` messages from the end of the conversation,
 * stopping when the last user message is reached.
 */
export const getLastMessagesFromAiRequestOutput = (
  output: Array<AiRequestMessage>
): RelatedAiRequestLastMessages => {
  let lastUserMessage: string | null = null;
  const lastAssistantMessages: string[] = [];

  for (let i = output.length - 1; i >= 0; i--) {
    const message = output[i];
    if (!message || typeof message !== 'object') continue;
    if (message.type === 'message' && message.role === 'user') {
      if (!Array.isArray(message.content)) break;
      const textContent = message.content.find(
        c => c && typeof c === 'object' && c.type === 'user_request'
      );
      if (textContent) {
        lastUserMessage = textContent.text;
      }
      break;
    }
    if (message.type === 'message' && message.role === 'assistant') {
      if (!Array.isArray(message.content)) continue;
      for (const content of message.content) {
        if (!content || typeof content !== 'object') continue;
        if (
          content.type === 'output_text' &&
          lastAssistantMessages.length < 5
        ) {
          lastAssistantMessages.push(content.text);
        }
      }
    }
  }

  return {
    lastUserMessage,
    lastAssistantMessages,
  };
};
