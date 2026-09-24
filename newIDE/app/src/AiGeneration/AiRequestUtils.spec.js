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
  getLatestActivePlan,
  aiRequestShouldBeWatched,
  aiRequestHasWorkInProgress,
  getSubAgentKind,
  getFunctionCallOutputsFromEditorFunctionCallResults,
  isUserMessage,
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

describe('getLatestActivePlan', () => {
  const planMessage = (tasks: any) => ({
    type: 'function_call_output',
    call_id: 'c1',
    output: JSON.stringify({ success: true, plan: { tasks } }),
  });

  it('returns the last plan that still has an active task', () => {
    const request = makeAiRequest([
      planMessage([
        { id: 'a', title: 'A', description: 'a', status: 'done' },
        { id: 'b', title: 'B', description: 'b', status: 'pending' },
      ]),
    ]);
    const plan = getLatestActivePlan(request);
    expect(plan).toBeTruthy();
    expect(plan.tasks.length).toBe(2);
  });

  it('returns null when every task is done or voided', () => {
    const request = makeAiRequest([
      planMessage([
        { id: 'a', title: 'A', description: 'a', status: 'done' },
        { id: 'b', title: 'B', description: 'b', status: 'voided' },
      ]),
    ]);
    expect(getLatestActivePlan(request)).toBe(null);
  });

  it('returns null rather than throwing when tasks is not an array', () => {
    // `output.plan.tasks` was only checked for truthiness, then `.some` was
    // called on it — so an object, a string or a number threw out of a function
    // whose own try/catch covers only JSON.parse. The plan output is
    // model-authored and a request restored from localStorage is not
    // shape-revalidated, so neither the array nor its shape is guaranteed.
    for (const tasks of [{ '0': { status: 'pending' } }, 'yes', 1, true]) {
      const request = makeAiRequest([planMessage(tasks)]);
      expect(getLatestActivePlan(request)).toBe(null);
    }
  });

  it('drops null task entries instead of throwing on the active check', () => {
    // Plan tasks are model-authored JSON (and persisted output), not
    // shape-validated per element: `tasks.some(task => task.status)` threw on
    // a null entry, and the same array feeds OrchestratorPlan and the studio.
    const request = makeAiRequest([
      planMessage([
        null,
        { id: 'b', title: 'B', description: 'b', status: 'pending' },
      ]),
    ]);
    const plan = getLatestActivePlan(request);
    expect(plan).toBeTruthy();
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].id).toBe('b');
  });

  it('ignores a malformed plan message and finds nothing', () => {
    const request = makeAiRequest([
      { type: 'function_call_output', call_id: 'c1', output: '{not json' },
    ]);
    expect(getLatestActivePlan(request)).toBe(null);
  });
});

describe('aiRequestShouldBeWatched', () => {
  it('watches a working request', () => {
    expect(
      aiRequestShouldBeWatched({
        ...makeAiRequest([]),
        status: 'working',
      })
    ).toBe(true);
  });

  it('watches a ready request only while it has pending sub-agents', () => {
    const withSubAgent = makeAiRequest([
      makeAssistantMessage([
        makeSubAgentFunctionCall('c1', 'run_edit_agent', 'sub-1'),
      ]),
    ]);
    expect(aiRequestShouldBeWatched({ ...withSubAgent, status: 'ready' })).toBe(
      true
    );

    const subAgentDone = makeAiRequest([
      makeAssistantMessage([
        makeSubAgentFunctionCall('c1', 'run_edit_agent', 'sub-1'),
      ]),
      makeFunctionCallOutput('c1'),
    ]);
    expect(aiRequestShouldBeWatched({ ...subAgentDone, status: 'ready' })).toBe(
      false
    );
  });

  it('does not watch a settled request', () => {
    for (const status of ['ready', 'error', 'suspended']) {
      expect(aiRequestShouldBeWatched({ ...makeAiRequest([]), status })).toBe(
        false
      );
    }
  });
});

