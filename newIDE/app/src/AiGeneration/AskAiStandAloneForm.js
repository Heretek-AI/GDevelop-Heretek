// @flow
import * as React from 'react';
import { type I18n as I18nType } from '@lingui/core';
import { AiRequestChat, type AiRequestChatInterface } from './AiRequestChat';
import { canAffordAiRequest, getAvailableCredits } from './AiRequestChat/Utils';
import {
  addMessageToAiRequest,
  createAiRequest,
  retryAiRequest,
  sendAiRequestFeedback,
  type AiRequest,
  type AiRequestMessageAssistantFunctionCall,
} from '../Utils/GDevelopServices/Generation';
import { delay } from '../Utils/Delay';
import AuthenticatedUserContext from '../Profile/AuthenticatedUserContext';
import { makeSimplifiedProjectBuilder } from '../EditorFunctions/SimplifiedProject/SimplifiedProject';
import {
  canUpgradeSubscription,
  hasValidSubscriptionPlan,
} from '../Utils/GDevelopServices/Usage';
import { retryIfFailed } from '../Utils/RetryIfFailed';
import { CreditsPackageStoreContext } from '../AssetStore/CreditsPackages/CreditsPackageStoreContext';
import { type EditorCallbacks } from '../EditorFunctions';
import {
  isFailedAiRequestStart,
  getStandaloneCreateOutcome,
  canRetryAiRequestForSession,
  canSendAiRequestForSession,
  canStartAiRequestCreate,
  canSendFeedbackForSession,
  getFunctionCallOutputsFromEditorFunctionCallResults,
  getFunctionCallsToProcess,
} from './AiRequestUtils';
import { type EditorFunctionCallResult } from '../EditorFunctions';
import { useStableUpToDateRef } from '../Utils/UseStableUpToDateCallback';
import {
  type NewProjectSetup,
  type ExampleProjectSetup,
} from '../ProjectCreation/NewProjectSetupDialog';
import { type FileMetadata, type StorageProvider } from '../ProjectsStorage';
import { type ResourceManagementProps } from '../ResourcesList/ResourceSource';
import { sendAiRequestStarted } from '../Utils/Analytics/EventSender';
import { listAllExamples } from '../Utils/GDevelopServices/Example';
import UrlStorageProvider from '../ProjectsStorage/UrlStorageProvider';
import { prepareAiUserContent } from './PrepareAiUserContent';
import { AiRequestContext } from './AiRequestContext';
import { SubscriptionContext } from '../Profile/Subscription/SubscriptionContext';
import { getAiConfigurationPresetsWithAvailability } from './AiConfiguration';
import { type CreateProjectResult } from '../Utils/UseCreateProject';
import {
  isCustomEndpointEnabled,
  customAbortPendingCreateAiRequests,
  LOCAL_BYOK_USER_ID,
} from '../AI/CustomAIClient';
import {
  useProcessFunctionCalls,
  useRefreshLimits,
  type NewAiRequestOptions,
  type OpenAskAiOptions,
  AI_ORCHESTRATOR_TOOLS_VERSION,
} from './Utils';
import { ColumnStackLayout, LineStackLayout } from '../UI/Layout';
import RobotIcon from '../ProjectCreation/RobotIcon';
import Text from '../UI/Text';
import { Trans, t } from '@lingui/macro';
import IconButton from '../UI/IconButton';
import PreferencesContext from '../MainFrame/Preferences/PreferencesContext';
import EventsFunctionsExtensionsContext from '../EventsFunctionsExtensionsLoader/EventsFunctionsExtensionsContext';
import Cross from '../UI/CustomSvgIcons/Cross';
import useAlertDialog from '../UI/Alert/useAlertDialog';

const gd: libGDevelop = global.gd;

