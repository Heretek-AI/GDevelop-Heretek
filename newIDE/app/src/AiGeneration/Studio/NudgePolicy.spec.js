// @flow
import {
  shouldNudgeStudioManager,
  getActionablePlanSignature,
  buildStudioNudgeMessage,
} from './NudgePolicy';

const baseInput = {
  isTopLevel: true,
  status: 'ready',
  hasWorkInProgress: false,
  isSending: false,
  liveSubAgentCount: 0,
  pendingSubAgentCallCount: 0,
  planSignature: 'task_1:pending:',
  previouslyNudgedSignature: null,
  isRecent: true,
};

describe('shouldNudgeStudioManager', () => {
  it('nudges a stalled top-level manager with an actionable task', () => {
    expect(shouldNudgeStudioManager((baseInput: any))).toBe(true);
  });

  it('never nudges a sub-agent (not top-level)', () => {
    expect(
      shouldNudgeStudioManager(({ ...baseInput, isTopLevel: false }: any))
    ).toBe(false);
  });

  it('never nudges an old, abandoned request', () => {
    expect(
      shouldNudgeStudioManager(({ ...baseInput, isRecent: false }: any))
    ).toBe(false);
  });

  it('never nudges while a turn is in flight or work is pending', () => {
    expect(
      shouldNudgeStudioManager(({ ...baseInput, isSending: true }: any))
    ).toBe(false);
    expect(
      shouldNudgeStudioManager(({ ...baseInput, hasWorkInProgress: true }: any))
    ).toBe(false);
  });

  it('never nudges while a sub-agent is live or its call is unanswered', () => {
    expect(
      shouldNudgeStudioManager(({ ...baseInput, liveSubAgentCount: 1 }: any))
    ).toBe(false);
    expect(
      shouldNudgeStudioManager(
        ({
          ...baseInput,
          pendingSubAgentCallCount: 1,
        }: any)
      )
    ).toBe(false);
  });

  it('does not nudge a plan with nothing actionable', () => {
    expect(
      shouldNudgeStudioManager(({ ...baseInput, planSignature: null }: any))
    ).toBe(false);
  });

  it('leaves a suspended or errored request alone', () => {
    expect(
      shouldNudgeStudioManager(({ ...baseInput, status: 'suspended' }: any))
    ).toBe(false);
    expect(
      shouldNudgeStudioManager(({ ...baseInput, status: 'error' }: any))
    ).toBe(false);
  });

  it('does not re-nudge the same plan state, but does nudge a new one', () => {
    expect(
      shouldNudgeStudioManager(
        ({
          ...baseInput,
          previouslyNudgedSignature: 'task_1:pending:',
        }: any)
      )
    ).toBe(false);
    expect(
      shouldNudgeStudioManager(
        ({
          ...baseInput,
          planSignature: 'task_2:in_progress:',
          previouslyNudgedSignature: 'task_1:pending:',
        }: any)
      )
    ).toBe(true);
  });
});

describe('getActionablePlanSignature', () => {
  it('is null for no plan or nothing actionable', () => {
    expect(getActionablePlanSignature(null)).toBeNull();
    expect(getActionablePlanSignature([])).toBeNull();
    expect(
      getActionablePlanSignature([
        ({ id: 'a', title: 'A', description: '', status: 'done' }: any),
        ({ id: 'b', title: 'B', description: '', status: 'voided' }: any),
      ])
    ).toBeNull();
  });

  it('signs the actionable tasks with their status and delegated call', () => {
    const signature = getActionablePlanSignature([
      ({ id: 'a', title: 'A', description: '', status: 'done' }: any),
      ({
        id: 'b',
        title: 'B',
        description: '',
        status: 'in_progress',
        agentCallId: 'call_1',
      }: any),
      ({ id: 'c', title: 'C', description: '', status: 'pending' }: any),
    ]);
    expect(signature).toBe('b:in_progress:call_1|c:pending:');
  });

  it('tolerates null holes in the task list', () => {
    const signature = getActionablePlanSignature([
      (null: any),
      ({ id: 'c', title: 'C', description: '', status: 'pending' }: any),
    ]);
    expect(signature).toBe('c:pending:');
  });
});

describe('buildStudioNudgeMessage', () => {
  it('names the next ready task and demands delegation', () => {
    const message = buildStudioNudgeMessage(
      ({
        id: 'task_2',
        title: 'Build the scene',
        description: '',
        status: 'pending',
      }: any)
    );
    expect(message).toContain('task_2');
    expect(message).toContain('Build the scene');
    expect(message).toContain('spawn_agent');
  });

  it('still demands delegation with no ready task', () => {
    const message = buildStudioNudgeMessage(null);
    expect(message).toContain('spawn_agent');
    expect(message).not.toContain('Next ready task');
  });
});
