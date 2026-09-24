// @flow

/**
 * The local plan store: the shape `create_or_update_plan` writes and the studio
 * reads back.
 *
 * The plan shape itself is upstream's (`AiRequestPlan` / `AiRequestPlanTask` in
 * `Utils/GDevelopServices/Generation.js`), and so is the reading half:
 * `AiRequestUtils.getLatestActivePlan` pulls the last `function_call_output`
 * whose JSON has `.plan.tasks`, and `AiRequestChat/OrchestratorPlan.js` renders
 * it. This module only builds that exact shape and answers questions about it,
 * so the hosted and BYOK paths return the same thing for the same tool.
 */

export type StudioPlanTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'voided';

export type StudioPlanTask = {|
  id: string,
  title: string,
  description: string,
  status: StudioPlanTaskStatus,
  dependsOn?: Array<string>,
  /**
   * Set by the studio when the task is delegated, so the plan row can be linked
   * to the sub-agent's function call (matches
   * `AiRequestMessageAssistantFunctionCall.taskId`).
   */
  agentCallId?: string,
|};

const PLAN_TASK_STATUSES: Array<StudioPlanTaskStatus> = [
  'pending',
  'in_progress',
  'done',
  'voided',
];

export const isStudioPlanTaskStatus = (value: any): boolean =>
  typeof value === 'string' && PLAN_TASK_STATUSES.includes((value: any));

/**
 * The output of `create_or_update_plan`: the exact nesting
 * `getLatestActivePlan` parses (`output.plan.tasks`).
 */
export const buildPlanOutput = (tasks: Array<StudioPlanTask>): Object => ({
  success: true,
  plan: { tasks },
});

/** Read a task array back out of a plan tool's output. Null when malformed. */
export const getPlanFromOutput = (output: Object): ?Array<StudioPlanTask> => {
  if (!output || typeof output !== 'object') return null;
  const plan: any = (output: any).plan;
  if (!plan || typeof plan !== 'object') return null;
  const tasks: any = plan.tasks;
  if (!Array.isArray(tasks)) return null;
  return tasks;
};

/**
 * True when every id in `dependsOn` names a task that is done. An id matching no
 * task is NOT satisfied: a dependency on missing work is not met.
 */
export const areTaskDependenciesSatisfied = (
  task: StudioPlanTask,
  tasks: Array<StudioPlanTask>
): boolean => {
  const doneIds = new Set(
    tasks
      // A null/scalar entry is reachable: plan tasks come from model-authored
      // JSON and persisted output, neither shape-validated per element.
      .filter(
        otherTask =>
          otherTask &&
          typeof otherTask === 'object' &&
          otherTask.status === 'done'
      )
      .map(otherTask => otherTask.id)
  );
  return (task.dependsOn || []).every(dependencyId =>
    doneIds.has(dependencyId)
  );
};

/** The first pending task whose dependencies are satisfied, or null. */
export const getNextReadyTask = (
  tasks: Array<StudioPlanTask>
): ?StudioPlanTask =>
  tasks.find(
    task =>
      task &&
      typeof task === 'object' &&
      task.status === 'pending' &&
      areTaskDependenciesSatisfied(task, tasks)
  ) || null;

/**
 * Fold `incoming` tasks over `existing`, matching by `id`.
 *
 * The result is `incoming` — its order and its membership, so a task dropped
 * from the list is gone. What survives are the fields on the matching existing
 * task that `incoming` does not mention. A field the caller DOES send wins,
 * including an explicit null: that is how a field is cleared. A task without a
 * string id passes through untouched.
 *
 * Ported from munder-difflin's `mergeTaskLedger` (`src/shared/taskLedger.ts`),
 * which exists because a writer holding a partial model of a card silently
 * deleted every field it did not know about.
 */
export const mergePlanTasks = (
  existing: Array<StudioPlanTask>,
  incoming: Array<StudioPlanTask>
): Array<StudioPlanTask> => {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const byId = new Map<string, any>();
  for (const task of existingList) {
    if (task && typeof task.id === 'string' && task.id && !byId.has(task.id)) {
      byId.set(task.id, task);
    }
  }
  return incomingList.map((task: any) => {
    if (!task || typeof task.id !== 'string' || !task.id) return task;
    const prior = byId.get(task.id);
    return prior ? { ...prior, ...task } : task;
  });
};

/**
 * Fold the plan inside a finished tool result's `output` over the plan the
 * request already has. `output` is the object `EditorFunctionCallRunner`
 * builds (`{ success, meta, ...output }`), so it is read as an object - never
 * parsed. A result without a plan, or a non-success one, passes through
 * untouched.
 */
export const mergePlanResultOutput = (
  result: Object,
  existingTasks: Array<StudioPlanTask> | null
): Object => {
  if (result.status !== 'finished' || !result.success) return result;
  const output: any = result.output;
  if (!output || !output.plan || !Array.isArray(output.plan.tasks)) {
    return result;
  }
  if (!existingTasks) return result;
  return {
    ...result,
    output: {
      ...output,
      plan: { tasks: mergePlanTasks(existingTasks, output.plan.tasks) },
    },
  };
};

/**
 * Apply `patch` to one task, leaving every other task — and every other field of
 * the patched task — untouched.
 *
 * This is what a status flip must use. Rebuilding the task array from a model
 * strips whatever fields the model does not know about (`agentCallId`,
 * `description`, a future field), which is exactly what
 * `patchTaskInLedger` exists to prevent in munder-difflin
 * (`src/shared/taskLedger.ts`).
 */
