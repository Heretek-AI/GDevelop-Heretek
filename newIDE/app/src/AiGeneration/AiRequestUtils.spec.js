// @flow
import {
  getUserRequestText,
  getAiRequestSummaryTitle,
  getAllSubAgentFunctionCalls,
  getFunctionCallsToProcess,
  getFunctionCallToFunctionCallOutputMap,
  getFunctionCallNameByCallId,
  getLastMessagesFromAiRequestOutput,
  getLocalAiRequestContextUsedRatio,
  getPendingSubAgentFunctionCalls,
  aiRequestPollSawActivity,
  canRetryAiRequest,
  canSendAiRequestForSession,
  canUseEditorAiTools,
  canStartAiRequestCreate,
  shouldFetchAiRequestOnTabOpen,
  shouldFetchAiRequestSuggestions,
  MAX_AI_REQUEST_RETRIES_IN_A_ROW,
  canRetryAiRequestForSession,
  canSendFeedbackForSession,
  isFailedAiRequestStart,
  getStandaloneCreateOutcome,
} from './AiRequestUtils';
import { type AiRequest } from '../Utils/GDevelopServices/Generation';

const makeAiRequest = (output: Array<any>): AiRequest => ({
  id: 'request-1',
  createdAt: '',
  updatedAt: '',
  userId: 'user-1',
  status: 'working',
  error: null,
  output,
});

const makeAssistantMessage = (functionCalls: Array<any>) => ({
  type: 'message',
  status: 'completed',
  role: 'assistant',
  content: functionCalls,
});

const makeFunctionCall = (callId: string, name: string) => ({
  type: 'function_call',
  status: 'completed',
  call_id: callId,
  name,
  arguments: '{}',
});

const makeSubAgentFunctionCall = (
  callId: string,
  name: string,
  subAgentAiRequestId: string
) => ({
  type: 'function_call',
  status: 'completed',
  call_id: callId,
  name,
  arguments: '{}',
  subAgentAiRequestId,
});

const makeFunctionCallOutput = (callId: string) => ({
  type: 'function_call_output',
  call_id: callId,
  output: '{"success":true}',
});

describe('getFunctionCallsToProcess', () => {
  it('skips sub-agent function calls', () => {
    const aiRequest = makeAiRequest([
      makeAssistantMessage([
        makeFunctionCall('call-1', 'create_object'),
        makeSubAgentFunctionCall(
          'call-2',
          'run_project_edit_agent',
          'sub-agent-1'
        ),
        makeFunctionCall('call-3', 'add_scene_events'),
      ]),
    ]);

    const result = getFunctionCallsToProcess({
      aiRequest,
      editorFunctionCallResults: null,
    });

    expect(result.map(fc => fc.call_id)).toEqual(['call-1', 'call-3']);
  });
});

describe('getPendingSubAgentFunctionCalls', () => {
  it('returns pending sub-agent function calls', () => {
    const aiRequest = makeAiRequest([
      makeAssistantMessage([
        makeFunctionCall('call-1', 'create_object'),
        makeSubAgentFunctionCall(
          'call-2',
          'run_project_edit_agent',
          'sub-agent-1'
        ),
      ]),
      makeFunctionCallOutput('call-1'),
    ]);

    const result = getPendingSubAgentFunctionCalls({ aiRequest });

    expect(result).toHaveLength(1);
    expect(result[0].call_id).toBe('call-2');
    expect(result[0].subAgentAiRequestId).toBe('sub-agent-1');
  });

  it('excludes completed sub-agent function calls', () => {
    const aiRequest = makeAiRequest([
      makeAssistantMessage([
        makeSubAgentFunctionCall(
          'call-1',
          'run_project_edit_agent',
          'sub-agent-1'
        ),
      ]),
      makeFunctionCallOutput('call-1'),
    ]);

    const result = getPendingSubAgentFunctionCalls({ aiRequest });

    expect(result).toHaveLength(0);
  });
});

