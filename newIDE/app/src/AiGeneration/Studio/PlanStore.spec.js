// @flow
import {
  buildPlanOutput,
  getPlanFromOutput,
  areTaskDependenciesSatisfied,
  getNextReadyTask,
  validatePlanTasks,
  mergePlanTasks,
  patchPlanTask,
} from './PlanStore';
import { getLatestActivePlan } from '../AiRequestUtils';

const makeTask = (overrides: Object) => ({
  id: 'task-1',
  title: 'Build the town grid',
  description: 'A 20x20 tile grid with roads.',
  status: 'pending',
  dependsOn: [],
  ...overrides,
});

describe('PlanStore', () => {
  describe('buildPlanOutput / getPlanFromOutput', () => {
    it('round-trips through getLatestActivePlan', () => {
      const tasks = [
        makeTask({ id: 'gdd', title: 'Write the GDD', status: 'done' }),
        makeTask({ id: 'grid', title: 'Build the grid', dependsOn: ['gdd'] }),
      ];

      const aiRequest: any = {
        output: [
          {
            type: 'function_call_output',
            call_id: 'c',
            output: JSON.stringify(buildPlanOutput(tasks)),
          },
        ],
      };

      const plan = getLatestActivePlan(aiRequest);
      expect(plan).not.toBeNull();
      expect(plan && plan.tasks).toEqual(tasks);
    });

    it('returns the tasks a plan output holds', () => {
      const tasks = [makeTask({})];
      expect(getPlanFromOutput(buildPlanOutput(tasks))).toEqual(tasks);
    });

    it('returns null for every malformed output', () => {
      // $FlowFixMe[incompatible-call]
      expect(getPlanFromOutput(null)).toBeNull();
      // $FlowFixMe[incompatible-call]
      expect(getPlanFromOutput(undefined)).toBeNull();
      // $FlowFixMe[incompatible-call]
      expect(getPlanFromOutput('not an object')).toBeNull();
      expect(getPlanFromOutput({})).toBeNull();
      expect(getPlanFromOutput({ plan: null })).toBeNull();
      expect(getPlanFromOutput({ plan: {} })).toBeNull();
      expect(getPlanFromOutput({ plan: { tasks: null } })).toBeNull();
      expect(getPlanFromOutput({ plan: { tasks: 'nope' } })).toBeNull();
      expect(getPlanFromOutput({ plan: { tasks: {} } })).toBeNull();
      expect(getPlanFromOutput({ success: false, message: 'nope' })).toBeNull();
    });
  });

  describe('dependencies', () => {
    it('is satisfied only when every dependency is done', () => {
      const doneTask = makeTask({ id: 'a', status: 'done' });
      const pendingTask = makeTask({ id: 'b', status: 'pending' });

      expect(
        areTaskDependenciesSatisfied(makeTask({ dependsOn: [] }), [doneTask])
      ).toBe(true);
      expect(
        areTaskDependenciesSatisfied(makeTask({ dependsOn: ['a'] }), [doneTask])
      ).toBe(true);
      expect(
        areTaskDependenciesSatisfied(makeTask({ dependsOn: ['b'] }), [
          pendingTask,
        ])
      ).toBe(false);
      expect(
        areTaskDependenciesSatisfied(makeTask({ dependsOn: ['a', 'b'] }), [
          doneTask,
          pendingTask,
        ])
      ).toBe(false);
    });

    it('treats a dependency on a missing task as unsatisfied', () => {
      expect(
        areTaskDependenciesSatisfied(makeTask({ dependsOn: ['ghost'] }), [
          makeTask({ id: 'a', status: 'done' }),
        ])
      ).toBe(false);
    });

    it('treats a voided dependency as unsatisfied', () => {
      expect(
        areTaskDependenciesSatisfied(makeTask({ dependsOn: ['a'] }), [
          makeTask({ id: 'a', status: 'voided' }),
        ])
      ).toBe(false);
    });
  });

  describe('getNextReadyTask', () => {
    it('returns the first pending task whose dependencies are satisfied', () => {
      const tasks = [
        makeTask({ id: 'a', status: 'done' }),
        makeTask({ id: 'b', status: 'pending', dependsOn: ['a'] }),
        makeTask({ id: 'c', status: 'pending', dependsOn: ['b'] }),
      ];
      const readyB = getNextReadyTask(tasks);
      expect(readyB && readyB.id).toBe('b');
    });

    it('skips a task whose dependency is not done, and a task already started', () => {
      const tasks = [
        makeTask({ id: 'a', status: 'pending' }),
        makeTask({ id: 'b', status: 'in_progress' }),
        makeTask({ id: 'c', status: 'pending', dependsOn: ['b'] }),
        makeTask({ id: 'd', status: 'pending' }),
      ];
      const readyA = getNextReadyTask(tasks);
      expect(readyA && readyA.id).toBe('a');
    });

    it('returns null when nothing is ready', () => {
      expect(
        getNextReadyTask([
          makeTask({ id: 'a', status: 'done' }),
          makeTask({ id: 'b', status: 'pending', dependsOn: ['a', 'zz'] }),
        ])
      ).toBeNull();
      expect(getNextReadyTask([])).toBeNull();
    });
  });

  describe('validatePlanTasks', () => {
    it('accepts a well-formed plan and defaults dependsOn to an empty array', () => {
      const result = validatePlanTasks([
        {
          id: 'a',
          title: 'Write the GDD',
          description: 'Sections: overview, economy.',
          status: 'pending',
        },
      ]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.tasks[0].dependsOn).toEqual([]);
        expect(result.tasks[0].status).toBe('pending');
      }
    });

    it('rejects a non-array', () => {
      const result = validatePlanTasks(undefined);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toBe(
          'create_or_update_plan requires a tasks array.'
        );
      }
    });

    it('rejects a malformed task, naming its index', () => {
      const valid = {
        id: 'a',
        title: 'Ok',
        description: 'Ok.',
        status: 'pending',
      };
      const result = validatePlanTasks([
        valid,
        { id: '', title: 'No id', description: 'x', status: 'pending' },
      ]);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('index 1');
        expect(result.message).toContain('`id`');
      }
    });

    it('rejects an unknown status and a non-string dependsOn', () => {
      const bad = validatePlanTasks([
        { id: 'a', title: 'T', description: 'D', status: 'later' },
      ]);
      expect(bad.success).toBe(false);
      if (!bad.success) expect(bad.message).toContain('`status`');

      const bad2 = validatePlanTasks([
        {
          id: 'a',
          title: 'T',
          description: 'D',
          status: 'pending',
          dependsOn: [1, 2],
        },
      ]);
      expect(bad2.success).toBe(false);
      if (!bad2.success) expect(bad2.message).toContain('`dependsOn`');
    });
  });

  describe('mergePlanTasks', () => {
    it('keeps a field the writer never mentioned', () => {
      const existing: any = [
        makeTask({ id: 'a', agentCallId: 'call-1', description: 'Original.' }),
      ];
      const incoming: any = [makeTask({ id: 'a', status: 'in_progress' })];

      const merged = mergePlanTasks(existing, incoming);
      expect(merged[0].agentCallId).toBe('call-1');
      // An unmentioned field keeps its existing value; the sent field wins.
      expect(merged[0].status).toBe('in_progress');
    });

    it('lets an explicit null clear a field and a missing key not clear it', () => {
      const existing: any = [makeTask({ id: 'a', agentCallId: 'call-1' })];
      const cleared: any = mergePlanTasks(existing, [
        { ...makeTask({ id: 'a' }), agentCallId: null },
      ]);
      expect(cleared[0].agentCallId).toBeNull();

      const untouched: any = mergePlanTasks(existing, [makeTask({ id: 'a' })]);
      expect(untouched[0].agentCallId).toBe('call-1');
    });

    it('takes the incoming order and membership, so a dropped task is gone', () => {
      const existing: any = [
        makeTask({ id: 'a' }),
        makeTask({ id: 'b' }),
        makeTask({ id: 'c' }),
      ];
      const merged = mergePlanTasks(existing, [
        makeTask({ id: 'c' }),
        makeTask({ id: 'a' }),
      ]);
      expect(merged.map(task => task.id)).toEqual(['c', 'a']);
    });

    it('passes an id-less task through untouched', () => {
      const idLess: any = { title: 'Hand-written', status: 'pending' };
      const merged: any = mergePlanTasks([makeTask({ id: 'a' })], [idLess]);
      expect(merged[0]).toBe(idLess);
    });

    it('adds a task that has no existing counterpart', () => {
      const merged = mergePlanTasks(
        [makeTask({ id: 'a' })],
        [makeTask({ id: 'b', title: 'New' })]
      );
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('b');
    });
  });

  describe('patchPlanTask', () => {
    it('leaves a sibling task byte-identical, including its agentCallId', () => {
      const tasks: any = [
        makeTask({ id: 'a', status: 'in_progress', agentCallId: 'call-1' }),
        makeTask({
          id: 'b',
          description: 'A description the writer wrote.',
          agentCallId: 'call-2',
        }),
      ];
      const patched: any = patchPlanTask(tasks, 'a', { status: 'done' });

      expect(patched[0].status).toBe('done');
      // The sibling is the same object: nothing was rebuilt.
      expect(patched[1]).toBe(tasks[1]);
      expect(patched[1].agentCallId).toBe('call-2');
      expect(patched[1].description).toBe('A description the writer wrote.');
      // The patched task keeps the fields the patch did not mention.
      expect(patched[0].agentCallId).toBe('call-1');
    });

    it('is a no-op for an unknown id and for a non-array', () => {
      const tasks: any = [makeTask({ id: 'a' })];
      const patched: any = patchPlanTask(tasks, 'ghost', { status: 'done' });
      // Same task objects, unchanged.
      expect(patched).toEqual(tasks);
      expect(patched[0]).toBe(tasks[0]);
      // A non-array is tolerated at runtime.
      expect(patchPlanTask((null: any), 'a', { status: 'done' })).toEqual([]);
    });

    it('survives a round-trip through buildPlanOutput and getPlanFromOutput', () => {
      const tasks: any = [
        makeTask({ id: 'a', status: 'in_progress' }),
        makeTask({ id: 'b', agentCallId: 'call-2' }),
      ];
      const patched: any = patchPlanTask(tasks, 'a', { status: 'done' });
      const reread: any = getPlanFromOutput(buildPlanOutput(patched));
      expect(reread).toEqual(patched);
    });
  });
});
