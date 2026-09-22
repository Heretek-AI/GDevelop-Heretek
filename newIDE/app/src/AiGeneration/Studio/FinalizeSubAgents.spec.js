// @flow
import {
  isSubAgentFinished,
  buildSubAgentReport,
  getSubAgentReportLabel,
  countAssistantTurns,
  isSubAgentAtTurnCap,
} from './FinalizeSubAgents';
import { buildPlanStatusUpdateOutput } from './UseStudioRuntime';
import { buildPlanOutput } from './PlanStore';

const assistantMessage = (text: string, functionCalls?: Array<any>): any => ({
  type: 'message',
  status: 'completed',
  role: 'assistant',
  content: [
    { type: 'output_text', status: 'completed', text, annotations: [] },
    ...(functionCalls || []),
  ],
  messageId: `msg-asst-${text}`,
});

const spawnCall = (
  callId: string,
  subAgentId: string | null,
  relatedTaskId: string | null
): any => ({
  type: 'function_call',
  status: 'completed',
  call_id: callId,
  name: 'spawn_agent',
  arguments: JSON.stringify({
    role: 'developer',
    short_title: 'Build the grid',
    task: 'Build it.',
    related_task_id: relatedTaskId === null ? undefined : relatedTaskId,
  }),
  ...(subAgentId ? { subAgentAiRequestId: subAgentId } : {}),
});

const functionCallOutput = (
  callId: string,
  success: boolean,
  message?: string
): any => ({
  type: 'function_call_output',
  call_id: callId,
  success,
  output: message !== undefined ? { message } : {},
});

const makeSubAgent = (overrides: any): any => ({
  id: 'child-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  userId: 'local-byok-user',
  status: 'ready',
  error: null,
  output: [assistantMessage('Done.')],
  ...overrides,
});

