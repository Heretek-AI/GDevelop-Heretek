// @flow
import * as React from 'react';
import AuthenticatedUserContext from '../Profile/AuthenticatedUserContext';
import { retryIfFailed } from '../Utils/RetryIfFailed';
import { delay } from '../Utils/Delay';
import { getBackedOffIntervalInMs } from '../Utils/UseAdaptivePollingInterval';
import {
  getAiGeneratedEvent,
  createAiGeneratedEvent,
} from '../Utils/GDevelopServices/Generation';

import {
  type EventsGenerationResult,
  type EventBatch,
} from '../EditorFunctions';
import { type ToolScope } from '../EditorFunctions/Scope';
import { makeSimplifiedProjectBuilder } from '../EditorFunctions/SimplifiedProject/SimplifiedProject';
import { type FunctionAuthoringScope } from '../InstructionOrExpression/EnumeratedInstructionOrExpressionMetadata';
import { prepareAiUserContent } from './PrepareAiUserContent';
import {
  isCustomEndpointEnabled,
  LOCAL_BYOK_USER_ID,
} from '../AI/CustomAIClient';

const gd: libGDevelop = global.gd;

type UseGenerateEventsReturnType = {
  generateEvents: ({
    eventsDescription: string | null,
    eventBatches: Array<EventBatch> | null,
    existingEventsJson: string | null,
    extensionNamesList: string,
    objectsList: string,
    placementHint: string | null,
    relatedAiRequestId: string,
    scope: ToolScope,
    functionName: string | null,
    sceneName: string,
    estimatedComplexity: number | null,
  }) => Promise<EventsGenerationResult>,
};
export const useGenerateEvents = ({
  project,
}: {|
  project: ?gdProject,
|}): UseGenerateEventsReturnType => {
  const { profile, getAuthorizationHeader } = React.useContext(
    AuthenticatedUserContext
  );

  const generateEvents = React.useCallback(
    async ({
      scope,
      functionName,
      sceneName,
      eventsDescription,
      eventBatches,
      extensionNamesList,
      objectsList,
      existingEventsJson,
      placementHint,
      relatedAiRequestId,
      estimatedComplexity,
    }: {|
      scope: ToolScope,
      functionName: string | null,
      sceneName: string,
      eventsDescription: string | null,
      eventBatches: Array<EventBatch> | null,
      extensionNamesList: string,
      objectsList: string,
      existingEventsJson: string | null,
      placementHint: string | null,
      relatedAiRequestId: string,
      estimatedComplexity: number | null,
    |}): Promise<EventsGenerationResult> => {
      if (!project) throw new Error('No project is opened.');
      if (!profile && !isCustomEndpointEnabled())
        throw new Error('User should be authenticated.');

      const activeUserId = profile ? profile.id : LOCAL_BYOK_USER_ID;

      const simplifiedProjectBuilder = makeSimplifiedProjectBuilder(gd);
      const simplifiedProjectJson = JSON.stringify(
        simplifiedProjectBuilder.getSimplifiedProject(project, {})
      );
      // Events written inside a function of an extension can call the private
      // members reachable from where this function is authored: describe them.
      const authoringScope: FunctionAuthoringScope | null =
        functionName && scope.extension_name
          ? {
              extensionName: scope.extension_name,
              customBehaviorName: scope.custom_behavior_name || null,
              customObjectName: scope.custom_object_name || null,
            }
          : null;
      const projectSpecificExtensionsSummaryJson = JSON.stringify(
        simplifiedProjectBuilder.getProjectSpecificExtensionsSummary(project, {
          authoringScope,
        })
      );

      try {
        const preparedAiUserContent = await prepareAiUserContent({
          getAuthorizationHeader,
          userId: activeUserId,
          simplifiedProjectJson,
          projectSpecificExtensionsSummaryJson,
          eventsJson: existingEventsJson,
        });

        const createResult = await retryIfFailed(
          { times: 3, backoff: { initialDelay: 200, factor: 2 } },
          () =>
            createAiGeneratedEvent(getAuthorizationHeader, {
              userId: activeUserId,
              gameProjectJsonUserRelativeKey:
                preparedAiUserContent.gameProjectJsonUserRelativeKey,
              gameProjectJson: preparedAiUserContent.gameProjectJson,
              projectSpecificExtensionsSummaryJsonUserRelativeKey:
                preparedAiUserContent.projectSpecificExtensionsSummaryJsonUserRelativeKey,
              projectSpecificExtensionsSummaryJson:
                preparedAiUserContent.projectSpecificExtensionsSummaryJson,
              existingEventsJsonUserRelativeKey:
                preparedAiUserContent.eventsJsonUserRelativeKey,
              existingEventsJson: preparedAiUserContent.eventsJson,
              scope,
              functionName,
              sceneName,
              eventsDescription,
              eventBatches,
              extensionNamesList,
              objectsList,
              placementHint,
              relatedAiRequestId,
              estimatedComplexity,
            })
        );

        if (!createResult.creationSucceeded) {
          return {
            generationCompleted: false,
            errorMessage: createResult.errorMessage,
          };
        }

        // Poll with exponential backoff (fast initially, capped), bounded by a
        // total time budget rather than a fixed attempt count.
        const maxTotalWaitMs = 180000;
        const maxPollIntervalMs = 5000;
        const startTime = Date.now();
        let pollIntervalMs = 1000;
        let consecutivePollFailures = 0;
        const maxConsecutivePollFailures = 5;
        let aiGeneratedEvent = createResult.aiGeneratedEvent;
        while (aiGeneratedEvent.status === 'working') {
          await delay(pollIntervalMs);

          try {
            aiGeneratedEvent = await getAiGeneratedEvent(
              getAuthorizationHeader,
              {
                userId: activeUserId,
                aiGeneratedEventId: aiGeneratedEvent.id,
              }
            );
            consecutivePollFailures = 0;
          } catch (error) {
            consecutivePollFailures++;
            console.warn(
              'Error while checking status of AI generated event - continuing...',
              error
            );
            // A permanent failure (permissions revoked, event purged) would
            // otherwise be retried silently until the whole time budget
            // burned, surfacing as a misleading timeout.
            if (consecutivePollFailures >= maxConsecutivePollFailures) {
              return {
                generationCompleted: false,
                errorMessage:
                  'Lost contact with the AI event generation service (repeated failures while checking the status).',
              };
            }
          }
          pollIntervalMs = getBackedOffIntervalInMs(
            pollIntervalMs,
            maxPollIntervalMs
          );
          if (Date.now() - startTime >= maxTotalWaitMs) {
            return {
              generationCompleted: false,
              errorMessage:
                'Event generation started but failed to complete in time.',
            };
          }
        }

        if (aiGeneratedEvent.status === 'suspended') {
          return {
            generationAborted: true,
          };
        }

        // A terminal 'error' status is an infrastructure failure, not a
        // successful generation: reporting it as completed would hand the
        // consumer an errored (possibly partially-filled) event to apply.
        if (aiGeneratedEvent.status === 'error') {
          return {
            generationCompleted: false,
            errorMessage:
              (aiGeneratedEvent.error && aiGeneratedEvent.error.message) ||
              'The AI event generation failed.',
          };
        }

        return { generationCompleted: true, aiGeneratedEvent };
      } catch (error) {
        console.error('Error while launching events generation:', error);
        return {
          generationCompleted: false,
          errorMessage: error.message,
        };
      }
    },
    [getAuthorizationHeader, project, profile]
  );

  return { generateEvents };
};
