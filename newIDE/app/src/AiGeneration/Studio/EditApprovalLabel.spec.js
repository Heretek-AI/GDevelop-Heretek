// @flow
import { getEditApprovalLaunchingCall } from './EditApprovalLabel';

const subAgentRequest = (id: string, parentId: string | null): any => ({
  id,
  parentAiRequestId: parentId,
});

const parentWith = (id: string, output: Array<any>): any => ({
  id,
  output,
});

const launchCall = (callId: string, childId: string): any => ({
  type: 'function_call',
  status: 'completed',
  call_id: callId,
  name: 'spawn_agent',
  arguments: '{}',
  subAgentAiRequestId: childId,
});

const assistantWith = (entries: Array<any>): any => ({
  type: 'message',
  status: 'completed',
  role: 'assistant',
  content: entries,
});

describe('getEditApprovalLaunchingCall', () => {
  it('resolves the call that launched the sub-agent', () => {
    const child = subAgentRequest('child-1', 'parent-1');
    const parent = parentWith('parent-1', [
      assistantWith([launchCall('call-9', 'child-1')]),
    ]);
    const found = getEditApprovalLaunchingCall({
      aiRequest: child,
      aiRequests: { 'parent-1': parent },
    });
    expect(found && found.call_id).toBe('call-9');
  });

  it('returns null for a top-level request (direct tool labels apply)', () => {
    expect(
      getEditApprovalLaunchingCall({
        aiRequest: subAgentRequest('req-1', null),
        aiRequests: {},
      })
    ).toBeNull();
  });

  it('returns null when the parent or the launch cannot be resolved', () => {
    const child = subAgentRequest('child-1', 'parent-1');
    // Missing parent entirely.
    expect(
      getEditApprovalLaunchingCall({ aiRequest: child, aiRequests: {} })
    ).toBeNull();
    // Parent without a matching launch (pruned history).
    expect(
      getEditApprovalLaunchingCall({
        aiRequest: child,
        aiRequests: {
          'parent-1': parentWith('parent-1', [
            assistantWith([launchCall('call-9', 'other-child')]),
          ]),
        },
      })
    ).toBeNull();
  });

  it('skips null holes in the parent output', () => {
    const child = subAgentRequest('child-1', 'parent-1');
    const parent = parentWith('parent-1', [
      null,
      assistantWith([null, launchCall('call-9', 'child-1')]),
      undefined,
    ]);
    const found = getEditApprovalLaunchingCall({
      aiRequest: child,
      aiRequests: { 'parent-1': parent },
    });
    expect(found && found.call_id).toBe('call-9');
  });
});
