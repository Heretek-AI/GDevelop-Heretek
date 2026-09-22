// @flow

import * as React from 'react';
import { type AiRequest } from '../../Utils/GDevelopServices/Generation';
import { type EditorFunctionCallResult } from '../../EditorFunctions';
import {
  getAllSubAgentFunctionCalls,
  getLatestActivePlan,
} from '../AiRequestUtils';
import {
  isSubAgentFinished,
  buildSubAgentReport,
  getSubAgentReportLabel,
  getSubAgentRoleId,
} from './FinalizeSubAgents';
import {
  buildPlanOutput,
  patchPlanTask,
  getNextReadyTask,
  type StudioPlanTask,
} from './PlanStore';
import { isSpawnAgentCall, parseSpawnAgentArgs } from './SpawnSubAgents';

type ActiveSubAgent = {|
  parentAiRequestId: string,
  callId: string,
|};

/**
 * How many sub-agents this hook may finalize in one pass. The pass runs on every
 * render, so an unbounded loop over a large fleet would stall the chat.
 */
const MAX_FINALIZATIONS_PER_PASS = 8;

/**
 * Flip the plan task a spawn call named to `done`, and the next ready task to
 * `in_progress`.
 *
 * The plan message already in the parent's output is rewritten in place - same
 * `call_id`, new JSON - rather than appended to: the plan tool call's own result
 * is that message, and `getLatestActivePlan` reads the last output carrying
 * `.plan.tasks`, so rewriting it keeps the transcript consistent and needs no
 * new tool call the model never made.
 *
 * The tasks are patched, not rebuilt: rebuilding strips the fields the writer
 * does not model (see `PlanStore.patchPlanTask`).
 *
 * Returns the new output array, or null when there is nothing to change.
 */
export const buildPlanStatusUpdateOutput = (
  parentRequest: AiRequest,
  callId: string
): ?Array<any> => {
  const plan = getLatestActivePlan(parentRequest);
  if (!plan || !Array.isArray(plan.tasks)) return null;
  const tasks: Array<StudioPlanTask> = (plan.tasks: any);
  if (tasks.length === 0) return null;

  const spawnCall = getAllSubAgentFunctionCalls({
    aiRequest: parentRequest,
  }).find(functionCall => functionCall.call_id === callId);
  if (!spawnCall || !isSpawnAgentCall(spawnCall)) return null;
  const parsedArgs = parseSpawnAgentArgs(spawnCall);
  const relatedTaskId = parsedArgs ? parsedArgs.relatedTaskId : null;
  if (!relatedTaskId) return null;
  if (!tasks.some(task => task && task.id === relatedTaskId)) return null;

  let patchedTasks = patchPlanTask(tasks, relatedTaskId, { status: 'done' });
  const nextReadyTask = getNextReadyTask(patchedTasks);
  if (nextReadyTask) {
    patchedTasks = patchPlanTask(patchedTasks, nextReadyTask.id, {
      status: 'in_progress',
    });
  }

  const planOutput = JSON.stringify(buildPlanOutput(patchedTasks));
  const output = parentRequest.output || [];

  // Find the message the plan lives in, from the end, exactly as
  // `getLatestActivePlan` does.
  for (let i = output.length - 1; i >= 0; i--) {
    const message = output[i];
    if (message.type !== 'function_call_output' || !message.output) continue;
    try {
      const parsed = JSON.parse(message.output);
      if (parsed && parsed.plan && parsed.plan.tasks) {
        const updatedOutput = [...output];
        updatedOutput[i] = { ...message, output: planOutput };
        return updatedOutput;
      }
    } catch (error) {
      // Ignore parse errors, like `getLatestActivePlan` does.
    }
  }
  return null;
};

/**
 * The studio runtime: closes the loop between a spawned sub-agent and its parent.
 *
 * A child `AiRequest` is polled and driven by the shared machinery
 * (`AiRequestContext` + `useProcessFunctionCalls`), exactly like a hosted
 * sub-agent. What is missing under BYOK is the write-back: the hosted backend
 * posts a `function_call_output` for the sub-agent's call when its sub-agent is
 * done, and the client only reacts to it. This hook does that write locally -
 *
 *  1. wait until the child has nothing left to do (`isSubAgentFinished`);
 *  2. flip the plan task the spawn call named to `done`, and the next ready task
 *     to `in_progress`, patching the raw tasks so nothing else is lost;
 *  3. post the child's report as its call's `function_call_output`, which the
 *     shared BYOK path turns into the parent's next model turn and which
 *     `removeSubAgentIfDone` reads to retire the child.
 *
 * A sub-agent cannot spawn a sub-agent: `spawn_agent` is not in any sub-agent
 * role's tool subset (`Roles.getToolsForRole`), so the recursion depth is one.
 */