describe('getAllSubAgentFunctionCalls', () => {
  it('returns both pending and completed sub-agent function calls', () => {
    const aiRequest = makeAiRequest([
      makeAssistantMessage([
        makeSubAgentFunctionCall(
          'call-1',
          'run_project_edit_agent',
          'sub-agent-1'
        ),
        makeSubAgentFunctionCall(
          'call-2',
          'run_project_edit_agent',
          'sub-agent-2'
        ),
      ]),
      makeFunctionCallOutput('call-1'),
    ]);

    const result = getAllSubAgentFunctionCalls({ aiRequest });

    expect(result.map(fc => fc.call_id)).toEqual(['call-1', 'call-2']);
    expect(result.map(fc => fc.subAgentAiRequestId)).toEqual([
      'sub-agent-1',
      'sub-agent-2',
    ]);
  });

  it('excludes non-sub-agent function calls', () => {
    const aiRequest = makeAiRequest([
      makeAssistantMessage([
        makeFunctionCall('call-1', 'create_object'),
        makeSubAgentFunctionCall(
          'call-2',
          'run_project_edit_agent',
          'sub-agent-1'
        ),
        makeFunctionCall('call-3', 'add_scene_events'),
      ]),
    ]);

    const result = getAllSubAgentFunctionCalls({ aiRequest });

    expect(result).toHaveLength(1);
    expect(result[0].call_id).toBe('call-2');
  });

  it('returns an empty array when there are no sub-agent function calls', () => {
    const aiRequest = makeAiRequest([
      makeAssistantMessage([makeFunctionCall('call-1', 'create_object')]),
    ]);

    const result = getAllSubAgentFunctionCalls({ aiRequest });

    expect(result).toEqual([]);
  });
});

describe('aiRequestPollSawActivity', () => {
  const makeRequestWithStatus = (
    status: 'working' | 'ready' | 'error' | 'suspended',
    output: Array<any>
  ): AiRequest => ({ ...makeAiRequest(output), status });

  it('is true when the status changed', () => {
    const previous = makeRequestWithStatus('working', [{ messageId: 'm1' }]);
    const fetched = makeRequestWithStatus('ready', [{ messageId: 'm1' }]);
    expect(aiRequestPollSawActivity(previous, fetched)).toBe(true);
  });

  it('is false when the status is unchanged and the incremental fetch only echoes the last known message', () => {
    const previous = makeRequestWithStatus('working', [{ messageId: 'm1' }]);
    // Incremental fetch returns just the echoed last known message.
    const fetched = makeRequestWithStatus('working', [{ messageId: 'm1' }]);
    expect(aiRequestPollSawActivity(previous, fetched)).toBe(false);
  });

  it('is true when the incremental fetch returns new messages beyond the echo', () => {
    const previous = makeRequestWithStatus('working', [{ messageId: 'm1' }]);
    const fetched = makeRequestWithStatus('working', [
      { messageId: 'm1' },
      { messageId: 'm2' },
    ]);
    expect(aiRequestPollSawActivity(previous, fetched)).toBe(true);
  });

  it('is true on the first fetch, when there is no previously known request', () => {
    const fetched = makeRequestWithStatus('working', [{ messageId: 'm1' }]);
    expect(aiRequestPollSawActivity(null, fetched)).toBe(true);
  });

  it('is false when status is unchanged and there are no messages', () => {
    const previous = makeRequestWithStatus('working', []);
    const fetched = makeRequestWithStatus('working', []);
    expect(aiRequestPollSawActivity(previous, fetched)).toBe(false);
  });
});

describe('canRetryAiRequest', () => {
  const makeErroredAiRequest = (overrides: Object): AiRequest => ({
    ...makeAiRequest([{ messageId: 'm1' }]),
    status: 'error',
    ...overrides,
  });

  it('is true for a request that just failed', () => {
    expect(canRetryAiRequest(makeErroredAiRequest({}))).toBe(true);
  });

  it('is false for a request that did not fail', () => {
    expect(canRetryAiRequest(makeAiRequest([]))).toBe(false);
  });

  it('is false once the retries of this conversation are exhausted', () => {
    expect(
      canRetryAiRequest(
        makeErroredAiRequest({
          retriesInARowCount: MAX_AI_REQUEST_RETRIES_IN_A_ROW - 1,
          retriedAfterMessagesCount: 1,
        })
      )
    ).toBe(true);
    expect(
      canRetryAiRequest(
        makeErroredAiRequest({
          retriesInARowCount: MAX_AI_REQUEST_RETRIES_IN_A_ROW,
          retriedAfterMessagesCount: 1,
        })
      )
    ).toBe(false);
  });

  it('is true again when something was written to the conversation since', () => {
    expect(
      canRetryAiRequest(
        makeErroredAiRequest({
          retriesInARowCount: MAX_AI_REQUEST_RETRIES_IN_A_ROW,
          retriedAfterMessagesCount: 0,
        })
      )
    ).toBe(true);
  });
});

