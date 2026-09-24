// @flow

import { makeSimplifiedProjectBuilder } from '../../EditorFunctions/SimplifiedProject/SimplifiedProject';
import { customCreateSubAgentAiRequest } from '../../AI/CustomAIClient';
import { isSpawnableRoleId, type StudioRoleId } from './Roles';
import {
  type AiRequest,
  type AiRequestMessageAssistantFunctionCall,
} from '../../Utils/GDevelopServices/Generation';
import { truncateAtCodePointBoundary } from './SafeTruncation';

const gd: libGDevelop = global.gd;

/** Cap on live sub-agents one parent may have (W8). */
export const MAX_SUB_AGENTS_PER_PARENT = 8;

/**
 * Live sub-agents of a parent: launched calls (stamped with
 * `subAgentAiRequestId`) with no `function_call_output` for their call yet,
 * whose child request still exists in storage.
 *
 * Finished children stay in storage (they are history), so counting every
 * stored child turned the fan-out cap into a lifetime cap: after
 * MAX_SUB_AGENTS_PER_PARENT spawns ever, no later task could ever be
 * delegated again. Pruned or deleted children free their slot.
 */
export const countLiveSubAgentsForParent = (
  parentAiRequest: AiRequest,
  aiRequests: { [string]: AiRequest }
): number => {
  const output = (parentAiRequest && parentAiRequest.output) || [];
  const answeredCallIds = new Set<string>();
  const launchedChildren = new Map<string, string>();
  output.forEach((message: any) => {
    if (!message || typeof message !== 'object') return;
    if (
      message.type === 'function_call_output' &&
      typeof message.call_id === 'string'
    ) {
      answeredCallIds.add(message.call_id);
      return;
    }
    if (
      message.type === 'message' &&
      message.role === 'assistant' &&
      Array.isArray(message.content)
    ) {
      message.content.forEach((entry: any) => {
        if (!entry || typeof entry !== 'object') return;
        if (
          entry.type === 'function_call' &&
          typeof entry.subAgentAiRequestId === 'string' &&
          typeof entry.call_id === 'string'
        ) {
          launchedChildren.set(entry.subAgentAiRequestId, entry.call_id);
        }
      });
    }
  });
  const requests = aiRequests || {};
  let live = 0;
  launchedChildren.forEach((callId, childId) => {
    if (!requests[childId]) return;
    if (answeredCallIds.has(callId)) return;
    live++;
  });
  return live;
};

/** Whether a function call is the studio's delegation tool. */
export const isSpawnAgentCall = (
  functionCall: AiRequestMessageAssistantFunctionCall
): boolean => functionCall.name === 'spawn_agent';

export type ParsedSpawnAgentArgs = {|
  role: StudioRoleId,
  shortTitle: string,
  task: string,
  context: string,
  relatedTaskId: string | null,
|};

/**
 * Read and validate a `spawn_agent` call's arguments. Null when the call is
 * malformed: the caller then fails the call instead of spawning an agent with
 * half an instruction.
 */
export const parseSpawnAgentArgs = (
  functionCall: AiRequestMessageAssistantFunctionCall
): ?ParsedSpawnAgentArgs => {
  let parsedArguments: any;
  try {
    parsedArguments = JSON.parse(functionCall.arguments);
  } catch (error) {
    return null;
  }
  if (
    !parsedArguments ||
    typeof parsedArguments !== 'object' ||
    Array.isArray(parsedArguments)
  ) {
    return null;
  }

  // The model's own JSON: each field is checked, and anything unexpected makes
  // the whole call invalid (the caller then fails it instead of spawning with
  // half an instruction).
  const role: any = parsedArguments.role;
  if (!isSpawnableRoleId(role)) return null;

  const rawShortTitle: any = parsedArguments.short_title;
  const rawTask: any = parsedArguments.task;
  const rawContext: any = parsedArguments.context;
  const rawRelatedTaskId: any = parsedArguments.related_task_id;

  if (typeof rawShortTitle !== 'string') return null;
  const shortTitle = rawShortTitle.trim();
  if (!shortTitle) return null;

  if (typeof rawTask !== 'string') return null;
  const task = rawTask.trim();
  if (!task) return null;

  // Reject (do not coerce) a present-but-wrongly-typed optional field.
  if (rawContext !== undefined && typeof rawContext !== 'string') return null;
  if (rawRelatedTaskId !== undefined && typeof rawRelatedTaskId !== 'string')
    return null;

  const context = typeof rawContext === 'string' ? rawContext.trim() : '';
  const relatedTaskId =
    typeof rawRelatedTaskId === 'string' && rawRelatedTaskId.trim()
      ? rawRelatedTaskId.trim()
      : null;

  // Reject oversized strings (W6): a runaway argument must not become a child
  // request the user cannot read.
  if (shortTitle.length > 100 || task.length > 4000 || context.length > 4000) {
    return null;
  }

  return { role, shortTitle, task, context, relatedTaskId };
};