export const patchPlanTask = (
  tasks: Array<StudioPlanTask>,
  taskId: string,
  patch: Partial<StudioPlanTask>
): Array<StudioPlanTask> => {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map(task =>
    task && task.id === taskId ? { ...task, ...patch } : task
  );
};

export type StudioPlanTaskValidation =
  | {| success: true, tasks: Array<StudioPlanTask> |}
  | {| success: false, message: string |};

const describeValue = (value: any): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
};

/**
 * Validate the `tasks` argument of `create_or_update_plan` as a local model
 * sent it, naming the first offending index. A model mistake becomes a normal
 * failed tool call, never a thrown error inside the editor.
 */
// Bounds on a plan the model sends, so a runaway tool call cannot flood the
// store (W12).
const MAX_PLAN_TASKS = 32;
const MAX_PLAN_TASK_ID_LENGTH = 64;
const MAX_PLAN_TASK_TITLE_LENGTH = 200;
const MAX_PLAN_TASK_DESCRIPTION_LENGTH = 1000;

const ALLOWED_TASK_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'dependsOn',
  'agentCallId',
];

export const validatePlanTasks = (rawTasks: any): StudioPlanTaskValidation => {
  if (!Array.isArray(rawTasks)) {
    return {
      success: false,
      message: 'create_or_update_plan requires a tasks array.',
    };
  }
  if (rawTasks.length > MAX_PLAN_TASKS) {
    return {
      success: false,
      message: `create_or_update_plan accepts at most ${MAX_PLAN_TASKS} tasks, got ${
        rawTasks.length
      }.`,
    };
  }

  const tasks: Array<StudioPlanTask> = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < rawTasks.length; index++) {
    const rawTask = rawTasks[index];
    const invalid = (detail: string): StudioPlanTaskValidation => ({
      success: false,
      message: `Invalid plan task at index ${index}: ${detail}`,
    });

    if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) {
      return invalid(`expected an object, got ${describeValue(rawTask)}.`);
    }
    // Fail closed (I11): a field this validator does not model would be
    // silently dropped by a rebuild, so reject the whole task instead.
    for (const key of Object.keys(rawTask)) {
      if (!ALLOWED_TASK_FIELDS.includes(key)) {
        return invalid(`unexpected field ${JSON.stringify(key)}.`);
      }
    }
    if ('agentCallId' in rawTask && typeof rawTask.agentCallId !== 'string') {
      return invalid(
        `\`agentCallId\` must be a string when present, got ${describeValue(
          rawTask.agentCallId
        )}.`
      );
    }
    if (typeof rawTask.id !== 'string' || !rawTask.id.trim()) {
      return invalid(
        `\`id\` must be a non-empty string, got ${describeValue(rawTask.id)}.`
      );
    }
    // Validate and store the trimmed id (I12); every later match is on it.
    const id = rawTask.id.trim();
    if (id.length > MAX_PLAN_TASK_ID_LENGTH) {
      return invalid(
        `\`id\` must be at most ${MAX_PLAN_TASK_ID_LENGTH} characters.`
      );
    }
    if (seenIds.has(id)) {
      return invalid(`duplicate \`id\` ${JSON.stringify(id)}.`);
    }
    seenIds.add(id);
    if (typeof rawTask.title !== 'string' || !rawTask.title.trim()) {
      return invalid(
        `\`title\` must be a non-empty string, got ${describeValue(
          rawTask.title
        )}.`
      );
    }
    if (rawTask.title.trim().length > MAX_PLAN_TASK_TITLE_LENGTH) {
      return invalid(
        `\`title\` must be at most ${MAX_PLAN_TASK_TITLE_LENGTH} characters.`
      );
    }
    if (
      typeof rawTask.description !== 'string' ||
      !rawTask.description.trim()
    ) {
      return invalid(
        `\`description\` must be a non-empty string, got ${describeValue(
          rawTask.description
        )}.`
      );
    }
    if (rawTask.description.trim().length > MAX_PLAN_TASK_DESCRIPTION_LENGTH) {
      return invalid(
        `\`description\` must be at most ${MAX_PLAN_TASK_DESCRIPTION_LENGTH} characters.`
      );
    }
    if (!isStudioPlanTaskStatus(rawTask.status)) {
      return invalid(
        `\`status\` must be one of ${PLAN_TASK_STATUSES.join(
          ', '
        )}, got ${describeValue(rawTask.status)}.`
      );
    }
    const rawDependsOn: any = rawTask.dependsOn;
    let dependsOn: Array<string>;
    if (rawDependsOn == null) {
      dependsOn = [];
    } else if (
      Array.isArray(rawDependsOn) &&
      rawDependsOn.every((id: any) => typeof id === 'string')
    ) {
      dependsOn = rawDependsOn.map((dependencyId: any) => dependencyId.trim());
    } else {
      return invalid(
        `\`dependsOn\` must be an array of strings, got ${describeValue(
          rawDependsOn
        )}.`
      );
    }

    const task: StudioPlanTask = {
      id,
      title: rawTask.title,
      description: rawTask.description,
      status: (rawTask.status: StudioPlanTaskStatus),
    };
    // `dependsOn` is set only when the caller sent it (W11): a re-plan that
    // omits it must not clear dependencies another writer set.
    if (rawDependsOn != null) {
      task.dependsOn = dependsOn;
    }
    if (typeof rawTask.agentCallId === 'string') {
      task.agentCallId = rawTask.agentCallId;
    }
    tasks.push(task);
  }

  return { success: true, tasks };
};