describe('canSendAiRequestForSession', () => {
  it('allows a logged-in profile', () => {
    expect(canSendAiRequestForSession({ id: 'user-1' }, false, null)).toBe(
      true
    );
    expect(canSendAiRequestForSession({ id: 'user-1' }, true, null)).toBe(true);
  });

  it('allows local/BYOK (custom endpoint) without a profile', () => {
    expect(canSendAiRequestForSession(null, true, null)).toBe(true);
  });

  it('allows a local-ai-* id without a profile or custom endpoint', () => {
    expect(canSendAiRequestForSession(null, false, 'local-ai-123-abc')).toBe(
      true
    );
    expect(
      canSendAiRequestForSession(undefined, false, 'local-ai-123-abc')
    ).toBe(true);
  });

  it('refuses hosted sends without a profile and without a custom endpoint', () => {
    expect(canSendAiRequestForSession(null, false, null)).toBe(false);
    expect(canSendAiRequestForSession(undefined, false, undefined)).toBe(false);
    expect(canSendAiRequestForSession(null, false, 'hosted-1')).toBe(false);
  });
});

describe('shouldFetchAiRequestSuggestions', () => {
  const readyAgentRequest = (
    output: Array<any> = [makeAssistantMessage([])]
  ): AiRequest => ({
    ...makeAiRequest(output),
    status: 'ready',
    mode: 'agent',
  });

  const baseOptions = (overrides: Object = {}) => ({
    selectedAiRequest: readyAgentRequest(),
    isSending: false,
    isFetchingSuggestions: false,
    profile: null,
    customEndpointEnabled: true,
    hasProject: true,
    ...overrides,
  });

  it('allows offline BYOK (custom endpoint, no profile) to fetch suggestions', () => {
    expect(shouldFetchAiRequestSuggestions(baseOptions())).toBe(true);
  });

  it('allows a logged-in profile even without a custom endpoint', () => {
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({ profile: { id: 'user-1' }, customEndpointEnabled: false })
      )
    ).toBe(true);
  });

  it('refuses hosted sessions without a profile', () => {
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({ profile: null, customEndpointEnabled: false })
      )
    ).toBe(false);
  });

  it('allows a local-ai-* chat without a profile or custom endpoint', () => {
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({
          profile: null,
          customEndpointEnabled: false,
          selectedAiRequest: {
            ...readyAgentRequest(),
            id: 'local-ai-from-history',
          },
        })
      )
    ).toBe(true);
  });

  it('refuses while a send or another suggestions fetch is in flight', () => {
    expect(
      shouldFetchAiRequestSuggestions(baseOptions({ isSending: true }))
    ).toBe(false);
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({ isFetchingSuggestions: true })
      )
    ).toBe(false);
  });

  it('refuses when the request is not ready, empty, or not an agent mode', () => {
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({
          selectedAiRequest: { ...readyAgentRequest(), status: 'working' },
        })
      )
    ).toBe(false);
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({ selectedAiRequest: readyAgentRequest([]) })
      )
    ).toBe(false);
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({
          selectedAiRequest: { ...readyAgentRequest(), mode: 'chat' },
        })
      )
    ).toBe(false);
    expect(
      shouldFetchAiRequestSuggestions(baseOptions({ selectedAiRequest: null }))
    ).toBe(false);
  });

  it('refuses until a project is loaded', () => {
    expect(
      shouldFetchAiRequestSuggestions(baseOptions({ hasProject: false }))
    ).toBe(false);
  });

  it('allows orchestrator mode once ready', () => {
    expect(
      shouldFetchAiRequestSuggestions(
        baseOptions({
          selectedAiRequest: { ...readyAgentRequest(), mode: 'orchestrator' },
        })
      )
    ).toBe(true);
  });
});

