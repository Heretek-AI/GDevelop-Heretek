// @flow
import {
  isSpawnAgentCall,
  parseSpawnAgentArgs,
  buildGddContextNote,
} from './SpawnSubAgents';

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