// Stable references for the standalone form, which never gates edits (it only
// creates a project from scratch, with nothing to apply on an existing one).
const alwaysAutoEditEnabled = () => true;
const noOpSuspendAiRequest = async () => {};
const alwaysApproveEdit = async () => true;
// The stand-alone form has no studio runtime: it never spawns a sub-agent, and
// the shared request-store mutators are not mounted here.
const noOpActivateSubAgent = () => {};
const noOpUpdateAiRequest = () => {};
const neverSendingAiRequest = () => false;

type Props = {|
  project: ?gdProject,
  resourceManagementProps: ResourceManagementProps,
  fileMetadata: ?FileMetadata,
  storageProvider: ?StorageProvider,
  i18n: I18nType,
  onCreateProjectFromExample: (
    exampleProjectSetup: ExampleProjectSetup
  ) => Promise<CreateProjectResult>,
  onCreateEmptyProject: (
    newProjectSetup: NewProjectSetup
  ) => Promise<CreateProjectResult>,
  onOpenLayout: (
    sceneName: string,
    options: {|
      openEventsEditor: boolean,
      openSceneEditor: boolean,
      focusWhenOpened:
        | 'scene-or-events-otherwise'
        | 'scene'
        | 'events'
        | 'none',
    |}
  ) => void,
  onWillInstallExtension: (extensionNames: Array<string>) => void,
  onExtensionInstalled: (extensionNames: Array<string>) => void,
  onCloseAskAi: () => void,
  onOpenAskAi?: (?OpenAskAiOptions) => void,
  onCloseDialog?: () => void,
  closeProject?: () => Promise<void>,
  dismissableIdentifier?: string,
|};

