// @flow

import * as React from 'react';
import { type AiRequest } from '../../Utils/GDevelopServices/Generation';
import { type EditorFunctionCallResult } from '../../EditorFunctions';
import {
  aiRequestHasWorkInProgress,
  getLatestActivePlan,
  getPendingSubAgentFunctionCalls,
} from '../AiRequestUtils';
import { getNextReadyTask, type StudioPlanTask } from './PlanStore';
import {
  shouldNudgeStudioManager,
  getActionablePlanSignature,
  buildStudioNudgeMessage,
} from './NudgePolicy';

type ActiveSubAgent = {|
  parentAiRequestId: string,
  callId: string,
|};

/**
 * How long the manager must stay stalled before the nudge is sent. A grace
 * period, not a poll interval: the effect is re-run (and the timer cleared) on
 * every relevant state change, so this only has to outlast the sub-second gap
 * between writing a tool result and the follow-up turn starting.
 */
export const STUDIO_NUDGE_GRACE_MS = 5000;

/** Hard cap on nudges for one request, so a pathological model cannot loop. */
export const MAX_STUDIO_NUDGES_PER_REQUEST = 5;

/**
 * Only a request touched within this window may be nudged. Opening an old,
 * abandoned chat must not resurrect its plan and spend tokens; the window is
 * generous enough that a genuinely-stalled live run is always in range.
 */
export const STUDIO_NUDGE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Keep the local studio's manager moving.
 *
 * Under BYOK nothing resumes a manager that produced a plan and then ended its
 * turn without delegating: the multi-agent loop waits forever. This hook sends
 * at most one continuation per stalled plan state (`NudgePolicy` decides when),
 * with a short grace period so it never races a turn already in flight.
 *
 * It is a no-op for the hosted path and for sub-agent requests (only the
 * top-level, non-role request is nudged) and for a user-stopped request.
 */
export const useStudioNudge = ({
  selectedAiRequest,
  aiRequests,
  activeSubAgents,
  getEditorFunctionCallResults,
  isSendingAiRequest,
  onSendMessage,
}: {|
  selectedAiRequest: ?AiRequest,
  aiRequests: { [string]: AiRequest },
  activeSubAgents: { [string]: ActiveSubAgent },
  getEditorFunctionCallResults: string => Array<EditorFunctionCallResult> | null,
  isSendingAiRequest: (aiRequestId: string | null) => boolean,
  onSendMessage: (options: Object) => Promise<boolean>,
|}): void => {
  // Per-request: the plan state already nudged, and how many nudges were sent.
  const nudgedSignatureByRequestRef = React.useRef<Map<string, string>>(
    new Map()
  );
  const nudgedCountByRequestRef = React.useRef<Map<string, number>>(new Map());

  React.useEffect(
    () => {
      if (!selectedAiRequest) return;
      const aiRequestId = selectedAiRequest.id;

      const isTopLevel =
        !selectedAiRequest.parentAiRequestId && !selectedAiRequest.studioRoleId;
      if (!isTopLevel) return;

      const plan = getLatestActivePlan(selectedAiRequest);
      const tasks: Array<StudioPlanTask> = plan && plan.tasks ? plan.tasks : [];
      const planSignature = getActionablePlanSignature(tasks);
      const liveSubAgentCount = Object.keys(activeSubAgents).filter(
        subAgentId =>
          activeSubAgents[subAgentId] &&
          activeSubAgents[subAgentId].parentAiRequestId === aiRequestId
      ).length;

      const updatedAtMs = Date.parse(selectedAiRequest.updatedAt || '');
      const isRecent =
        Number.isFinite(updatedAtMs) &&
        Date.now() - updatedAtMs <= STUDIO_NUDGE_MAX_AGE_MS;

      const shouldNudge = shouldNudgeStudioManager({
        isTopLevel,
        isRecent,
        status: selectedAiRequest.status,
        hasWorkInProgress: aiRequestHasWorkInProgress(
          selectedAiRequest,
          getEditorFunctionCallResults(aiRequestId)
        ),
        isSending: isSendingAiRequest(aiRequestId),
        liveSubAgentCount,
        pendingSubAgentCallCount: getPendingSubAgentFunctionCalls({
          aiRequest: selectedAiRequest,
        }).length,
        planSignature,
        previouslyNudgedSignature:
          nudgedSignatureByRequestRef.current.get(aiRequestId) || null,
      });
      if (!shouldNudge || !planSignature) return;

      const nudgedCount = nudgedCountByRequestRef.current.get(aiRequestId) || 0;
      if (nudgedCount >= MAX_STUDIO_NUDGES_PER_REQUEST) return;

      const nextReadyTask = getNextReadyTask(tasks);
      const timer = setTimeout(() => {
        // Mark before the send: a re-render landing during the await must not
        // arm a second nudge for the same plan state.
        nudgedSignatureByRequestRef.current.set(aiRequestId, planSignature);
        nudgedCountByRequestRef.current.set(aiRequestId, nudgedCount + 1);
        console.info(
          `[studio] nudging the stalled manager #${aiRequestId} for plan ${planSignature}.`
        );
        // `onSendMessage` can return undefined (its own early-return path), so it
        // is not necessarily a promise and may also throw synchronously.
        Promise.resolve()
          .then(() =>
            onSendMessage({
              aiRequestId,
              userMessage: buildStudioNudgeMessage(nextReadyTask),
            })
          )
          .catch(error => {
            console.error('[studio] error while nudging the manager:', error);
            // Let the next pass retry the same state.
            if (
              nudgedSignatureByRequestRef.current.get(aiRequestId) ===
              planSignature
            ) {
              nudgedSignatureByRequestRef.current.delete(aiRequestId);
            }
          });
      }, STUDIO_NUDGE_GRACE_MS);

      return () => clearTimeout(timer);
    },
    [
      selectedAiRequest,
      aiRequests,
      activeSubAgents,
      getEditorFunctionCallResults,
      isSendingAiRequest,
      onSendMessage,
    ]
  );
};