describe('aiRequestHasWorkInProgress', () => {
  it('is true while the request is working', () => {
    expect(
      aiRequestHasWorkInProgress(
        { ...makeAiRequest([]), status: 'working' },
        null
      )
    ).toBe(true);
  });

  it('is true while an editor result is finished or working', () => {
    const request = { ...makeAiRequest([]), status: 'ready' };
    for (const status of ['finished', 'working']) {
      const results: any = [{ status, call_id: 'c1' }];
      expect(aiRequestHasWorkInProgress(request, results)).toBe(true);
    }
    // An aborted result is not work in progress.
    const aborted: any = [{ status: 'aborted', call_id: 'c1' }];
    expect(aiRequestHasWorkInProgress(request, aborted)).toBe(false);
  });

  it('is true for a ready request with an unprocessed call', () => {
    const request = makeAiRequest([
      makeAssistantMessage([makeFunctionCall('c1', 'create_scene')]),
    ]);
    // $FlowFixMe - status is a plain string in the fixture.
    expect(
      aiRequestHasWorkInProgress({ ...request, status: 'ready' }, null)
    ).toBe(true);
  });

  it('is false for a ready request with nothing left', () => {
    const request = makeAiRequest([
      makeAssistantMessage([makeFunctionCall('c1', 'create_scene')]),
      makeFunctionCallOutput('c1'),
    ]);
    expect(
      aiRequestHasWorkInProgress({ ...request, status: 'ready' }, null)
    ).toBe(false);
  });

  it('is false once the request settled', () => {
    expect(
      aiRequestHasWorkInProgress(
        { ...makeAiRequest([]), status: 'error' },
        null
      )
    ).toBe(false);
    expect(
      aiRequestHasWorkInProgress(
        { ...makeAiRequest([]), status: 'suspended' },
        null
      )
    ).toBe(false);
  });
});

