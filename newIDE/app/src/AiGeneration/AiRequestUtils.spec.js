// @flow
import {
  getAllSubAgentFunctionCalls,
  getFunctionCallsToProcess,
  getPendingSubAgentFunctionCalls,
  aiRequestPollSawActivity,
  canRetryAiRequest,
  canSendAiRequestForSession,
  shouldFetchAiRequestOnTabOpen,
  shouldFetchAiRequestSuggestions,
  MAX_AI_REQUEST_RETRIES_IN_A_ROW,
  canRetryAiRequestForSession,
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
    expect(canSendAiRequestForSession({ id: 'user-1' }, false)).toBe(true);
    expect(canSendAiRequestForSession({ id: 'user-1' }, true)).toBe(true);
  });

  it('allows local/BYOK (custom endpoint) without a profile', () => {
    expect(canSendAiRequestForSession(null, true)).toBe(true);
  });

  it('refuses hosted sends without a profile and without a custom endpoint', () => {
    expect(canSendAiRequestForSession(null, false)).toBe(false);
    expect(canSendAiRequestForSession(undefined, false)).toBe(false);
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