export const AskAiStandAloneForm = ({
  project,
  resourceManagementProps,
  fileMetadata,
  storageProvider,
  i18n,
  onCreateProjectFromExample,
  onCreateEmptyProject,
  onOpenLayout,
  onCloseAskAi,
  onOpenAskAi,
  onCloseDialog,
  closeProject,
  dismissableIdentifier,
  onWillInstallExtension,
  onExtensionInstalled,
}: Props): null | React.Node => {
  const onCreateProject = React.useCallback(
    async ({
      name,
      exampleSlug,
    }: {|
      name: string,
      exampleSlug: string | null,
    |}) => {
      const newProjectSetup: NewProjectSetup = {
        projectName: name,
        storageProvider: UrlStorageProvider,
        saveAsLocation: null,
        // As the request is coming from the Standalone Ask AI form,
        // ensure the Ask AI editor is opened once the project is created.
        forceOpenAskAiEditor: true,
        creationSource: 'ai-agent-request',
      };

      if (exampleSlug) {
        const { exampleShortHeaders } = await listAllExamples();
        const exampleShortHeader = exampleShortHeaders.find(
          header => header.slug === exampleSlug
        );
        if (exampleShortHeader) {
          const { createdProject } = await onCreateProjectFromExample({
            exampleShortHeader,
            newProjectSetup,
            i18n,
          });
          return { exampleSlug, createdProject };
        }

        // The example was not found - still create an empty project.
      }

      const { createdProject } = await onCreateEmptyProject(newProjectSetup);

      return { exampleSlug: null, createdProject };
    },
    [onCreateProjectFromExample, onCreateEmptyProject, i18n]
  );

  const editorCallbacks: EditorCallbacks = React.useMemo(
    () => ({
      onOpenLayout,
      onCreateProject,
      // The stand-alone form has no external layout or extension editors to open.
      onOpenExternalLayout: () => {},
      onOpenEventsFunctionsExtension: () => {},
      onOpenCustomObjectEditor: () => {},
    }),
    [onOpenLayout, onCreateProject]
  );

  const [
    newAiRequestOptions,
    startNewAiRequest,
  ] = React.useState<NewAiRequestOptions | null>(null);

  const {
    aiRequestStorage,
    editorFunctionCallResultsStorage,
    getAiSettings,
    setSelectedAiRequestId,
    suspendAiRequest,
  } = React.useContext(AiRequestContext);
  const {
    getEditorFunctionCallResults,
    addEditorFunctionCallResults,
    clearEditorFunctionCallResults,
  } = editorFunctionCallResultsStorage;
  const {
    aiRequests,
    updateAiRequest,
    isSendingAiRequest,
    getLastSendError,
    setSendingAiRequest,
    setLastSendError,
  } = aiRequestStorage;
  const [aiRequestIdForForm, setAiRequestIdForForm] = React.useState<
    string | null
  >(null);
  const aiRequestModeForForm = 'orchestrator'; // Standalone form is for orchestrator mode requests.
  const aiRequestForForm =
    (aiRequestIdForForm && aiRequests[aiRequestIdForForm]) || null;
  const upToDateSelectedAiRequestId = useStableUpToDateRef(aiRequestIdForForm);

  const aiRequestChatRef = React.useRef<AiRequestChatInterface | null>(null);

  const { openCreditsPackageDialog } = React.useContext(
    CreditsPackageStoreContext
  );
  const {
    values: { automaticallyUseCreditsForAiRequests },
  } = React.useContext(PreferencesContext);
  const authenticatedUser = React.useContext(AuthenticatedUserContext);
  const {
    profile,
    getAuthorizationHeader: rawGetAuthorizationHeader,
    onOpenCreateAccountDialog,
    limits,
    onRefreshLimits,
    subscription,
  } = authenticatedUser;
  const { openSubscriptionDialog } = React.useContext(SubscriptionContext);

  const getAuthorizationHeader = React.useCallback(
    async (): Promise<string> => {
      try {
        return await rawGetAuthorizationHeader();
      } catch (error) {
        if (isCustomEndpointEnabled()) {
          return 'Bearer local-byok-token';
        }
        throw error;
      }
    },
    [rawGetAuthorizationHeader]
  );

  const { isRefreshingLimits, refreshLimits } = useRefreshLimits(
    onRefreshLimits
  );
  const [isSendingUserMessage, setIsSendingUserMessage] = React.useState(false);

  // `capabilities` is validated to exist by getUserLimits but nothing deeper,
  // so `classrooms` may be absent.
  const hideAskAi = !!limits?.capabilities?.classrooms?.hideAskAi;

  const availableCredits = getAvailableCredits(limits);
  const quota =
    (limits && limits.quotas && limits.quotas['consumed-ai-credits']) || null;
  const aiRequestPrice = limits?.credits?.prices?.['ai-request'] || null;
  const aiRequestPriceInCredits = aiRequestPrice
    ? aiRequestPrice.priceInCredits
    : null;

  // Refresh limits when showing the form, as we want to be sure
  // we display the proper quota and credits information for the user.
  React.useEffect(
    () => {
      if (profile) refreshLimits();
    },
    // Only on mount, we'll refresh again when sending an AI request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Trigger the start of the new AI request if the user has requested it
  // (or if triggered automatically by setting `newAiRequestOptions`, for example
  // after waiting for the project to be created for an AI agent request).
  React.useEffect(
    () => {
      (async () => {
        if (!newAiRequestOptions) return;
        console.info('Starting a new AI request...');

        if (!canStartAiRequestCreate(profile, isCustomEndpointEnabled())) {
          onOpenCreateAccountDialog();
          startNewAiRequest(null);
          return;
        }

        const activeUserId = profile ? profile.id : LOCAL_BYOK_USER_ID;

        // Read the options and reset them immediately to prevent the effect from firing
        // again if dependencies change during the async operations below (e.g. when
        // closeProject causes project to become null).
        const { userRequest, aiConfigurationPresetId } = newAiRequestOptions;
        startNewAiRequest(null);

        // Ensure the Ask AI pane is closed, to avoid multiple requests being sent
        // at the same time from the editor and the standalone form.
        // The open project is closed only after a successful create so an
        // offline/BYOK first-turn failure leaves the user's project open.
        onCloseAskAi();

        // Ensure the user has enough credits to pay for the request, or ask them
        // to buy some more.
        let payWithCredits = false;
        if (
          quota &&
          quota.limitReached &&
          aiRequestPriceInCredits &&
          !isCustomEndpointEnabled()
        ) {
          payWithCredits = true;
        }
        // The same rule as the one enabling the send button, so the button
        // can't offer to send a request this would silently drop. Local/BYOK
        // (custom endpoint) never depends on hosted credits/quota.
        if (
          !canAffordAiRequest({
            isCustomEndpointEnabled: isCustomEndpointEnabled(),
            userId: activeUserId,
            quota,
            price: aiRequestPrice,
            availableCredits,
            automaticallyUseCreditsForAiRequests,
          })
        ) {
          return;
        }

        // Request is now ready to be started.
        try {
          const storageProviderName = storageProvider
            ? storageProvider.internalName
            : null;

          setSendingAiRequest(null, true);
          setIsSendingUserMessage(true);

          const preparedAiUserContent = await prepareAiUserContent({
            getAuthorizationHeader,
            userId: activeUserId,
            simplifiedProjectJson: null,
            projectSpecificExtensionsSummaryJson: null,
            eventsJson: null,
          });

          const aiRequest = await createAiRequest(getAuthorizationHeader, {
            userRequest: userRequest,
            userId: activeUserId,
            gameProjectJsonUserRelativeKey:
              preparedAiUserContent.gameProjectJsonUserRelativeKey,
            gameProjectJson: preparedAiUserContent.gameProjectJson,
            projectSpecificExtensionsSummaryJsonUserRelativeKey:
              preparedAiUserContent.projectSpecificExtensionsSummaryJsonUserRelativeKey,
            projectSpecificExtensionsSummaryJson:
              preparedAiUserContent.projectSpecificExtensionsSummaryJson,
            payWithCredits,
            gameId: null, // No game associated when starting from the standalone form.
            fileMetadata: null, // No file metadata when starting from the standalone form.
            storageProviderName,
            mode: aiRequestModeForForm,
            toolsVersion: AI_ORCHESTRATOR_TOOLS_VERSION,
            aiConfiguration: {
              presetId: aiConfigurationPresetId,
            },
          });

          setSendingAiRequest(null, false);
          setIsSendingUserMessage(false);
          updateAiRequest(aiRequest.id, () => aiRequest);

          // Offline/local first-turn failures come back as status:'error' (not a
          // throw): keep the form open on that request so the error row (and
          // Retry → continue) is reachable. Handing off to the Ask AI tab and
          // closing the dialog would hide the failure and fire a false "started".
          if (getStandaloneCreateOutcome(aiRequest) === 'error-row') {
            console.warn(
              'AI request created in error state:',
              aiRequest.error && aiRequest.error.message
            );
            setAiRequestIdForForm(aiRequest.id);
            if (!upToDateSelectedAiRequestId.current) {
              setSelectedAiRequestId(aiRequest.id);
            }
          } else {
            // Success handoff: the AI will create a new project, so close the
            // current one only now (offline failures leave it open).
            if (project && closeProject) {
              await closeProject();
            }

            console.info('Successfully created a new AI request:', aiRequest);

            // Select the new AI request just created - unless the user switched to another one
            // in the meantime.
            if (!upToDateSelectedAiRequestId.current) {
              // Set the global selected AI request state so the editor tab
              // can find the right request when it opens.
              setSelectedAiRequestId(aiRequest.id);
            }

            // Open the Ask AI tab right away. Always use 'center' pane since
            // the project has been closed (or was never open) at this point.
            if (onOpenAskAi) {
              onOpenAskAi({
                continueProcessingFunctionCallsOnMount: true,
                paneIdentifier: 'center',
              });
            }

            // Reset the form so it's ready for a new request (the tab now owns the request).
            setAiRequestIdForForm(null);
            if (aiRequestChatRef.current) {
              aiRequestChatRef.current.resetUserInput('');
            }

            sendAiRequestStarted({
              simplifiedProjectJsonLength: 0,
              projectSpecificExtensionsSummaryJsonLength: 0,
              payWithCredits,
              storageProviderName,
              mode: aiRequestModeForForm,
              aiRequestId: aiRequest.id,
            });

            // The conversation now continues in the Ask AI tab behind, so close
            // the dialog hosting this standalone form. Done last, as it unmounts
            // this component.
            if (onCloseDialog) {
              onCloseDialog();
            }
          }
        } catch (error) {
          console.error('Error starting a new AI request:', error);
          setLastSendError(null, error);
          setIsSendingUserMessage(false);
        }

        // Refresh the user limits, to ensure quota and credits information
        // is up-to-date after an AI request.
        await delay(500);
        await refreshLimits({ withRetry: true });
      })();
    },
    [
      aiRequestPrice,
      aiRequestPriceInCredits,
      availableCredits,
      getAuthorizationHeader,
      onOpenCreateAccountDialog,
      refreshLimits,
      openCreditsPackageDialog,
      profile,
      project,
      fileMetadata,
      storageProvider,
      quota,
      aiRequestIdForForm,
      setLastSendError,
      aiRequestModeForForm,
      setSelectedAiRequestId,
      setSendingAiRequest,
      upToDateSelectedAiRequestId,
      updateAiRequest,
      newAiRequestOptions,
      subscription,
      openSubscriptionDialog,
      onCloseAskAi,
      automaticallyUseCreditsForAiRequests,
      onOpenAskAi,
      onCloseDialog,
      closeProject,
    ]
  );

  // Continue a failed request from where it stopped (local BYOK: cache-only;
  // hosted: needs a profile for /action/retry). Mirrors the editor container.
  const onRetryAfterError = React.useCallback(
    async () => {
      const aiRequestId = aiRequestIdForForm;
      if (!aiRequestId) return;
      if (!canRetryAiRequestForSession(profile, aiRequestId)) return;
      try {
        const aiRequest = await retryAiRequest(getAuthorizationHeader, {
          userId: profile ? profile.id : LOCAL_BYOK_USER_ID,
          aiRequestId,
        });
        updateAiRequest(aiRequest.id, () => aiRequest);
      } catch (error) {
        console.error('Error while retrying the AI request:', error);
        setLastSendError(aiRequestId, error);
      }
    },
    [
      aiRequestIdForForm,
      profile,
      getAuthorizationHeader,
      updateAiRequest,
      setLastSendError,
    ]
  );

  const isLoading = isSendingAiRequest(aiRequestIdForForm);

  // Send the results of the function call outputs only.
  // In a standalone form, the only user message is sent when starting the request.
  const onSendMessage = React.useCallback(
    async ({
      aiRequestId,
      userMessage,
      createdSceneNames,
      createdProject,
      editorFunctionCallResults,
    }: {|
      aiRequestId: string,
      userMessage: string,
      createdSceneNames?: Array<string>,
      createdProject?: ?gdProject,
      editorFunctionCallResults: Array<EditorFunctionCallResult>,
    |}) => {
      // Local/BYOK (custom endpoint) must be able to return function-call
      // outputs without a logged-in profile — same rule as the editor
      // container's onSendMessage. Requiring a profile here silently stalled
      // the agent loop for offline sessions after the model asked to run tools.
      // A local-ai-* id is also allowed without a profile or endpoint (cache-only).
      if (
        !canSendAiRequestForSession(
          profile,
          isCustomEndpointEnabled(),
          aiRequestId
        )
      )
        return;

      const aiRequestForSend = aiRequests[aiRequestId];
      if (!aiRequestForSend) return;

      if (isSendingAiRequest(aiRequestId)) return;

      // Read the results from the editor that applied the function calls.
      // and transform them into the output that will be stored on the AI request.
      const {
        hasUnfinishedResult,
        functionCallOutputs,
      } = getFunctionCallOutputsFromEditorFunctionCallResults(
        editorFunctionCallResults
      );

      const hasFunctionsCallsToProcess =
        getFunctionCallsToProcess({
          aiRequest: aiRequestForSend,
          editorFunctionCallResults,
        }).length > 0;

      // If anything is not finished yet, stop there (we only send all
      // results at once, AI do not support partial results).
      if (hasUnfinishedResult) return false;
      if (hasFunctionsCallsToProcess) return false;

      // If nothing to send, stop there.
      // When in a standalone form, this can happen if the agent did not
      // decide to create a project, in this case, abort and clear the form.
      if (functionCallOutputs.length === 0) return false;

      let aiRequest: AiRequest | void;
      try {
        setSendingAiRequest(aiRequestId, true);

        const upToDateProject = createdProject || project;

        const simplifiedProjectBuilder = makeSimplifiedProjectBuilder(gd);
        const simplifiedProjectJson = upToDateProject
          ? JSON.stringify(
              simplifiedProjectBuilder.getSimplifiedProject(upToDateProject, {})
            )
          : null;
        const projectSpecificExtensionsSummaryJson = upToDateProject
          ? JSON.stringify(
              simplifiedProjectBuilder.getProjectSpecificExtensionsSummary(
                upToDateProject
              )
            )
          : null;

        const activeUserId = profile ? profile.id : LOCAL_BYOK_USER_ID;

        const preparedAiUserContent = await prepareAiUserContent({
          getAuthorizationHeader,
          userId: activeUserId,
          simplifiedProjectJson,
          projectSpecificExtensionsSummaryJson,
          eventsJson: null,
        });

        aiRequest = await retryIfFailed({ times: 2 }, () =>
          addMessageToAiRequest(getAuthorizationHeader, {
            userId: activeUserId,
            aiRequestId,
            functionCallOutputs,
            gameProjectJsonUserRelativeKey:
              preparedAiUserContent.gameProjectJsonUserRelativeKey,
            gameProjectJson: preparedAiUserContent.gameProjectJson,
            projectSpecificExtensionsSummaryJsonUserRelativeKey:
              preparedAiUserContent.projectSpecificExtensionsSummaryJsonUserRelativeKey,
            projectSpecificExtensionsSummaryJson:
              preparedAiUserContent.projectSpecificExtensionsSummaryJson,
            gameId: upToDateProject
              ? upToDateProject.getProjectUuid()
              : undefined,
            payWithCredits: false,
            userMessage: '', // No user message when sending only function call outputs.
            // We don't pause when creating the request as we are in orchestrator mode.
            // If we switch back to agent mode for the standalone form in the future,
            // check if it has just initialized the project to mark it as paused.
            paused: false,
            mode: aiRequestModeForForm,
            toolsVersion: AI_ORCHESTRATOR_TOOLS_VERSION,
          })
        );
        updateAiRequest(aiRequest.id, () => aiRequest);
        setSendingAiRequest(aiRequest.id, false);
        // Local mid-turn failures return status:'error': keep function-call
        // results so Retry → continue can re-send them without losing work.
        if (isFailedAiRequestStart(aiRequest)) {
          console.warn(
            'AI message send returned error state:',
            aiRequest.error && aiRequest.error.message
          );
        } else {
          clearEditorFunctionCallResults(aiRequest.id);
        }
      } catch (error) {
        setLastSendError(aiRequestId, error);
      }

      const sendFailed = !!aiRequest && isFailedAiRequestStart(aiRequest);
      if (aiRequestId === aiRequestIdForForm && !sendFailed) {
        // Clear the selected AI request, to be able to start a new one if needed.
        const aiRequestChatRefCurrent = aiRequestChatRef.current;
        if (aiRequestChatRefCurrent) {
          aiRequestChatRefCurrent.resetUserInput('');
          aiRequestChatRefCurrent.resetUserInput(aiRequestId);
        }
        setAiRequestIdForForm('');
      }

      // Refresh the user limits, to ensure quota and credits information
      // is up-to-date after an AI request.
      await delay(500);
      await refreshLimits({ withRetry: true });
      return true;
    },
    [
      profile,
      aiRequestIdForForm,
      aiRequests,
      isSendingAiRequest,
      setSendingAiRequest,
      updateAiRequest,
      clearEditorFunctionCallResults,
      getAuthorizationHeader,
      setLastSendError,
      project,
      refreshLimits,
    ]
  );

  const onSendEditorFunctionCallResults = React.useCallback(
    async (
      aiRequestId: string,
      editorFunctionCallResults: Array<EditorFunctionCallResult>,
      options: {|
        createdSceneNames?: Array<string>,
        // Not opened by the stand-alone form (no editor to open them in).
        createdExternalLayoutNames?: Array<string>,
        createdProject?: ?gdProject,
      |}
    ) => {
      return onSendMessage({
        aiRequestId,
        userMessage: '',
        createdSceneNames: options.createdSceneNames,
        createdProject: options.createdProject,
        editorFunctionCallResults,
      });
    },
    [onSendMessage]
  );

  const eventsFunctionsExtensionsState = React.useContext(
    EventsFunctionsExtensionsContext
  );

  const aiRequestsToProcess = React.useMemo(
    () => (aiRequestForForm ? [aiRequestForForm] : []),
    [aiRequestForForm]
  );

  const { onProcessFunctionCalls } = useProcessFunctionCalls({
    project,
    resourceManagementProps,
    editorCallbacks,
    aiRequestsToProcess,
    onSendEditorFunctionCallResults,
    isStudioEnabled: false,
    getEditorFunctionCallResults,
    addEditorFunctionCallResults,
    i18n,
    onSceneEventsModifiedOutsideEditor: () => {},
    onInstancesModifiedOutsideEditor: () => {},
    onObjectsModifiedOutsideEditor: () => {},
    onObjectGroupsModifiedOutsideEditor: () => {},
    onProjectItemRenamedOutsideEditor: () => {},
    onWillDeleteScene: () => Promise.resolve(),
    onWillDeleteGameplayTest: () => Promise.resolve(),
    onWillDeleteObject: () => {},
    eventsFunctionsExtensionsState,
    // The stand-alone form has no editor tab to refresh.
    onExtensionsModifiedOutsideEditor: () => {},
    onWillDeleteExtensionItem: () => Promise.resolve(),
    onWillInstallExtension,
    onExtensionInstalled,
    isReadyToProcessFunctionCalls: true,
    // The standalone form only ever creates a project from scratch, so there is
    // nothing to gate: always auto-apply and never need to suspend on refusal.
    getIsAutoEditEnabled: alwaysAutoEditEnabled,
    suspendAiRequest: noOpSuspendAiRequest,
    requestEditApproval: alwaysApproveEdit,
    // The form never spawns a sub-agent and has no request store to write to.
    activateSubAgent: noOpActivateSubAgent,
    updateAiRequest: noOpUpdateAiRequest,
    isSendingAiRequest: neverSendingAiRequest,
  });

  const onProcessFormFunctionCalls = React.useCallback(
    async (functionCalls: Array<AiRequestMessageAssistantFunctionCall>) => {
      if (!aiRequestForForm) return;
      await onProcessFunctionCalls(aiRequestForForm, functionCalls);
    },
    [aiRequestForForm, onProcessFunctionCalls]
  );

  const { values, showAskAiStandAloneForm } = React.useContext(
    PreferencesContext
  );
  const { showConfirmation } = useAlertDialog();

  if (
    dismissableIdentifier &&
    values.hiddenAskAiStandAloneForms[dismissableIdentifier]
  ) {
    return null;
  }

  if (hideAskAi) {
    return null;
  }

  return (
    <ColumnStackLayout noMargin>
      <LineStackLayout
        noMargin
        alignItems="center"
        justifyContent="space-between"
      >
        <LineStackLayout noMargin>
          <RobotIcon size={20} rotating={isLoading} />
          <Text size="sub-title" noMargin>
            <Trans>What would you like to create?</Trans>
          </Text>
        </LineStackLayout>
        {dismissableIdentifier && (
          <IconButton
            onClick={async () => {
              const answer = await showConfirmation({
                title: t`Hide the AI assistant?`,
                message: t`You won't see it here anymore, unless you re-activate it from the preferences.`,
              });
              if (!answer) return;

              showAskAiStandAloneForm(dismissableIdentifier, false);
            }}
            size="small"
            disabled={isLoading}
            style={{ padding: 0 }}
          >
            <Cross />
          </IconButton>
        )}
      </LineStackLayout>
      <AiRequestChat
        aiConfigurationPresetsWithAvailability={getAiConfigurationPresetsWithAvailability(
          { limits, getAiSettings }
        )}
        project={project}
        fileMetadata={fileMetadata}
        ref={aiRequestChatRef}
        aiRequest={aiRequestForForm}
        onStartNewAiRequest={startNewAiRequest}
        onSendUserMessage={async ({
          userMessage,
        }: {|
          userMessage: string,
        |}) => {
          if (!aiRequestIdForForm) return;
          await onSendMessage({
            aiRequestId: aiRequestIdForForm,
            userMessage,
            editorFunctionCallResults: aiRequestForForm
              ? getEditorFunctionCallResults(aiRequestForForm.id) || []
              : [],
          });
        }}
        isSending={isLoading}
        isSendingUserMessage={isSendingUserMessage}
        lastSendError={getLastSendError(aiRequestIdForForm)}
        onRetryAfterError={onRetryAfterError}
        quota={quota}
        increaseQuotaOffering={
          isCustomEndpointEnabled()
            ? 'none'
            : !hasValidSubscriptionPlan(subscription)
            ? 'subscribe'
            : canUpgradeSubscription(subscription)
            ? 'upgrade'
            : 'none'
        }
        onProcessFunctionCalls={onProcessFormFunctionCalls}
        editorFunctionCallResults={
          (aiRequestForForm &&
            getEditorFunctionCallResults(aiRequestForForm.id)) ||
          null
        }
        price={aiRequestPrice}
        availableCredits={availableCredits}
        isRefreshingLimits={isRefreshingLimits}
        onSendFeedback={async (
          aiRequestId,
          messageIndex,
          feedback,
          reason,
          freeFormDetails
        ) => {
          if (!canSendFeedbackForSession(profile, aiRequestId)) return;
          try {
            await retryIfFailed({ times: 2 }, () =>
              sendAiRequestFeedback(getAuthorizationHeader, {
                userId: profile ? profile.id : LOCAL_BYOK_USER_ID,
                aiRequestId,
                messageIndex,
                feedback,
                reason,
                freeFormDetails,
              })
            );
          } catch (error) {
            console.error('Error sending feedback: ', error);
          }
        }}
        hasOpenedProject={!!project}
        onStop={async () => {
          // No form request yet: cancel a hung local create (pending registry).
          if (!aiRequestIdForForm) {
            customAbortPendingCreateAiRequests();
            return;
          }
          // Provider handles optimistic status, local abort, and hosted suspend.
          await suspendAiRequest(aiRequestIdForForm);
        }}
        i18n={i18n}
        editorCallbacks={editorCallbacks}
        onStartOrOpenChat={() => {}}
        standAloneForm
        // Restoring project version not relevant to standalone form.
        isFetchingSuggestions={false}
        savingProjectForMessageId={null}
        forkingState={null}
        onRestore={async () => {}}
      />
    </ColumnStackLayout>
  );
};
