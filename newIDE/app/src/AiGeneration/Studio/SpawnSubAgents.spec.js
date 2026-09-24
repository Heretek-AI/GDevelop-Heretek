// @flow
import {
  isSpawnAgentCall,
  parseSpawnAgentArgs,
  buildGddContextNote,
  countLiveSubAgentsForParent,
  spawnSubAgent,
} from './SpawnSubAgents';
import { customCreateSubAgentAiRequest } from '../../AI/CustomAIClient';

// The child-request creation is the only external dependency of spawnSubAgent;
// mocking it keeps the test off libGD and off any network. jest.mock is
// hoisted above the imports by babel-jest, so this order is safe.
jest.mock('../../AI/CustomAIClient', () => ({
  customCreateSubAgentAiRequest: jest.fn(),
}));

const makeCall = (name: string, args: any): any => ({
  type: 'function_call',
  status: 'completed',
  call_id: 'call-1',
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
});

describe('SpawnSubAgents', () => {
  describe('isSpawnAgentCall', () => {
    it('matches only the studio delegation tool', () => {
      expect(isSpawnAgentCall(makeCall('spawn_agent', {}))).toBe(true);
      expect(isSpawnAgentCall(makeCall('create_scene', {}))).toBe(false);
      expect(isSpawnAgentCall(makeCall('run_edit_agent', {}))).toBe(false);
    });
  });

  describe('parseSpawnAgentArgs', () => {
    it('parses a valid call and defaults context and related_task_id', () => {
      const parsed = parseSpawnAgentArgs(
        makeCall('spawn_agent', {
          role: 'developer',
          short_title: 'Build the town grid',
          task: 'Place a 20x20 grid of ground tiles in Scene1.',
        })
      );
      expect(parsed).toEqual({
        role: 'developer',
        shortTitle: 'Build the town grid',
        task: 'Place a 20x20 grid of ground tiles in Scene1.',
        context: '',
        relatedTaskId: null,
      });
    });

    it('keeps context and related_task_id when given', () => {
      const parsed = parseSpawnAgentArgs(
        makeCall('spawn_agent', {
          role: 'tester',
          short_title: 'Verify the grid',
          task: 'Write and run a test asserting 400 tiles exist.',
          context: 'The grid is built by the developer.',
          related_task_id: 'grid',
        })
      );
      expect(parsed && parsed.context).toBe(
        'The grid is built by the developer.'
      );
      expect(parsed && parsed.relatedTaskId).toBe('grid');
    });

    it('returns null for a missing or empty task', () => {
      expect(
        parseSpawnAgentArgs(
          makeCall('spawn_agent', {
            role: 'developer',
            short_title: 'Title',
          })
        )
      ).toBeNull();
      expect(
        parseSpawnAgentArgs(
          makeCall('spawn_agent', {
            role: 'developer',
            short_title: 'Title',
            task: '   ',
          })
        )
      ).toBeNull();
    });

    it('returns null for a missing or empty short_title', () => {
      expect(
        parseSpawnAgentArgs(
          makeCall('spawn_agent', { role: 'developer', task: 'Do it.' })
        )
      ).toBeNull();
      expect(
        parseSpawnAgentArgs(
          makeCall('spawn_agent', {
            role: 'developer',
            short_title: '  ',
            task: 'Do it.',
          })
        )
      ).toBeNull();
    });

    it('returns null for an unknown or missing role', () => {
      expect(
        parseSpawnAgentArgs(
          makeCall('spawn_agent', {
            role: 'architect',
            short_title: 'Title',
            task: 'Do it.',
          })
        )
      ).toBeNull();
      // The manager plans, it does not get spawned as a sub-agent.
      expect(
        parseSpawnAgentArgs(
          makeCall('spawn_agent', {
            role: 'manager',
            short_title: 'Title',
            task: 'Do it.',
          })
        )
      ).toBeNull();
      expect(
        parseSpawnAgentArgs(
          makeCall('spawn_agent', { short_title: 'Title', task: 'Do it.' })
        )
      ).toBeNull();
    });

    it('returns null for arguments that are not JSON', () => {
      expect(
        parseSpawnAgentArgs(makeCall('spawn_agent', 'not json at all'))
      ).toBeNull();
      expect(parseSpawnAgentArgs(makeCall('spawn_agent', '[]'))).toBeNull();
      expect(parseSpawnAgentArgs(makeCall('spawn_agent', 'null'))).toBeNull();
    });
  });

  describe('spawnSubAgent', () => {
    const spawnCall = (args: any): any => ({
      type: 'function_call',
      status: 'completed',
      call_id: 'call-1',
      name: 'spawn_agent',
      arguments: JSON.stringify(args),
    });
    const baseArgs = {
      parentAiRequestId: 'parent-1',
      gameProjectJson: '{}',
      projectSpecificExtensionsSummaryJson: null,
      project: null,
      gddContextNote: 'GDD note',
    };

    beforeEach(() => {
      // $FlowFixMe mocked above
      customCreateSubAgentAiRequest.mockReset();
    });

    it('fails a malformed call without creating a child', async () => {
      // $FlowFixMe mocked above
      const result = await spawnSubAgent({
        ...baseArgs,
        functionCall: spawnCall({
          role: 'architect',
          short_title: 'x',
          task: 'y',
        }),
        onStamped: jest.fn(),
      });
      expect(result).toEqual({ error: 'Invalid spawn_agent arguments.' });
      // $FlowFixMe mocked above
      expect(customCreateSubAgentAiRequest).not.toHaveBeenCalled();
    });

    it('creates the child, forwards the GDD note, and stamps the call', async () => {
      // $FlowFixMe mocked above
      customCreateSubAgentAiRequest.mockResolvedValue({ id: 'child-9' });
      const onStamped = jest.fn();
      const result = await spawnSubAgent({
        ...baseArgs,
        functionCall: spawnCall({
          role: 'developer',
          short_title: 'Build the grid',
          task: 'Build it.',
          context: 'Use TileMap.',
        }),
        onStamped,
      });
      // $FlowFixMe mocked above
      const arg = customCreateSubAgentAiRequest.mock.calls[0][0];
      expect(arg.parentAiRequestId).toBe('parent-1');
      expect(arg.roleId).toBe('developer');
      expect(arg.userRequest).toContain('Task: Build it.');
      expect(arg.userRequest).toContain('Context: Use TileMap.');
      expect(arg.spawnContextNote).toBe('GDD note');
      expect(onStamped).toHaveBeenCalledWith('child-9');
      expect(result).toEqual({
        subAgentAiRequestId: 'child-9',
        shortTitle: 'Build the grid',
        callId: 'call-1',
        relatedTaskId: null,
      });
    });

    it('returns the plan task the spawn named, so the call can be linked to it', async () => {
      // $FlowFixMe mocked above
      customCreateSubAgentAiRequest.mockResolvedValue({ id: 'child-11' });
      const result = await spawnSubAgent({
        ...baseArgs,
        functionCall: spawnCall({
          role: 'developer',
          short_title: 'Build the grid',
          task: 'Build it.',
          related_task_id: 'grid',
        }),
        onStamped: jest.fn(),
      });
      expect(result).toEqual({
        subAgentAiRequestId: 'child-11',
        shortTitle: 'Build the grid',
        callId: 'call-1',
        relatedTaskId: 'grid',
      });
    });

    it('does not hand the design document back to the designer', async () => {
      // $FlowFixMe mocked above
      customCreateSubAgentAiRequest.mockResolvedValue({ id: 'child-10' });
      await spawnSubAgent({
        ...baseArgs,
        functionCall: spawnCall({
          role: 'designer',
          short_title: 'Design',
          task: 'Write the GDD.',
        }),
        onStamped: jest.fn(),
      });
      // $FlowFixMe mocked above
      expect(
        customCreateSubAgentAiRequest.mock.calls[0][0].spawnContextNote
      ).toBeNull();
    });
  });

  describe('countLiveSubAgentsForParent', () => {
    const parentWith = (output: Array<any>): any => ({
      id: 'parent-1',
      output,
    });
    const launched = (childId: string, callId: string): any => ({
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
    const answered = (callId: string): any => ({
      type: 'function_call_output',
      call_id: callId,
      output: '{"report":"done"}',
    });
    const child = (id: string): any => ({ id, output: [] });

    it('counts launched children with no answer yet', () => {
      const parent = parentWith([
        assistantWith([launched('child-1', 'call-1')]),
      ]);
      expect(
        countLiveSubAgentsForParent(parent, { 'child-1': child('child-1') })
      ).toBe(1);
    });

    it('excludes finished children (their call was answered)', () => {
      // Finished children stay in storage (they are history): counting them
      // turned the fan-out cap into a lifetime cap, so after 8 spawns ever no
      // task could ever be delegated again.
      const parent = parentWith([
        assistantWith([launched('child-1', 'call-1')]),
        answered('call-1'),
      ]);
      expect(
        countLiveSubAgentsForParent(parent, { 'child-1': child('child-1') })
      ).toBe(0);
    });

    it('excludes pruned children (stamped but no longer stored)', () => {
      const parent = parentWith([
        assistantWith([launched('child-1', 'call-1')]),
      ]);
      expect(countLiveSubAgentsForParent(parent, {})).toBe(0);
    });

    it('tolerates null holes and a missing output', () => {
      const parent = parentWith([
        null,
        assistantWith([null, launched('child-1', 'call-1')]),
        undefined,
      ]);
      expect(
        countLiveSubAgentsForParent(parent, { 'child-1': child('child-1') })
      ).toBe(1);
      expect(countLiveSubAgentsForParent(({ output: null }: any), {})).toBe(0);
      expect(countLiveSubAgentsForParent((null: any), {})).toBe(0);
    });
  });

  describe('buildGddContextNote', () => {
    let project: gdProject;

    beforeEach(() => {
      const gd: libGDevelop = global.gd;
      // $FlowFixMe[invalid-constructor]
      project = new gd.ProjectHelper.createNewGDJSProject();
    });

    afterEach(() => {
      project.delete();
    });

    it('returns an empty note without a project', () => {
      expect(buildGddContextNote(null)).toBe('');
      // $FlowFixMe[incompatible-call]
      expect(buildGddContextNote(undefined)).toBe('');
    });

    it('reads the GDD_ project variables and ignores the others', () => {
      const variables = project.getVariables();
      const gddOverview = variables.insertNew('GDD_Overview', 0);
      gddOverview.setString('A 20x20 isometric town.');
      const unrelated = variables.insertNew('Score', 1);
      unrelated.setValue(42);

      const note = buildGddContextNote(project);
      expect(note).toContain('GDD_Overview: A 20x20 isometric town.');
      expect(note).not.toContain('Score');
      expect(note).toContain('design document');
    });

    it('says the document is missing when no GDD_ variable exists', () => {
      project
        .getVariables()
        .insertNew('Score', 0)
        .setValue(1);

      const note = buildGddContextNote(project);
      expect(note).toContain('has not been written');
    });
  });
});