/**
 * The `GDD_*` project variables, as a note appended to a sub-agent's context.
 *
 * The designer writes the design document as project variables (it is the only
 * artifact a later role can read), so the developer and the tester are handed
 * them explicitly rather than having to discover them.
 *
 * Project variables live at `globalVariables` on the simplified project (the
 * `properties` object holds resolution and orientation, not variables).
 */
export const buildGddContextNote = (project: ?gdProject): string => {
  if (!project) return '';
  let simplifiedProject: any;
  try {
    simplifiedProject = makeSimplifiedProjectBuilder(gd).getSimplifiedProject(
      project,
      {}
    );
  } catch (error) {
    // A project the simplifier cannot read is not a reason to refuse to spawn:
    // the agent simply gets no design note.
    console.warn(
      'Unable to read the project variables for a sub-agent:',
      error
    );
    return '';
  }

  const projectVariables: Array<any> =
    (simplifiedProject && simplifiedProject.globalVariables) || [];
  const gddVariables = projectVariables.filter(
    variable =>
      variable &&
      typeof variable.variableName === 'string' &&
      variable.variableName.startsWith('GDD_')
  );
  if (gddVariables.length === 0) {
    return 'No GDD_ project variable is set on this project yet: the design document has not been written.';
  }

  const lines = gddVariables.map(
    variable =>
      `- ${variable.variableName}: ${
        typeof variable.value === 'string'
          ? variable.value
          : JSON.stringify(variable.variableChildren || variable.type)
      }`
  );
  const note = `The studio's design document, as GDD_ project variables:\n${lines.join(
    '\n'
  )}`;
  return (
    truncateAtCodePointBoundary(note, 4000) +
    (note.length > 4000 ? '\n…(truncated)' : '')
  );
};

export type SpawnSubAgentResult =
  | {| subAgentAiRequestId: string, shortTitle: string, callId: string |}
  | {| error: string |};

/**
 * Create the child `AiRequest` for one `spawn_agent` call.
 *
 * The caller is responsible for stamping `subAgentAiRequestId` onto the call
 * (see `onStamped`) and for activating the sub-agent; this function only creates
 * the request, so it stays testable without the React context.
 */
export const spawnSubAgent = async ({
  parentAiRequestId,
  functionCall,
  gameProjectJson,
  projectSpecificExtensionsSummaryJson,
  project,
  gddContextNote,
  onStamped,
}: {|
  parentAiRequestId: string,
  functionCall: AiRequestMessageAssistantFunctionCall,
  gameProjectJson: string | null,
  projectSpecificExtensionsSummaryJson: string | null,
  project: ?gdProject,
  // The GDD note, computed once per batch and passed in (W7). When provided it
  // is used verbatim instead of rebuilding the simplified project per call.
  gddContextNote?: string | null,
  onStamped: (subAgentAiRequestId: string) => void,
|}): Promise<SpawnSubAgentResult> => {
  const parsedArgs = parseSpawnAgentArgs(functionCall);
  if (!parsedArgs) {
    return { error: 'Invalid spawn_agent arguments.' };
  }

  let userRequest = `Task: ${parsedArgs.task}`;
  if (parsedArgs.context) {
    userRequest += `\n\nContext: ${parsedArgs.context}`;
  }

  // The developer and the tester need the design document; the designer writes
  // it, so handing it back to the designer would be noise.
  const spawnContextNote =
    parsedArgs.role === 'developer' || parsedArgs.role === 'tester'
      ? gddContextNote != null
        ? gddContextNote
        : buildGddContextNote(project)
      : null;

  const subAgentRequest = await customCreateSubAgentAiRequest({
    parentAiRequestId,
    roleId: parsedArgs.role,
    userRequest,
    gameProjectJson,
    projectSpecificExtensionsSummaryJson,
    spawnContextNote,
  });

  onStamped(subAgentRequest.id);

  return {
    subAgentAiRequestId: subAgentRequest.id,
    shortTitle: parsedArgs.shortTitle,
    callId: functionCall.call_id,
  };
};
