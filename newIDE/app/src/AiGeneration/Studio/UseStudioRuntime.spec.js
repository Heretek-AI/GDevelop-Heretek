/**
 * @jest-environment jsdom
 */
// @flow
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useStudioRuntime } from './UseStudioRuntime';

const assistantWith = (entries: Array<any>): any => ({
  type: 'message',
  status: 'completed',
  role: 'assistant',
  content: entries,
  messageId: 'msg-1',
});

const outputText = (text: string): any => ({
  type: 'output_text',
  status: 'completed',
  text,
  annotations: [],
});

const spawnEntry = (callId: string, childId: string): any => ({
  type: 'function_call',
  status: 'completed',
  call_id: callId,
  name: 'spawn_agent',
  arguments: JSON.stringify({
    role: 'developer',
    short_title: 'Build the grid',
    task: 'Build it.',
  }),
  subAgentAiRequestId: childId,
});

const makeParent = (output: Array<any>): any => ({
  id: 'parent-1',
  createdAt: '',
  updatedAt: '',
  userId: 'local-byok-user',
  status: 'ready',
  error: null,
  output,
});

const makeChild = (output: Array<any>, status: string): any => ({
  id: 'child-1',
  createdAt: '',
  updatedAt: '',
  userId: 'local-byok-user',
  status,
  error: null,
  parentAiRequestId: 'parent-1',
  output,
});

const flush = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });

describe('useStudioRuntime', () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('finalizes a finished local sub-agent (plan write + report send)', async () => {
    // The hook is the studio write-back loop: without it a finished child
    // is never reported and the parent never takes its next turn.
    const parent = makeParent([
      assistantWith([spawnEntry('call-9', 'child-1')]),
    ]);
    const child = makeChild(
      [assistantWith([outputText('All built.')])],
      'ready'
    );
    const updateAiRequest = jest.fn();
    const onSendEditorFunctionCallResults = jest.fn(async () => true);
    const Probe = () => {
      useStudioRuntime({
        aiRequests: { 'parent-1': parent, 'child-1': child },
        activeSubAgents: {
          'child-1': { parentAiRequestId: 'parent-1', callId: 'call-9' },
        },
        getEditorFunctionCallResults: () => null,
        updateAiRequest,
        onSendEditorFunctionCallResults,
      });
      return null;
    };

    act(() => {
      root.render(<Probe />);
    });
    await flush();

    expect(updateAiRequest).toHaveBeenCalledTimes(1);
    expect(updateAiRequest.mock.calls[0][0]).toBe('parent-1');
    expect(onSendEditorFunctionCallResults).toHaveBeenCalledTimes(1);
    const [sentId, results] = onSendEditorFunctionCallResults.mock.calls[0];
    expect(sentId).toBe('parent-1');
    expect(results).toHaveLength(1);
    expect(results[0].call_id).toBe('call-9');
    expect(results[0].success).toBe(true);
    expect(results[0].output.message).toContain('All built.');
  });

  it('leaves an unfinished child alone', async () => {
    const parent = makeParent([
      assistantWith([spawnEntry('call-9', 'child-1')]),
    ]);
    const child = makeChild(
      [assistantWith([outputText('Working.')])],
      'working'
    );
    const updateAiRequest = jest.fn();
    const onSendEditorFunctionCallResults = jest.fn(async () => true);
    const Probe = () => {
      useStudioRuntime({
        aiRequests: { 'parent-1': parent, 'child-1': child },
        activeSubAgents: {
          'child-1': { parentAiRequestId: 'parent-1', callId: 'call-9' },
        },
        getEditorFunctionCallResults: () => null,
        updateAiRequest,
        onSendEditorFunctionCallResults,
      });
      return null;
    };

    act(() => {
      root.render(<Probe />);
    });
    await flush();

    expect(updateAiRequest).not.toHaveBeenCalled();
    expect(onSendEditorFunctionCallResults).not.toHaveBeenCalled();
  });
});