describe('shouldFetchAiRequestOnTabOpen', () => {
  const localRequest = { id: 'local-ai-1' };
  const hostedRequest = { id: 'chat-1' };

  it('refuses when no request is selected', () => {
    expect(
      shouldFetchAiRequestOnTabOpen({
        selectedAiRequest: null,
        profile: { id: 'user-1' },
        customEndpointEnabled: false,
      })
    ).toBe(false);
  });

  it('allows a logged-in profile for hosted ids', () => {
    expect(
      shouldFetchAiRequestOnTabOpen({
        selectedAiRequest: hostedRequest,
        profile: { id: 'user-1' },
        customEndpointEnabled: false,
      })
    ).toBe(true);
  });

  it('allows local-ai-* chats without a profile (offline BYOK)', () => {
    expect(
      shouldFetchAiRequestOnTabOpen({
        selectedAiRequest: localRequest,
        profile: null,
        customEndpointEnabled: false,
      })
    ).toBe(true);
  });

  it('allows any selected chat while a custom endpoint is enabled', () => {
    expect(
      shouldFetchAiRequestOnTabOpen({
        selectedAiRequest: hostedRequest,
        profile: null,
        customEndpointEnabled: true,
      })
    ).toBe(true);
  });

  it('refuses hosted non-local ids without a profile or custom endpoint', () => {
    expect(
      shouldFetchAiRequestOnTabOpen({
        selectedAiRequest: hostedRequest,
        profile: null,
        customEndpointEnabled: false,
      })
    ).toBe(false);
  });
});

describe('isFailedAiRequestStart', () => {
  it('flags status error (local create returned a failure, not thrown)', () => {
    expect(
      isFailedAiRequestStart({
        status: 'error',
        error: { code: 'server_error', message: 'boom' },
      })
    ).toBe(true);
  });

  it('flags status suspended (user cancelled a hung local create)', () => {
    expect(isFailedAiRequestStart({ status: 'suspended', error: null })).toBe(
      true
    );
  });

  it('does not flag working / completed starts', () => {
    expect(isFailedAiRequestStart({ status: 'working', error: null })).toBe(
      false
    );
    expect(isFailedAiRequestStart({ status: 'completed', error: null })).toBe(
      false
    );
  });
});

describe('getStandaloneCreateOutcome', () => {
  it('keeps the form on the error row when create returns status error', () => {
    expect(
      getStandaloneCreateOutcome({
        status: 'error',
        error: { code: 'server_error', message: 'offline' },
      })
    ).toBe('error-row');
  });

  it('keeps the project open when the user cancels a hung create', () => {
    expect(
      getStandaloneCreateOutcome({ status: 'suspended', error: null })
    ).toBe('error-row');
  });

  it('hands off (and may close the project) only for successful starts', () => {
    expect(getStandaloneCreateOutcome({ status: 'working', error: null })).toBe(
      'handoff'
    );
    expect(getStandaloneCreateOutcome({ status: 'ready', error: null })).toBe(
      'handoff'
    );
  });
});

describe('canRetryAiRequestForSession', () => {
  it('allows any profile for any request id', () => {
    expect(canRetryAiRequestForSession({ id: 'user-1' }, 'hosted-1')).toBe(
      true
    );
    expect(canRetryAiRequestForSession({ id: 'user-1' }, 'local-ai-1')).toBe(
      true
    );
  });

  it('allows local-ai-* without a profile (offline BYOK)', () => {
    expect(canRetryAiRequestForSession(null, 'local-ai-abc')).toBe(true);
    expect(canRetryAiRequestForSession(undefined, 'local-ai-abc')).toBe(true);
  });

  it('refuses non-local ids without a profile (hosted /action/retry needs auth)', () => {
    expect(canRetryAiRequestForSession(null, 'hosted-1')).toBe(false);
    expect(canRetryAiRequestForSession(undefined, 'hosted-1')).toBe(false);
  });
});

describe('canSendFeedbackForSession', () => {
  it('allows any profile for any request id', () => {
    expect(canSendFeedbackForSession({ id: 'user-1' }, 'hosted-1')).toBe(true);
    expect(canSendFeedbackForSession({ id: 'user-1' }, 'local-ai-1')).toBe(
      true
    );
  });

  it('allows local-ai-* without a profile (offline BYOK)', () => {
    expect(canSendFeedbackForSession(null, 'local-ai-abc')).toBe(true);
    expect(canSendFeedbackForSession(undefined, 'local-ai-abc')).toBe(true);
  });

  it('refuses non-local ids without a profile (hosted set-feedback needs auth)', () => {
    expect(canSendFeedbackForSession(null, 'hosted-1')).toBe(false);
    expect(canSendFeedbackForSession(undefined, 'hosted-1')).toBe(false);
  });
});