describe('getSubAgentKind', () => {
  it('reads the kind from the parent launch call', () => {
    const parent = makeAiRequest([
      makeAssistantMessage([
        makeSubAgentFunctionCall('c1', 'run_explorer_agent', 'sub-1'),
        makeSubAgentFunctionCall('c2', 'run_edit_agent', 'sub-2'),
      ]),
    ]);
    const aiRequests = { 'parent-1': parent };
    const explorer: any = {
      ...makeAiRequest([]),
      id: 'sub-1',
      parentAiRequestId: 'parent-1',
    };
    const edit: any = {
      ...makeAiRequest([]),
      id: 'sub-2',
      parentAiRequestId: 'parent-1',
    };
    expect(getSubAgentKind({ aiRequest: explorer, aiRequests })).toBe(
      'explorer'
    );
    expect(getSubAgentKind({ aiRequest: edit, aiRequests })).toBe('edit');
  });

  it('is null without a parent, a missing parent, or a non-agent launch call', () => {
    const topLevel: any = { ...makeAiRequest([]), id: 'top' };
    expect(getSubAgentKind({ aiRequest: topLevel, aiRequests: {} })).toBe(null);

    const orphan: any = {
      ...makeAiRequest([]),
      id: 'sub-9',
      parentAiRequestId: 'missing',
    };
    expect(getSubAgentKind({ aiRequest: orphan, aiRequests: {} })).toBe(null);
  });
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

describe('getFunctionCallOutputsFromEditorFunctionCallResults', () => {
  it('maps finished results and flags a working one', () => {
    const result = getFunctionCallOutputsFromEditorFunctionCallResults(
      ([
        {
          status: 'finished',
          call_id: 'c1',
          success: true,
          output: { message: 'ok' },
        },
        { status: 'working', call_id: 'c2' },
      ]: any)
    );
    expect(result.hasUnfinishedResult).toBe(true);
    expect(result.functionCallOutputs).toHaveLength(1);
    expect(result.functionCallOutputs[0].call_id).toBe('c1');
    expect(JSON.parse(result.functionCallOutputs[0].output)).toEqual({
      success: true,
      message: 'ok',
    });
  });

  it('returns no outputs and no unfinished flag for null', () => {
    expect(getFunctionCallOutputsFromEditorFunctionCallResults(null)).toEqual({
      hasUnfinishedResult: false,
      functionCallOutputs: [],
    });
  });

  it('does not crash on a null entry', () => {
    const result = getFunctionCallOutputsFromEditorFunctionCallResults(
      ([
        null,
        { status: 'finished', call_id: 'c1', success: true, output: {} },
      ]: any)
    );
    expect(result.functionCallOutputs).toHaveLength(1);
    expect(result.functionCallOutputs[0].call_id).toBe('c1');
  });

  it('does not spread a non-object output into numeric keys', () => {
    // `output: any`: spreading a string yields {0:'a',1:'b',...}, corrupting
    // the JSON the model receives for that call.
    const result = getFunctionCallOutputsFromEditorFunctionCallResults(
      ([
        { status: 'finished', call_id: 'c1', success: false, output: 'boom' },
        {
          status: 'finished',
          call_id: 'c2',
          success: true,
          output: ['a', 'b'],
        },
      ]: any)
    );
    for (const out of result.functionCallOutputs) {
      const parsed = JSON.parse(out.output);
      expect(Object.keys(parsed)).not.toContain('0');
      expect(parsed.output).toBeDefined();
    }
  });
});

describe('null holes in the persisted output never crash the dispatch helpers', () => {
  // normalizePersistedMessages guarantees `output` is an array but passes
  // inner entries through unchanged, and the loader checks only id/status —
  // so a null message (or a null inside a content array) reaches every loop
  // below. Each threw `Cannot read properties of null` on its first read,
  // and these run on every dispatch pass and every chat render.
  const validCall = {
    type: 'function_call',
    status: 'completed',
    call_id: 'c1',
    name: 'describe_instances',
    arguments: '{}',
  };
  const validAssistant = {
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [validCall, null],
  };
  const validOutput = {
    type: 'function_call_output',
    call_id: 'c1',
    output: '{"success":true}',
  };

  it('getFunctionCallsToProcess skips null messages and null entries', () => {
    const result = getFunctionCallsToProcess(
      ({
        aiRequest: makeAiRequest([null, validAssistant, undefined]),
        editorFunctionCallResults: [],
      }: any)
    );
    expect(result.map(fc => fc.call_id)).toEqual(['c1']);
  });

  it('getFunctionCallToFunctionCallOutputMap skips null messages and null entries', () => {
    const map = getFunctionCallToFunctionCallOutputMap(
      ({ aiRequest: makeAiRequest([null, validAssistant, validOutput]) }: any)
    );
    expect(map.size).toBe(1);
  });

  it('getAllSubAgentFunctionCalls skips null messages and null entries', () => {
    const subAgentCall = {
      type: 'function_call',
      status: 'completed',
      call_id: 'c2',
      name: 'run_project_edit_agent',
      arguments: '{}',
      subAgentAiRequestId: 'sub-1',
    };
    const result = getAllSubAgentFunctionCalls(
      ({
        aiRequest: makeAiRequest([
          null,
          {
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [null, subAgentCall],
          },
        ]),
      }: any)
    );
    expect(result.map(fc => fc.call_id)).toEqual(['c2']);
  });

  it('getPendingSubAgentFunctionCalls skips null messages', () => {
    const result = getPendingSubAgentFunctionCalls(
      ({ aiRequest: makeAiRequest([null, validOutput]) }: any)
    );
    expect(result).toEqual([]);
  });

  it('getFunctionCallNameByCallId skips nulls and still finds the real call', () => {
    expect(
      getFunctionCallNameByCallId(
        ({
          aiRequest: makeAiRequest([null, validAssistant]),
          callId: 'c1',
        }: any)
      )
    ).toBe('describe_instances');
  });

  it('getLatestActivePlan skips null messages', () => {
    // The search runs backward from the end, so the null must come last to
    // be visited before the plan is found — a null before the plan is never
    // reached and proves nothing.
    const request = makeAiRequest([
      {
        type: 'function_call_output',
        call_id: 'c1',
        output: JSON.stringify({
          success: true,
          plan: {
            tasks: [
              { id: 'a', title: 'A', description: 'a', status: 'pending' },
            ],
          },
        }),
      },
      null,
    ]);
    expect(
      getLatestActivePlan(({ output: request.output }: any)).tasks
    ).toHaveLength(1);
  });

  it('getLastMessagesFromAiRequestOutput skips null messages and null entries', () => {
    expect(
      getLastMessagesFromAiRequestOutput(
        ([
          null,
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'user_request', text: 'hi' }, null],
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'done' }, null],
          },
        ]: any)
      )
    ).toEqual({ lastUserMessage: 'hi', lastAssistantMessages: ['done'] });
  });

  it('isUserMessage (the loop-guard filter) tolerates null holes', () => {
    // The dispatcher finds the last user message on every pass; a null hole
    // threw out of the whole batch before any call was dispatched.
    expect(
      ([
        null,
        { type: 'message', role: 'assistant', content: [] },
        { type: 'message', role: 'user', content: [] },
        undefined,
      ]: any)
        .filter(isUserMessage)
        .pop().role
    ).toBe('user');
    expect(isUserMessage(null)).toBe(false);
    expect(isUserMessage(undefined)).toBe(false);
    expect(isUserMessage('user')).toBe(false);
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
