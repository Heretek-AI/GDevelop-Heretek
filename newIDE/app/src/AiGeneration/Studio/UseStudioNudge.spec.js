// @flow
import * as React from 'react';
import TestRenderer from 'react-test-renderer';
import { useStudioNudge, STUDIO_NUDGE_GRACE_MS } from './UseStudioNudge';

/**
 * The hook is mounted through a tiny harness so its timer/effect behavior can be
 * driven deterministically with fake timers - the mock provider cannot prove
 * this half (it depends on the client's real turn loop), and a real model's
 * compliance is variable.
 */
const Harness = (props: any) => {
  useStudioNudge(props);
  return null;
};

const PLAN_OUTPUT = JSON.stringify({
  success: true,
  plan: {
    tasks: [
      {
        id: 'task_1',
        title: 'Design',
        description: 'Write the design.',
        status: 'pending',
      },
    ],
  },
});

const makeRequest = (overrides: Object = {}) => ({
  id: 'req-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  userId: 'local-byok-user',
  status: 'ready',
  error: null,
  output: [
    {
      type: 'function_call_output',
      call_id: 'plan_call',
      output: PLAN_OUTPUT,
    },
  ],
  ...overrides,
});

const makeProps = (overrides: Object = {}) => {
  const request = makeRequest();
  return {
    selectedAiRequest: request,
    aiRequests: { 'req-1': request },
    activeSubAgents: {},
    getEditorFunctionCallResults: () => null,
    isSendingAiRequest: () => false,
    onSendMessage: jest.fn(async () => true),
    ...overrides,
  };
};

describe('useStudioNudge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const render = (props: Object) => {
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(React.createElement(Harness, props));
    });
    return renderer;
  };

  const advancePastGrace = async () => {
    // The timer callback defers the send through a microtask, so flush it.
    await TestRenderer.act(async () => {
      jest.advanceTimersByTime(STUDIO_NUDGE_GRACE_MS + 10);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('nudges a stalled manager once after the grace period', async () => {
    const onSendMessage = jest.fn(async () => true);
    render(makeProps({ onSendMessage }));
    await advancePastGrace();

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0][0].aiRequestId).toBe('req-1');
    expect(String(onSendMessage.mock.calls[0][0].userMessage)).toContain(
      'spawn_agent'
    );
  });

  it('does not nudge while a sub-agent is live', async () => {
    const onSendMessage = jest.fn(async () => true);
    render(
      makeProps({
        onSendMessage,
        activeSubAgents: {
          'sub-1': { parentAiRequestId: 'req-1', callId: 'call_1' },
        },
      })
    );
    await advancePastGrace();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not nudge while a turn is in flight', async () => {
    const onSendMessage = jest.fn(async () => true);
    render(makeProps({ onSendMessage, isSendingAiRequest: () => true }));
    await advancePastGrace();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not nudge a sub-agent request', async () => {
    const onSendMessage = jest.fn(async () => true);
    const request = makeRequest({
      parentAiRequestId: 'parent-1',
      studioRoleId: 'developer',
    });
    render(
      makeProps({
        onSendMessage,
        selectedAiRequest: request,
        aiRequests: { 'req-1': request },
      })
    );
    await advancePastGrace();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not nudge a suspended request', async () => {
    const onSendMessage = jest.fn(async () => true);
    const request = makeRequest({ status: 'suspended' });
    render(
      makeProps({
        onSendMessage,
        selectedAiRequest: request,
        aiRequests: { 'req-1': request },
      })
    );
    await advancePastGrace();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not nudge an old, abandoned request', async () => {
    const onSendMessage = jest.fn(async () => true);
    const request = makeRequest({
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    render(
      makeProps({
        onSendMessage,
        selectedAiRequest: request,
        aiRequests: { 'req-1': request },
      })
    );
    await advancePastGrace();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not nudge a plan whose tasks are all done', async () => {
    const onSendMessage = jest.fn(async () => true);
    const request = makeRequest({
      output: [
        {
          type: 'function_call_output',
          call_id: 'plan_call',
          output: JSON.stringify({
            success: true,
            plan: {
              tasks: [
                {
                  id: 'task_1',
                  title: 'Design',
                  description: 'Done.',
                  status: 'done',
                },
              ],
            },
          }),
        },
      ],
    });
    render(
      makeProps({
        onSendMessage,
        selectedAiRequest: request,
        aiRequests: { 'req-1': request },
      })
    );
    await advancePastGrace();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not re-nudge the same plan state on a re-render', async () => {
    const onSendMessage = jest.fn(async () => true);
    const renderer = render(makeProps({ onSendMessage }));
    await advancePastGrace();
    expect(onSendMessage).toHaveBeenCalledTimes(1);

    // A re-render (new props, same stalled plan) must not arm a second nudge.
    TestRenderer.act(() => {
      renderer.update(
        React.createElement(Harness, makeProps({ onSendMessage }))
      );
    });
    await advancePastGrace();
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });
});