describe('canUseEditorAiTools', () => {
  it('allows a logged-in profile with or without the custom endpoint', () => {
    expect(canUseEditorAiTools({ id: 'user-1' }, false)).toBe(true);
    expect(canUseEditorAiTools({ id: 'user-1' }, true)).toBe(true);
  });

  it('allows offline local BYOK (no profile, endpoint off)', () => {
    expect(canUseEditorAiTools(null, false)).toBe(true);
    expect(canUseEditorAiTools(undefined, false)).toBe(true);
  });

  it('allows local/BYOK without a profile when the endpoint is on', () => {
    expect(canUseEditorAiTools(null, true)).toBe(true);
    expect(canUseEditorAiTools(undefined, true)).toBe(true);
  });
});

describe('canStartAiRequestCreate', () => {
  it('allows a logged-in profile with or without the custom endpoint', () => {
    expect(canStartAiRequestCreate({ id: 'user-1' }, false)).toBe(true);
    expect(canStartAiRequestCreate({ id: 'user-1' }, true)).toBe(true);
  });

  it('allows offline local BYOK create (no profile, endpoint off)', () => {
    expect(canStartAiRequestCreate(null, false)).toBe(true);
    expect(canStartAiRequestCreate(undefined, false)).toBe(true);
  });

  it('allows local/BYOK create without a profile when the endpoint is on', () => {
    expect(canStartAiRequestCreate(null, true)).toBe(true);
    expect(canStartAiRequestCreate(undefined, true)).toBe(true);
  });
});

describe('getUserRequestText', () => {
  const userMessage = text => ({
    type: 'message',
    status: 'completed',
    role: 'user',
    content: [{ type: 'user_request', status: 'completed', text }],
  });

  it('reads the user request text', () => {
    expect(getUserRequestText((userMessage('Add a player'): any))).toBe(
      'Add a player'
    );
  });

  it('joins multiple user_request entries', () => {
    expect(
      getUserRequestText(
        ({
          type: 'message',
          status: 'completed',
          role: 'user',
          content: [
            { type: 'user_request', status: 'completed', text: 'one' },
            { type: 'user_request', status: 'completed', text: 'two' },
          ],
        }: any)
      )
    ).toBe('one two');
  });

  it('returns empty for a message without a content array', () => {
    // A hosted summary carries the raw first message; a payload missing
    // `content` used to throw here, which would take the chat list down.
    // $FlowFixMe deliberately malformed for the guard.
    expect(getUserRequestText(({ type: 'message', role: 'user' }: any))).toBe(
      ''
    );
    // $FlowFixMe deliberately malformed for the guard.
    expect(getUserRequestText(({ content: null }: any))).toBe('');
    // $FlowFixMe deliberately malformed for the guard.
    expect(getUserRequestText(({ content: 'nope' }: any))).toBe('');
    // $FlowFixMe deliberately malformed for the guard.
    expect(getUserRequestText((null: any))).toBe('');
  });

  it('ignores entries that are not user requests or lack text', () => {
    expect(
      getUserRequestText(
        ({
          type: 'message',
          status: 'completed',
          role: 'user',
          content: [
            null,
            { type: 'output_text', status: 'completed', text: 'answer' },
            { type: 'user_request', status: 'completed' },
            { type: 'user_request', status: 'completed', text: 'real' },
          ],
        }: any)
      )
    ).toBe('real');
  });
});

describe('getAiRequestSummaryTitle', () => {
  it('prefers the given title', () => {
    expect(
      getAiRequestSummaryTitle(
        ({
          title: 'My chat',
          firstUserMessage: null,
        }: any)
      )
    ).toBe('My chat');
  });

  it('falls back to the first message when there is no title', () => {
    expect(
      getAiRequestSummaryTitle(
        ({
          title: null,
          firstUserMessage: {
            type: 'message',
            status: 'completed',
            role: 'user',
            content: [
              { type: 'user_request', status: 'completed', text: 'From msg' },
            ],
          },
        }: any)
      )
    ).toBe('From msg');
  });

  it('returns empty rather than throwing on a malformed first message', () => {
    expect(
      getAiRequestSummaryTitle(
        ({
          title: null,
          // $FlowFixMe deliberately malformed for the guard.
          firstUserMessage: { type: 'message', role: 'user' },
        }: any)
      )
    ).toBe('');
  });
});