export const useStudioRuntime = ({
  aiRequests,
  activeSubAgents,
  getEditorFunctionCallResults,
  updateAiRequest,
  onSendEditorFunctionCallResults,
  enqueueRequestWrite,
}: {|
  aiRequests: { [string]: AiRequest },
  activeSubAgents: { [string]: ActiveSubAgent },
  getEditorFunctionCallResults: string => Array<EditorFunctionCallResult> | null,
  updateAiRequest: (
    aiRequestId: string,
    updateFn: (previousAiRequest: ?AiRequest) => AiRequest
  ) => void,
  onSendEditorFunctionCallResults: (
    aiRequestId: string,
    editorFunctionCallResults: Array<EditorFunctionCallResult>,
    options: Object
  ) => Promise<boolean>,
  /**
   * Runs a write once the request is free (see `RequestWriteGate`). Optional so
   * the hook can be used without the gate; the write then runs immediately.
   */
  enqueueRequestWrite?: (
    aiRequestId: string,
    write: () => Promise<void>
  ) => Promise<void>,
|}): void => {
  // Call ids already finalized in this session. Without it, a render landing
  // between writing the output and the parent's state propagating would finalize
  // the same agent twice, and the parent would take two turns for one agent.
  const finalizedCallIdsRef = React.useRef<Set<string>>(new Set());
  // The pass awaits a message send, so a second pass can start before the first
  // finished. Serialize them.
  const isRunningRef = React.useRef<boolean>(false);

  React.useEffect(
    () => {
      if (isRunningRef.current) return;

      const subAgentIds = Object.keys(activeSubAgents);
      if (subAgentIds.length === 0) return;

      const pendingFinalizations: Array<{|
        subAgentRequest: AiRequest,
        parentAiRequestId: string,
        callId: string,
      |}> = [];

      for (const subAgentId of subAgentIds) {
        if (pendingFinalizations.length >= MAX_FINALIZATIONS_PER_PASS) break;
        const subAgentInfo = activeSubAgents[subAgentId];
        if (!subAgentInfo) continue;
        // Already finalized in an earlier pass.
        if (finalizedCallIdsRef.current.has(subAgentInfo.callId)) continue;

        const subAgentRequest = aiRequests[subAgentId];
        if (!subAgentRequest) continue;
        // A hosted sub-agent is retired by the server, never finalized here.
        if (!getSubAgentRoleId({ aiRequest: subAgentRequest, aiRequests })) {
          continue;
        }
        const parentRequest = aiRequests[subAgentInfo.parentAiRequestId];
        if (!parentRequest) continue;

        // The parent already carries this call's output: the child is on its way
        // out (`removeSubAgentIfDone` is what removes it). Stay compatible.
        const parentOutput = parentRequest.output || [];
        const parentAlreadyHasOutput = parentOutput.some(
          message =>
            message.type === 'function_call_output' &&
            message.call_id === subAgentInfo.callId
        );
        if (parentAlreadyHasOutput) continue;

        if (
          !isSubAgentFinished({
            subAgentRequest,
            editorFunctionCallResults: getEditorFunctionCallResults(subAgentId),
          })
        ) {
          continue;
        }

        pendingFinalizations.push({
          subAgentRequest,
          parentAiRequestId: subAgentInfo.parentAiRequestId,
          callId: subAgentInfo.callId,
        });
      }

      if (pendingFinalizations.length === 0) return;

      isRunningRef.current = true;
      (async () => {
        const startedCallIds: Array<string> = [];
        try {
          for (const {
            subAgentRequest,
            parentAiRequestId,
            callId,
          } of pendingFinalizations) {
            // Mark it before any await: a pass landing during the await must not
            // pick the same call up again.
            finalizedCallIdsRef.current.add(callId);
            startedCallIds.push(callId);
            if (finalizedCallIdsRef.current.size > 500) {
              // Bound the guard like the other in-flight sets of the AI path.
              finalizedCallIdsRef.current.clear();
              finalizedCallIdsRef.current.add(callId);
            }
            console.info(
              `[studio] finalizing sub-agent #${
                subAgentRequest.id
              } for call ${callId}.`
            );

            const parentRequest = aiRequests[parentAiRequestId];
            if (parentRequest) {
              const writePlan = async () => {
                updateAiRequest(parentAiRequestId, currentRequest => {
                  const base =
                    currentRequest ||
                    ({
                      id: parentAiRequestId,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      userId: 'local-byok-user',
                      status: 'ready',
                      error: null,
                      output: [],
                    }: any);
                  // Recompute inside the updater: two finalizations in one pass
                  // would otherwise write the first snapshot twice.
                  const updated = buildPlanStatusUpdateOutput(base, callId);
                  return updated ? { ...base, output: updated } : base;
                });
              };
              if (enqueueRequestWrite) {
                // Fire-and-forget: a blocked gate write no longer settles
                // inline, so awaiting it would freeze every later finalization
                // behind `isRunningRef`.
                enqueueRequestWrite(parentAiRequestId, writePlan).catch(
                  error => {
                    if (error.code === 'superseded') {
                      console.info('[studio] plan write superseded');
                    } else {
                      console.error(
                        '[studio] error while writing the plan update:',
                        error
                      );
                    }
                  }
                );
              } else {
                await writePlan();
              }
            }

            const label = getSubAgentReportLabel({
              aiRequest: subAgentRequest,
              aiRequests,
            });
            const sent = await onSendEditorFunctionCallResults(
              parentAiRequestId,
              [
                {
                  status: 'finished',
                  call_id: callId,
                  success: true,
                  output: {
                    message: `Report from the ${label}:\n\n${buildSubAgentReport(
                      subAgentRequest,
                      aiRequests
                    )}`,
                  },
                },
              ],
              {}
            );
            // Report delivery is not droppable: throw so the `catch` retries
            // (it deletes `startedCallIds`, so the next pass redoes this).
            if (!sent) throw new Error('Sub-agent report was not sent.');
          }
        } catch (error) {
          console.error('[studio] error while finalizing a sub-agent:', error);
          // Let the next pass retry: a failed write must not be marked done.
          startedCallIds.forEach(callId =>
            finalizedCallIdsRef.current.delete(callId)
          );
        } finally {
          isRunningRef.current = false;
        }
      })();
    },
    [
      aiRequests,
      activeSubAgents,
      getEditorFunctionCallResults,
      updateAiRequest,
      onSendEditorFunctionCallResults,
      enqueueRequestWrite,
    ]
  );
};
