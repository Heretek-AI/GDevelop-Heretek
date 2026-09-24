// @flow

import { type StudioPlanTask } from './PlanStore';

/**
 * When the local studio's manager has stalled: it produced a plan, then ended
 * its turn with an actionable task still undelegated (and no sub-agent running),
 * so the multi-agent loop would sit idle forever under BYOK.
 *
 * This is the decision half of `useStudioNudge`, kept pure and dependency-light
 * (`PlanStore`'s types only) so it can be unit-tested. The caller supplies the
 * facts it already has: whether the request is the top-level manager, whether a
 * turn is in flight, how many sub-agents are live and how many spawn calls are
 * still unanswered.
 *
 * The nudge is deliberately conservative:
 *  - only the top-level manager (never a sub-agent);
 *  - never while a turn is in flight or work is pending;
 *  - never with a live or unanswered sub-agent;
 *  - never twice for the same plan state (the caller passes the signature it
 *    already nudged), so a stalled plan is nudged once, not every render;
 *  - a suspended/errored request is left alone (the user may have stopped it).
 */
export type StudioNudgeInput = {|
  /** True for the top-level manager request (no parent, no studio role). */
  isTopLevel: boolean,
  status: string,
  hasWorkInProgress: boolean,
  isSending: boolean,
  liveSubAgentCount: number,
  pendingSubAgentCallCount: number,
  /** Non-null only when an actionable (pending/in_progress) task exists. */
  planSignature: string | null,
  previouslyNudgedSignature: string | null,
  /**
   * True only for a request touched recently. Opening an old, abandoned chat
   * must not resurrect its plan and spend tokens.
   */
  isRecent: boolean,
|};

export const shouldNudgeStudioManager = (input: StudioNudgeInput): boolean => {
  if (!input.isTopLevel) return false;
  if (!input.isRecent) return false;
  if (input.status === 'suspended' || input.status === 'error') return false;
  if (input.isSending) return false;
  if (input.hasWorkInProgress) return false;
  if (input.liveSubAgentCount > 0) return false;
  if (input.pendingSubAgentCallCount > 0) return false;
  if (!input.planSignature) return false;
  return input.planSignature !== input.previouslyNudgedSignature;
};

/**
 * A stable signature of a plan's actionable state: the ids and statuses of the
 * tasks that still need attention, in order. Null when there is no plan or
 * nothing is actionable (every task is done or voided).
 *
 * `agentCallId` is included so a task that was delegated (but whose status has
 * not flipped yet) is still distinguishable; a status-only signature would
 * miss it only in the window before the spawn is stamped.
 */
export const getActionablePlanSignature = (
  tasks: Array<StudioPlanTask> | null | void
): string | null => {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const actionable = tasks.filter(
    task =>
      task &&
      typeof task === 'object' &&
      (task.status === 'pending' || task.status === 'in_progress')
  );
  if (actionable.length === 0) return null;
  return actionable
    .map(task => `${task.id}:${task.status}:${task.agentCallId || ''}`)
    .join('|');
};

/**
 * The follow-up message the nudge sends to the stalled manager. Written as the
 * user so it flows through the existing send path unchanged, and prefixed so
 * the transcript makes clear it was the studio, not the person.
 */
export const buildStudioNudgeMessage = (
  nextReadyTask: StudioPlanTask | null
): string => {
  const taskHint = nextReadyTask
    ? ` Next ready task: ${nextReadyTask.id} (${nextReadyTask.title}).`
    : '';
  return (
    '[Automatic reminder from the studio] Your plan still has a task that is ' +
    `not delegated.${taskHint} Call spawn_agent for it now, or report plainly ` +
    'why it cannot be done. Do not answer with prose only.'
  );
};