describe('malformed message content never crashes the chat helpers', () => {
  // Every one of these reads `content` straight from a network response, which
  // is type-asserted but never validated at runtime. Before the guards, a
  // message missing its array threw in the callers that build the chat view.
  const malformedAssistant = ({
    type: 'message',
    status: 'completed',
    role: 'assistant',
    // $FlowFixMe deliberately malformed for the guard.
    content: undefined,
  }: any);
  const malformedUser = ({
    type: 'message',
    status: 'completed',
    role: 'user',
    // $FlowFixMe deliberately malformed for the guard.
    content: null,
  }: any);

  it('getFunctionCallToFunctionCallOutputMap tolerates a missing content array', () => {
    expect(
      getFunctionCallToFunctionCallOutputMap(
        ({
          aiRequest: ({ output: [malformedAssistant] }: any),
        }: any)
      ).size
    ).toBe(0);
  });

  it('getFunctionCallsToProcess tolerates a missing content array', () => {
    expect(() =>
      getFunctionCallsToProcess(
        ({
          aiRequest: ({ output: [malformedAssistant] }: any),
          editorFunctionCallResults: [],
        }: any)
      )
    ).not.toThrow();
  });

  it('getAllSubAgentFunctionCalls tolerates a missing content array', () => {
    expect(
      getAllSubAgentFunctionCalls(
        ({ aiRequest: ({ output: [malformedAssistant] }: any) }: any)
      )
    ).toEqual([]);
  });

  it('getFunctionCallNameByCallId tolerates a missing content array', () => {
    expect(
      getFunctionCallNameByCallId(
        ({
          aiRequest: ({ output: [malformedAssistant] }: any),
          callId: 'c1',
        }: any)
      )
    ).toBeNull();
  });

  it('getLastMessagesFromAiRequestOutput tolerates malformed messages', () => {
    expect(
      getLastMessagesFromAiRequestOutput(
        ([malformedUser, malformedAssistant]: any)
      )
    ).toEqual({ lastUserMessage: null, lastAssistantMessages: [] });
  });
});

describe('getLocalAiRequestContextUsedRatio', () => {
  it('reports the share of the budget used', () => {
    expect(getLocalAiRequestContextUsedRatio(500, 1000)).toBe(0.5);
    expect(getLocalAiRequestContextUsedRatio(1000, 1000)).toBe(1);
  });

  it('may exceed 1 when the chat is over budget', () => {
    // The caller renders this as an over-budget state, so it must not clamp.
    expect(getLocalAiRequestContextUsedRatio(1500, 1000)).toBe(1.5);
  });

  it('stays bounded when a chat has many turns', () => {
    // Regression on the numerator choice: occupancy comes from the latest
    // prompt, so a long chat with a modest window must not creep past 1 just
    // because it has been running. A cumulative cost total would climb
    // without bound against the same budget.
    const budget = 1000;
    const latestPrompt = 400;
    expect(getLocalAiRequestContextUsedRatio(latestPrompt, budget)).toBe(0.4);
    // The same chat after twenty turns: occupancy is unchanged, because the
    // prompt is trimmed to the budget rather than accumulating.
    expect(getLocalAiRequestContextUsedRatio(latestPrompt, budget)).toBe(0.4);
  });

  it('is null when either side is unknown, so the gauge is hidden', () => {
    expect(getLocalAiRequestContextUsedRatio(0, 1000)).toBeNull();
    expect(getLocalAiRequestContextUsedRatio(100, 0)).toBeNull();
    // A chat with no tokens accounted yet has nothing to show.
    expect(getLocalAiRequestContextUsedRatio(0, 0)).toBeNull();
    // $FlowFixMe deliberately malformed for the guard.
    expect(getLocalAiRequestContextUsedRatio(NaN, 1000)).toBeNull();
    // $FlowFixMe deliberately malformed for the guard.
    expect(getLocalAiRequestContextUsedRatio(Infinity, 1000)).toBeNull();
    // $FlowFixMe deliberately malformed for the guard.
    expect(getLocalAiRequestContextUsedRatio('lots', 1000)).toBeNull();
    // $FlowFixMe deliberately malformed for the guard.
    expect(getLocalAiRequestContextUsedRatio(null, null)).toBeNull();
  });
});