describe('FinalizeSubAgents', () => {
  describe('isSubAgentFinished', () => {
    it('is false while the sub-agent is not ready', () => {
      expect(
        isSubAgentFinished({
          subAgentRequest: makeSubAgent({ status: 'working' }),
          editorFunctionCallResults: null,
        })
      ).toBe(false);
      expect(
        isSubAgentFinished({
          subAgentRequest: makeSubAgent({ status: 'suspended' }),
          editorFunctionCallResults: null,
        })
      ).toBe(false);
    });

    it('is false while a function call is still to be executed', () => {
      const subAgentRequest = makeSubAgent({
        output: [
          assistantMessage('Creating the scene.', [
            {
              type: 'function_call',
              status: 'completed',
              call_id: 'call-scene',
              name: 'create_scene',
              arguments: '{"scene_name":"Town"}',
            },
          ]),
        ],
      });
      expect(
        isSubAgentFinished({ subAgentRequest, editorFunctionCallResults: null })
      ).toBe(false);
    });

    it('is false while a sub-agent of its own is pending', () => {
      const subAgentRequest = makeSubAgent({
        output: [
          assistantMessage('Delegating.', [
            spawnCall('call-sub', 'child-2', null),
          ]),
        ],
      });
      expect(
        isSubAgentFinished({ subAgentRequest, editorFunctionCallResults: null })
      ).toBe(false);
    });

    it('is false while a result is still marked working', () => {
      const subAgentRequest = makeSubAgent({});
      expect(
        isSubAgentFinished({
          subAgentRequest,
          editorFunctionCallResults: [
            { status: 'working', call_id: 'call-x' },
            {
              status: 'finished',
              call_id: 'call-y',
              success: true,
              output: {},
            },
          ],
        })
      ).toBe(false);
    });

    it('is true for a clean ready sub-agent with no pending work', () => {
      expect(
        isSubAgentFinished({
          subAgentRequest: makeSubAgent({}),
          editorFunctionCallResults: null,
        })
      ).toBe(true);
      expect(
        isSubAgentFinished({
          subAgentRequest: makeSubAgent({
            output: [
              assistantMessage('Done.'),
              // The result's output has landed in the transcript (written back).
              functionCallOutput('call-y', true),
            ],
          }),
          editorFunctionCallResults: [
            {
              status: 'finished',
              call_id: 'call-y',
              success: true,
              output: {},
            },
          ],
        })
      ).toBe(true);
    });
    it('treats a sub-agent that errored as finished (4i)', () => {
      expect(
        isSubAgentFinished({
          subAgentRequest: makeSubAgent({
            status: 'error',
            error: { code: 'repeated-tool-call-loop', message: 'stuck' },
          }),
          editorFunctionCallResults: null,
        })
      ).toBe(true);
    });

    it('is false for an executed-but-unsent result (4i)', () => {
      expect(
        isSubAgentFinished({
          subAgentRequest: makeSubAgent({}),
          editorFunctionCallResults: [
            {
              status: 'finished',
              call_id: 'call-x',
              success: false,
              output: { message: 'boom' },
            },
          ],
        })
      ).toBe(false);
    });

    it('is false for an aborted/timeout-shaped request', () => {
      expect(
        isSubAgentFinished({
          subAgentRequest: makeSubAgent({ status: 'aborted' }),
          editorFunctionCallResults: null,
        })
      ).toBe(false);
    });
  });

  describe('buildSubAgentReport', () => {
    it('returns the last assistant message text', () => {
      const subAgentRequest = makeSubAgent({
        output: [
          assistantMessage('Starting.'),
          assistantMessage('Finished: created the scene Town.'),
        ],
      });
      expect(buildSubAgentReport(subAgentRequest)).toBe(
        'Finished: created the scene Town.'
      );
    });

    it('reads the local BYOK message shape, whose text entry is `text`', () => {
      // `parseAssistantMessage` (the local path) emits `type: 'text'` where the
      // server emits `type: 'output_text'`: reading only the latter reported
      // "(no report)" for every local sub-agent.
      const subAgentRequest = makeSubAgent({
        output: [
          {
            type: 'message',
            status: 'completed',
            role: 'assistant',
            text: 'Done: created the Town scene.',
            content: [
              {
                type: 'text',
                status: 'completed',
                text: 'Done: created the Town scene.',
              },
            ],
          },
        ],
      });
      expect(buildSubAgentReport(subAgentRequest)).toBe(
        'Done: created the Town scene.'
      );
    });

    it('falls back to the message text when the content entry has none', () => {
      const subAgentRequest = makeSubAgent({
        output: [
          {
            type: 'message',
            status: 'completed',
            role: 'assistant',
            text: 'Only the message text.',
            content: [],
          },
        ],
      });
      expect(buildSubAgentReport(subAgentRequest)).toBe(
        'Only the message text.'
      );
    });

    it('returns a placeholder when the last message has no text', () => {
      const subAgentRequest = makeSubAgent({
        output: [
          {
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'function_call',
                status: 'completed',
                call_id: 'call-1',
                name: 'create_scene',
                arguments: '{}',
              },
            ],
          },
        ],
      });
      expect(buildSubAgentReport(subAgentRequest)).toBe('(no report)');
    });

    it('returns a placeholder for a request with no assistant message', () => {
      expect(buildSubAgentReport(makeSubAgent({ output: [] }))).toBe(
        '(no report)'
      );
      expect(buildSubAgentReport(makeSubAgent({ output: undefined }))).toBe(
        '(no report)'
      );
    });
  });

  describe('getSubAgentReportLabel', () => {
    it('uses the role display name of the spawn call', () => {
      const parent: any = makeSubAgent({
        id: 'parent-1',
        output: [
          assistantMessage('Delegating.', [
            spawnCall('call-1', 'child-1', null),
          ]),
        ],
      });
      const child = makeSubAgent({ parentAiRequestId: 'parent-1' });

      expect(
        getSubAgentReportLabel({
          aiRequest: child,
          aiRequests: { 'parent-1': parent },
        })
      ).toBe('Developer');
    });

    it('falls back for a hosted sub-agent and for a missing parent', () => {
      const hostedParent: any = makeSubAgent({
        id: 'parent-1',
        output: [
          assistantMessage('Delegating.', [
            {
              type: 'function_call',
              status: 'completed',
              call_id: 'call-1',
              name: 'run_edit_agent',
              arguments: '{"short_title":"Editing"}',
              subAgentAiRequestId: 'child-1',
            },
          ]),
        ],
      });
      expect(
        getSubAgentReportLabel({
          aiRequest: makeSubAgent({ parentAiRequestId: 'parent-1' }),
          aiRequests: { 'parent-1': hostedParent },
        })
      ).toBe('Agent');
      expect(
        getSubAgentReportLabel({
          aiRequest: makeSubAgent({ parentAiRequestId: 'ghost' }),
          aiRequests: {},
        })
      ).toBe('Agent');
    });
  });

  describe('turn cap', () => {
    const parentWithRole = (role: string, subAgentId: string): any =>
      makeSubAgent({
        id: 'parent-1',
        output: [
          assistantMessage('Delegating.', [
            {
              type: 'function_call',
              status: 'completed',
              call_id: 'call-1',
              name: 'spawn_agent',
              arguments: JSON.stringify({
                role,
                short_title: 'Work',
                task: 'Work.',
              }),
              subAgentAiRequestId: subAgentId,
            },
          ]),
        ],
      });

    it('counts assistant turns', () => {
      expect(countAssistantTurns(makeSubAgent({}))).toBe(1);
      expect(
        countAssistantTurns(
          makeSubAgent({
            output: [assistantMessage('a'), assistantMessage('b')],
          })
        )
      ).toBe(2);
    });

    it('is false below the role cap and true at it', () => {
      const parent = parentWithRole('tester', 'child-1');
      const aiRequests = { 'parent-1': parent };

      // The tester's cap is 30.
      const belowCap = makeSubAgent({
        parentAiRequestId: 'parent-1',
        output: Array.from({ length: 29 }, (_, i) => assistantMessage(`t${i}`)),
      });
      expect(isSubAgentAtTurnCap({ aiRequest: belowCap, aiRequests })).toBe(
        false
      );

      const atCap = makeSubAgent({
        parentAiRequestId: 'parent-1',
        output: Array.from({ length: 30 }, (_, i) => assistantMessage(`t${i}`)),
      });
      expect(isSubAgentAtTurnCap({ aiRequest: atCap, aiRequests })).toBe(true);
    });

    it('is false for a sub-agent whose role cannot be resolved', () => {
      expect(
        isSubAgentAtTurnCap({
          aiRequest: makeSubAgent({}),
          aiRequests: {},
        })
      ).toBe(false);
    });
  });

  describe('buildPlanStatusUpdateOutput', () => {
    const withPlan = (tasks: Array<any>): any => {
      const parent: any = makeSubAgent({
        id: 'parent-1',
        output: [
          {
            type: 'function_call_output',
            call_id: 'plan-call',
            output: JSON.stringify(buildPlanOutput(tasks)),
          },
          assistantMessage('Delegating.', [
            spawnCall('call-1', 'child-1', 'grid'),
          ]),
        ],
      });
      return parent;
    };

    it('flips the related task to done and the next ready task to in_progress', () => {
      const parent = withPlan([
        {
          id: 'grid',
          title: 'Build the grid',
          description: 'A 20x20 grid.',
          status: 'pending',
          dependsOn: [],
        },
        {
          id: 'units',
          title: 'Add units',
          description: 'Units walk the grid.',
          status: 'pending',
          dependsOn: ['grid'],
        },
      ]);

      const updatedOutput = buildPlanStatusUpdateOutput(parent, 'call-1');
      expect(updatedOutput).not.toBeNull();
      const planMessage: any = (updatedOutput || []).find(
        (message: any) =>
          message.type === 'function_call_output' &&
          message.call_id === 'plan-call'
      );
      expect(planMessage).toBeDefined();
      const plan = JSON.parse(planMessage.output).plan;
      expect(plan.tasks[0].status).toBe('done');
      expect(plan.tasks[1].status).toBe('in_progress');
      // The transcript is not grown: the plan message is rewritten.
      expect(updatedOutput).toHaveLength(parent.output.length);
    });

    it('keeps a sibling field the writer does not model', () => {
      const parent = withPlan([
        {
          id: 'grid',
          title: 'Build the grid',
          description: 'A 20x20 grid.',
          status: 'pending',
          dependsOn: [],
          agentCallId: 'call-1',
        },
        {
          id: 'units',
          title: 'Add units',
          description: 'Units walk the grid.',
          status: 'pending',
          dependsOn: ['grid'],
          agentCallId: 'call-2',
        },
      ]);

      const plan = JSON.parse(
        ((buildPlanStatusUpdateOutput(parent, 'call-1') || [])[0]: any).output
      ).plan;
      expect(plan.tasks[0].agentCallId).toBe('call-1');
      expect(plan.tasks[1].agentCallId).toBe('call-2');
      expect(plan.tasks[1].description).toBe('Units walk the grid.');
    });

    it('returns null when there is no plan, no related task id, or a missing task', () => {
      // No plan at all.
      expect(
        buildPlanStatusUpdateOutput(
          makeSubAgent({ id: 'parent-1', output: [assistantMessage('Hi.')] }),
          'call-1'
        )
      ).toBeNull();

      // A spawn call with no related_task_id.
      const noRelated: any = makeSubAgent({
        id: 'parent-1',
        output: [
          {
            type: 'function_call_output',
            call_id: 'plan-call',
            output: JSON.stringify(
              buildPlanOutput([
                {
                  id: 'grid',
                  title: 'T',
                  description: 'D',
                  status: 'pending',
                  dependsOn: [],
                },
              ])
            ),
          },
          assistantMessage('Delegating.', [
            spawnCall('call-1', 'child-1', null),
          ]),
        ],
      });
      expect(buildPlanStatusUpdateOutput(noRelated, 'call-1')).toBeNull();

      // A related_task_id naming a task that is not in the plan.
      const missingTask = withPlan([
        {
          id: 'other',
          title: 'T',
          description: 'D',
          status: 'pending',
          dependsOn: [],
        },
      ]);
      expect(buildPlanStatusUpdateOutput(missingTask, 'call-1')).toBeNull();

      // A call id that is not a spawn call.
      const parent = withPlan([
        {
          id: 'grid',
          title: 'T',
          description: 'D',
          status: 'pending',
          dependsOn: [],
        },
      ]);
      expect(buildPlanStatusUpdateOutput(parent, 'unknown-call')).toBeNull();
    });
  });
});
