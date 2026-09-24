// @flow
import * as React from 'react';
import { type I18n as I18nType } from '@lingui/core';
import {
  type SceneEventsOutsideEditorChanges,
  type InstancesOutsideEditorChanges,
  type ObjectsOutsideEditorChanges,
  type ObjectGroupsOutsideEditorChanges,
  type ProjectItemRenamedOutsideEditorChanges,
  type WillDeleteSceneChanges,
  type WillDeleteGameplayTestChanges,
  type WillDeleteObjectChanges,
  type ExtensionsOutsideEditorChanges,
  type WillDeleteExtensionItemChanges,
  getOutsideEditorChangesTargetKey,
  getSceneEventsOutsideEditorChangesKey,
} from '../EditorFunctions/OutsideEditorChanges';
import {
  makeExtensionsOutsideEditorChangesAccumulator,
  doExtensionChangesNeedCodeRegeneration,
} from './ExtensionsOutsideEditorChangesAccumulator';
import { type EventsFunctionsExtensionsState } from '../EventsFunctionsExtensionsLoader/EventsFunctionsExtensionsContext';
import {
  getAiRequestSuggestions,
  type AiRequest,
  type AiRequestMessage,
  type AiRequestMessageAssistantFunctionCall,
  updateAiRequestMessage,
} from '../Utils/GDevelopServices/Generation';
import AuthenticatedUserContext from '../Profile/AuthenticatedUserContext';
import { processEditorFunctionCalls } from '../EditorFunctions/EditorFunctionCallRunner';
import {
  type EditorCallbacks,
  type EditorFunctionCallResult,
  editorFunctions,
  editorFunctionsWithoutProject,
} from '../EditorFunctions';
import {
  getAllSubAgentFunctionCalls,
  getFunctionCallNameByCallId,
  getFunctionCallOutputsFromEditorFunctionCallResults,
  getFunctionCallsToProcess,
  getPendingSubAgentFunctionCalls,
  getLastMessagesFromAiRequestOutput,
  getLatestActivePlan,
  getSubAgentKind,
  isUserMessage,
  shouldFetchAiRequestSuggestions,
} from './AiRequestUtils';
import { useEnsureExtensionInstalled } from './UseEnsureExtensionInstalled';
import { useGenerateEvents } from './UseGenerateEvents';
import { useSearchAndInstallAsset } from './UseSearchAndInstallAsset';
import { useSearchAndInstallResource } from './UseSearchAndInstallResource';
import { type ResourceManagementProps } from '../ResourcesList/ResourceSource';
import { AiRequestContext } from './AiRequestContext';
import { ObjectStoreContext } from '../AssetStore/ObjectStoreContext';
import { ExtensionStoreContext } from '../AssetStore/ExtensionStore/ExtensionStoreContext';
import { enumerateObjectTypes } from '../ObjectsList/EnumerateObjects';

import { delay } from '../Utils/Delay';
import { retryIfFailed } from '../Utils/RetryIfFailed';
import { makeSimplifiedProjectBuilder } from '../EditorFunctions/SimplifiedProject/SimplifiedProject';
import { prepareAiUserContent } from './PrepareAiUserContent';
import { extractGDevelopApiErrorStatusAndCode } from '../Utils/GDevelopServices/Errors';
import {
  isCustomEndpointEnabled,
  LOCAL_BYOK_USER_ID,
} from '../AI/CustomAIClient';
import {
  isSpawnAgentCall,
  spawnSubAgent,
  buildGddContextNote,
  MAX_SUB_AGENTS_PER_PARENT,
} from './Studio/SpawnSubAgents';
import { createLoopGuard } from './Studio/LoopGuard';
import { mergePlanResultOutput } from './Studio/PlanStore';
import { isSubAgentAtTurnCap } from './Studio/FinalizeSubAgents';
import { getRoleToolPolicy, isRoleReadOnly } from './Studio/RoleToolPolicy';
import {
  createRequestWriteQueue,
  getRequestWriteBlock,
} from './Studio/RequestWriteGate';
import UnsavedChangesContext from '../MainFrame/UnsavedChangesContext';
import {
  type FileMetadata,
  type StorageProvider,
  type SaveAsLocation,
} from '../ProjectsStorage';
import CloudStorageProvider from '../ProjectsStorage/CloudStorageProvider';
import { checkIfHasTooManyCloudProjects } from '../MainFrame/EditorContainers/HomePage/CreateSection/MaxProjectCountAlertMessage';

const gd: libGDevelop = global.gd;

// How long to keep the "Calculating..." indicator visible after a refresh
// completes, to prevent it from flashing on fast calls.
const REFRESH_LIMITS_SETTLE_DELAY_MS = 200;

/**
 * Wraps `onRefreshLimits` with a loading state and a short settle delay so
 * the "Calculating..." indicator doesn't flash on fast network calls.
 */
export const useRefreshLimits = (
  onRefreshLimits: () => Promise<void>
): {|
  isRefreshingLimits: boolean,
  refreshLimits: (options?: {| withRetry?: boolean |}) => Promise<void>,
|} => {
  const [isRefreshingLimits, setIsRefreshingLimits] = React.useState(false);

  const refreshLimits = React.useCallback(
    async (options?: {| withRetry?: boolean |}) => {
      setIsRefreshingLimits(true);
      try {
        await retryIfFailed(
          { times: options && options.withRetry ? 2 : 1 },
          onRefreshLimits
        );
      } catch (error) {
        // Ignore limits refresh error.
      }
      await delay(REFRESH_LIMITS_SETTLE_DELAY_MS);
      setIsRefreshingLimits(false);
    },
    [onRefreshLimits]
  );

  return { isRefreshingLimits, refreshLimits };
};

// The tools of the orchestrator AND of the sub-agents it creates server-side.
// Only bump it once the matching prompts and generation-api are deployed;
// reverting it is the flip-back (every past version stays served).
// v14 adds gameplay tests (`run_tests` + the tester sub-agent).
// v15 makes read_game_project_json a live, editor-side read (backend stops
// overwriting its output) and exposes it to the edit/explorer script agents.
export const AI_ORCHESTRATOR_TOOLS_VERSION: string = 'v19';

/**
 * A pending request for the user to approve (or refuse) a project-modifying
 * edit, surfaced inline in the chat when auto-edit is off.
 */
export type EditApprovalRequest = {|
  // The AI request whose calls are gated (the orchestrator itself, or one of
  // its edit sub-agents).
  aiRequestId: string,
  // The project-modifying call ids waiting for approval.
  callIds: Array<string>,
  // A short label pointing at what is about to run: the name of the edit agent
  // (when the call is inside a sub-agent) or the tool itself (for a direct
  // modifying call). Rendered the same way it appears in the chat.
  label: React.Node,
|};

/**
 * Whether a function call, if run, would modify the project. This is the
 * signal used to gate edits behind a user confirmation when auto-edit is off.
 */
const doesFunctionCallModifyProject = (
  functionCall: AiRequestMessageAssistantFunctionCall
): boolean => {
  const editorFunctionDef =
    editorFunctions[functionCall.name] ||
    editorFunctionsWithoutProject[functionCall.name] ||
    null;
  if (!editorFunctionDef) return false;
  if (editorFunctionDef.getModifiesProject) {
    try {
      return editorFunctionDef.getModifiesProject(
        JSON.parse(functionCall.arguments)
      );
    } catch (error) {
      return !!editorFunctionDef.modifiesProject;
    }
  }
  return !!editorFunctionDef.modifiesProject;
};

/**
 * Render a single function call to the same short label shown for it in the
 * chat (via the editor function's renderForEditor). Falls back to the raw
 * function name when the call can't be rendered.
 */
const renderFunctionCallLabel = ({
  functionCall,
  project,
  editorCallbacks,
}: {|
  functionCall: AiRequestMessageAssistantFunctionCall,
  project: ?gdProject,
  editorCallbacks: EditorCallbacks,
|}): React.Node => {
  const editorFunction =
    editorFunctions[functionCall.name] ||
    editorFunctionsWithoutProject[functionCall.name] ||
    null;
  if (!editorFunction || !editorFunction.renderForEditor) {
    return functionCall.name;
  }
  try {
    const result = editorFunction.renderForEditor({
      project,
      args: JSON.parse(functionCall.arguments),
      editorCallbacks,
      shouldShowDetails: false,
      editorFunctionCallResultOutput: null,
    });
    return result.text || functionCall.name;
  } catch (error) {
    return functionCall.name;
  }
};

/**
 * Build the short label shown in the confirmation prompt when auto-edit is off,
 * pointing at what is about to run rather than describing the whole change.
 *
 * For an edit agent (a sub-agent, identified by its parentAiRequestId), we show
 * the agent's name — the label of the call that launched it in the parent
 * request (its short_title), the same name shown for the agent in the chat.
 * For a direct modifying call (e.g. generate_events on the orchestrator), we
 * show the tool's own label(s).
 */
const getEditApprovalLabel = ({
  aiRequest,
  modifyingFunctionCalls,
  aiRequests,
  project,
  editorCallbacks,
}: {|
  aiRequest: AiRequest,
  modifyingFunctionCalls: Array<AiRequestMessageAssistantFunctionCall>,
  aiRequests: { [string]: AiRequest },
  project: ?gdProject,
  editorCallbacks: EditorCallbacks,
|}): React.Node => {
  if (aiRequest.parentAiRequestId) {
    const parentRequest = aiRequests[aiRequest.parentAiRequestId] || null;
    const launchingCall = parentRequest
      ? getAllSubAgentFunctionCalls({ aiRequest: parentRequest }).find(
          functionCall => functionCall.subAgentAiRequestId === aiRequest.id
        )
      : null;
    if (launchingCall) {
      return renderFunctionCallLabel({
        functionCall: launchingCall,
        project,
        editorCallbacks,
      });
    }
  }

  return modifyingFunctionCalls.map((functionCall, index) => (
    <React.Fragment key={functionCall.call_id}>
      {index > 0 ? ', ' : null}
      {renderFunctionCallLabel({ functionCall, project, editorCallbacks })}
    </React.Fragment>
  ));
};

export const useProcessFunctionCalls = ({
  i18n,
  project,
  resourceManagementProps,
  editorCallbacks,
  aiRequestsToProcess,
  onSendEditorFunctionCallResults,
  isStudioEnabled,
  getEditorFunctionCallResults,
  addEditorFunctionCallResults,
  onSceneEventsModifiedOutsideEditor,
  onInstancesModifiedOutsideEditor,
  onObjectsModifiedOutsideEditor,
  onObjectGroupsModifiedOutsideEditor,
  onProjectItemRenamedOutsideEditor,
  onWillDeleteScene,
  onWillDeleteGameplayTest,
  onWillDeleteObject,
  eventsFunctionsExtensionsState,
  onExtensionsModifiedOutsideEditor,
  onWillDeleteExtensionItem,
  onWillInstallExtension,
  onExtensionInstalled,
  isReadyToProcessFunctionCalls,
  getIsAutoEditEnabled,
  suspendAiRequest,
  requestEditApproval,
  activateSubAgent,
  updateAiRequest,
  isSendingAiRequest,
}: {|
  i18n: I18nType,
  project: ?gdProject,
  resourceManagementProps: ResourceManagementProps,
  editorCallbacks: EditorCallbacks,
  aiRequestsToProcess: Array<AiRequest>,
  onSendEditorFunctionCallResults: (
    aiRequestId: string,
    editorFunctionCallResults: Array<EditorFunctionCallResult>,
    options: {|
      createdSceneNames?: Array<string>,
      createdExternalLayoutNames?: Array<string>,
      createdProject?: ?gdProject,
    |}
  ) => Promise<boolean>,
  getEditorFunctionCallResults: string => Array<EditorFunctionCallResult> | null,
  addEditorFunctionCallResults: (
    string,
    Array<EditorFunctionCallResult>
  ) => Array<EditorFunctionCallResult>,
  onSceneEventsModifiedOutsideEditor: (
    changes: SceneEventsOutsideEditorChanges
  ) => void,
  onInstancesModifiedOutsideEditor: (
    changes: InstancesOutsideEditorChanges
  ) => void,
  onObjectsModifiedOutsideEditor: (
    changes: ObjectsOutsideEditorChanges
  ) => void,
  onObjectGroupsModifiedOutsideEditor: (
    changes: ObjectGroupsOutsideEditorChanges
  ) => void,
  onProjectItemRenamedOutsideEditor: (
    changes: ProjectItemRenamedOutsideEditorChanges
  ) => void,
  onWillDeleteScene: (changes: WillDeleteSceneChanges) => Promise<void>,
  onWillDeleteGameplayTest: (
    changes: WillDeleteGameplayTestChanges
  ) => Promise<void>,
  onWillDeleteObject: (changes: WillDeleteObjectChanges) => void,
  // Used to regenerate the extensions changed by the AI (see
  // `ensureExtensionsUpToDate` below).
  eventsFunctionsExtensionsState: EventsFunctionsExtensionsState,
  onExtensionsModifiedOutsideEditor: (
    changes: ExtensionsOutsideEditorChanges
  ) => void,
  onWillDeleteExtensionItem: (
    changes: WillDeleteExtensionItemChanges
  ) => Promise<void>,
  onWillInstallExtension: (extensionNames: Array<string>) => void,
  onExtensionInstalled: (extensionNames: Array<string>) => void,
  isReadyToProcessFunctionCalls: boolean,
  // Whether this view runs the multi-agent studio (the editor does; the
  // stand-alone form does not, so it cannot spawn sub-agents).
  isStudioEnabled?: boolean,
  getIsAutoEditEnabled: () => boolean,
  suspendAiRequest: (aiRequestId: string) => Promise<void>,
  requestEditApproval: (request: EditApprovalRequest) => Promise<boolean>,
  // Activates a studio sub-agent so the context polls it and the editor
  // processes its function calls (see `AiRequestContext.activateSubAgent`).
  activateSubAgent: (
    subAgentAiRequestId: string,
    parentAiRequestId: string,
    callId: string
  ) => void,
  // Writes a request (used by the studio loop guard to mark a request failed).
  updateAiRequest: (
    aiRequestId: string,
    updateFn: (previousAiRequest: ?AiRequest) => AiRequest
  ) => void,
  // Whether a user send is in flight for a request (read by the write gate).
  isSendingAiRequest: (aiRequestId: string | null) => boolean,
|}): {
  onProcessFunctionCalls: (
    aiRequest: AiRequest,
    functionCalls: Array<AiRequestMessageAssistantFunctionCall>
  ) => Promise<void>,
  clearApprovedEditBatches: () => void,
  enqueueRequestWrite: (
    aiRequestId: string,
    write: () => Promise<void>
  ) => Promise<void>,
} => {
  const { ensureExtensionInstalled } = useEnsureExtensionInstalled({
    project,
    i18n,
  });
  const { searchAndInstallAsset } = useSearchAndInstallAsset({
    project,
    resourceManagementProps,
    onWillInstallExtension,
    onExtensionInstalled,
  });
  const { searchAndInstallResources } = useSearchAndInstallResource({
    project,
    resourceManagementProps,
  });
  const { generateEvents } = useGenerateEvents({ project });
  const { triggerUnsavedChanges } = React.useContext(UnsavedChangesContext);

  const { translatedObjectShortHeadersByType, fetchObjects } = React.useContext(
    ObjectStoreContext
  );
  const { fetchExtensionsAndFilters } = React.useContext(ExtensionStoreContext);

  // Latest map of all AI requests, kept in a ref so the (heavily-memoized)
  // onProcessFunctionCalls callback can look up a sub-agent's parent at edit
  // approval time without taking a dependency on the frequently-changing map.
  const { aiRequestStorage } = React.useContext(AiRequestContext);
  const aiRequestsRef = React.useRef(aiRequestStorage.aiRequests);
  aiRequestsRef.current = aiRequestStorage.aiRequests;

  React.useEffect(
    () => {
      fetchObjects();
      // Warm the extension registry so AI-triggered installs don't fail.
      fetchExtensionsAndFilters();
    },
    [fetchObjects, fetchExtensionsAndFilters]
  );
  const getAssetStoreTagForNewObject = React.useCallback(
    (objectType: string): string | null => {
      // Prefer the installed object metadata (same source as the
      // "New object" dialog in the editor).
      const installedObjectMetadata = project
        ? enumerateObjectTypes(project, null).find(
            enumeratedObjectMetadata =>
              enumeratedObjectMetadata.type === objectType
          )
        : null;
      if (installedObjectMetadata && installedObjectMetadata.assetStoreTag) {
        return installedObjectMetadata.assetStoreTag;
      }

      const header = translatedObjectShortHeadersByType[objectType];
      return (header && header.assetStoreTag) || null;
    },
    [project, translatedObjectShortHeadersByType]
  );

  // In-memory guard against duplicate processing of the same function call.
  //
  // The main protection is marking calls as "working" in the ref-backed
  // results store (see useEditorFunctionCallResultsStorage).  However,
  // React 18 can re-run an effect before a forceUpdate() re-render has
  // propagated (e.g. StrictMode double-invocations in development, or a
  // polling update that recreates onProcessFunctionCalls while the previous
  // invocation is still awaiting).
  // This Set acts as an immediate, synchronous lock keyed by
  // "<requestId>:<callId>" so a call that is already being processed is
  // never started a second time.
  const inFlightFunctionCallIdsRef = React.useRef<Set<string>>(new Set());

  // When auto-edit is off, the user approves edits one batch at a time. Once a
  // batch is approved we remember it here so the rest of that edit agent's
  // tools (and any later modifying rounds) run without asking again.
  // Keys are `req:<aiRequestId>` (for a whole edit agent) or
  // `call:<callId>` (for a single direct modifying call like generate_events).
  const approvedEditBatchKeysRef = React.useRef<Set<string>>(new Set());

  // One loop guard per local AI request (see `Studio/LoopGuard.js`): it counts
  // consecutive identical calls, consecutive failures and turns, so a local
  // agent that loops cannot run forever.
  const loopGuardsRef = React.useRef<Map<string, any>>(new Map());
  const loopGuardLastUserMessageIdRef = React.useRef<Map<string, string>>(
    new Map()
  );

  // Forget all previously-granted edit approvals so the next modifying call
  // asks again. Called when the user toggles auto-edit: turning it on then off
  // again means they want to review the upcoming edits, even within a sub-agent
  // whose batch was already approved.
  const clearApprovedEditBatches = React.useCallback(() => {
    approvedEditBatchKeysRef.current.clear();
  }, []);

  const onProcessFunctionCalls = React.useCallback(
    async (
      aiRequest: AiRequest,
      functionCalls: Array<AiRequestMessageAssistantFunctionCall>
    ) => {
      if (!isReadyToProcessFunctionCalls) return;
      if (aiRequest.status === 'suspended') return;

      // A studio sub-agent that has used up its role's turn budget takes no
      // further turn (the studio finalizes it with its last message). Return
      // before taking any in-flight lock.
      if (
        isCustomEndpointEnabled() &&
        isSubAgentAtTurnCap({ aiRequest, aiRequests: aiRequestsRef.current })
      ) {
        return;
      }

      const functionCallsToProcess = functionCalls.filter(
        functionCall =>
          !inFlightFunctionCallIdsRef.current.has(
            `${aiRequest.id}:${functionCall.call_id}`
          )
      );
      if (functionCallsToProcess.length === 0) {
        console.info(
          'All function calls are already being processed (in-flight guard), skipping.'
        );
        return;
      }

      // Lock these call IDs so concurrent invocations skip them.
      functionCallsToProcess.forEach(functionCall => {
        inFlightFunctionCallIdsRef.current.add(
          `${aiRequest.id}:${functionCall.call_id}`
        );
      });

      // The studio role a sub-agent was spawned with restricts its tool subset
      // (defense in depth: the model is offered only these, and anything else it
      // still calls is refused here). All denied calls stay in
      // `functionCallsToProcess` so their in-flight locks are released below.
      // The role policy is resolved through a helper (see `getRoleToolPolicy`):
      // `aiRequest.studioRoleId` is persisted and unvalidated, so an
      // unrecognized id denies every call rather than throwing (which would
      // stall the batch before a single call is dispatched) or being treated as
      // "no role" (which would hand a read-only sub-agent every tool).
      const studioRoleId = aiRequest.studioRoleId || null;
      const rolePolicy = getRoleToolPolicy(studioRoleId);
      const studioDeniedCallIds = new Set<string>();
      if (studioRoleId) {
        for (const functionCall of functionCallsToProcess) {
          if (!rolePolicy.allowedToolNames.includes(functionCall.name)) {
            studioDeniedCallIds.add(functionCall.call_id);
            addEditorFunctionCallResults(aiRequest.id, [
              {
                status: 'finished',
                call_id: functionCall.call_id,
                success: false,
                output: {
                  message: rolePolicy.roleResolved
                    ? `The tool ${
                        functionCall.name
                      } is not available for the ${String(
                        rolePolicy.displayName
                      )} role.`
                    : `The tool ${
                        functionCall.name
                      } is not available: this sub-agent's studio role could not be resolved.`,
                },
              },
            ]);
          }
        }
      }

      // An explorer sub-agent's script is read-only (see below: it is exposed
      // only non-mutating functions). Knowing this lets us both skip its edit
      // approval and restrict the functions its `run_script` can call. A
      // read-only studio role is read-only too.
      const subAgentKind = getSubAgentKind({
        aiRequest,
        aiRequests: aiRequestsRef.current,
      });
      const isReadOnlyScriptContext =
        subAgentKind === 'explorer' || isRoleReadOnly(studioRoleId);

      // Gate project-modifying calls behind a user confirmation when auto-edit
      // is off. Read-only calls (exploration, inspection) always run. The first
      // time an edit agent (or a direct modifying call) is about to change the
      // project, ask the user; once approved, the rest of that batch runs
      // without asking again. On refusal, suspend the request so the user can
      // explain what to do differently.
      //
      // This must happen after the in-flight lock above and before the calls
      // are marked "working": on refusal we intentionally keep the lock held
      // (we never reach the `finally` that releases it) so the now-suspended
      // calls are not re-processed before the suspension propagates.
      if (!getIsAutoEditEnabled()) {
        const batchKey = aiRequest.parentAiRequestId
          ? `req:${aiRequest.id}`
          : null;
        const isCallApproved = (
          functionCall: AiRequestMessageAssistantFunctionCall
        ) =>
          (!!batchKey && approvedEditBatchKeysRef.current.has(batchKey)) ||
          approvedEditBatchKeysRef.current.has(`call:${functionCall.call_id}`);

        const modifyingFunctionCalls = functionCallsToProcess.filter(
          functionCall =>
            doesFunctionCallModifyProject(functionCall) &&
            // A call the role filter already refused is not dispatched, so
            // asking the user to approve it would prompt for nothing.
            !studioDeniedCallIds.has(functionCall.call_id) &&
            // An explorer sub-agent's `run_script` is read-only (exposed only
            // non-mutating functions), so it never needs an edit approval even
            // though `run_script` is declared as project-modifying.
            !(isReadOnlyScriptContext && functionCall.name === 'run_script') &&
            // A read-only studio role never raises the prompt (its subset was
            // fixed at spawn and is enforced by the dispatch filter above).
            !isRoleReadOnly(studioRoleId) &&
            !isCallApproved(functionCall)
        );

        if (modifyingFunctionCalls.length > 0) {
          const label = getEditApprovalLabel({
            aiRequest,
            modifyingFunctionCalls,
            aiRequests: aiRequestsRef.current,
            project,
            editorCallbacks,
          });
          // Ask the user inline, in the chat (see EditApprovalRow). The promise
          // resolves when they click Apply/Cancel. The in-flight lock stays held
          // while we wait, so the same calls are not re-processed meanwhile.
          const accepted = await requestEditApproval({
            aiRequestId: aiRequest.id,
            callIds: modifyingFunctionCalls.map(
              functionCall => functionCall.call_id
            ),
            label,
          });

          if (!accepted) {
            // Refused: suspend the request (the parent orchestrator if this is
            // an edit agent) so the whole flow pauses and the user can redirect.
            // Keep the in-flight lock held so these calls are not re-processed.
            const requestToSuspendId =
              aiRequest.parentAiRequestId || aiRequest.id;
            try {
              await suspendAiRequest(requestToSuspendId);
            } catch (error) {
              console.error(
                'Error while suspending AI request after a refused edit:',
                error
              );
            }
            return;
          }

          // Approved: remember the approval for the whole batch so subsequent
          // modifying calls from the same edit agent run without asking again.
          // Avoid unbounded growth across a long session.
          if (approvedEditBatchKeysRef.current.size > 500) {
            approvedEditBatchKeysRef.current.clear();
          }
          if (batchKey) {
            approvedEditBatchKeysRef.current.add(batchKey);
          } else {
            modifyingFunctionCalls.forEach(functionCall =>
              approvedEditBatchKeysRef.current.add(
                `call:${functionCall.call_id}`
              )
            );
          }
        }
      }

      // The local loop guard: with no server under BYOK, nothing else stops an
      // agent looping on fresh call ids. Only recorded for local requests - the
      // hosted backend enforces its own `repeated-tool-call-loop` error, and a
      // second client-side trip over the same condition would double-report.
      // One guard per request (persisted across passes) so its counters
      // accumulate; reset on a new user message.
      const loopGuardHandledCallIds = new Set<string>();
      const guard = isCustomEndpointEnabled()
        ? loopGuardsRef.current.get(aiRequest.id) || createLoopGuard()
        : null;
      if (guard) {
        loopGuardsRef.current.set(aiRequest.id, guard);
        const lastUserMessage = (aiRequest.output || [])
          .filter(isUserMessage)
          .pop();
        const currentLastUserMessageId = lastUserMessage
          ? (lastUserMessage: any).messageId
          : null;
        const seenLastUserMessageId = loopGuardLastUserMessageIdRef.current.get(
          aiRequest.id
        );
        if (
          currentLastUserMessageId &&
          currentLastUserMessageId !== seenLastUserMessageId
        ) {
          guard.reset();
          loopGuardLastUserMessageIdRef.current.set(
            aiRequest.id,
            currentLastUserMessageId
          );
        }
        functionCallsToProcess.forEach(functionCall => {
          guard.recordToolCall({
            name: functionCall.name,
            arguments: functionCall.arguments,
          });
        });
        guard.recordTurn();

        const decision = guard.evaluate();
        if (decision.action === 'steer' || decision.action === 'constrain') {
          const loopGuardMessage = `The local agent looks stuck (${
            decision.reason
          }). Stop repeating this action and change approach, or report the problem.`;
          // Pair the warning with the batch's first real call: an unpaired
          // `function_call_output` (a call the model never made) is rejected by
          // OpenAI-compatible APIs.
          const guardedCall = functionCallsToProcess[0];
          addEditorFunctionCallResults(aiRequest.id, [
            {
              status: 'finished',
              call_id: guardedCall.call_id,
              success: false,
              output: { message: loopGuardMessage },
            },
          ]);
          loopGuardHandledCallIds.add(guardedCall.call_id);
        }
        if (decision.action === 'constrain') {
          // Stop issuing further turns for this request. The request is marked
          // as failed with the error code the existing error UI already
          // classifies as "The AI got stuck" (`AiRequestErrorRow.js`), so no
          // new UI is needed for it.
          console.warn(
            `[studio] loop guard constrained the local request ${
              aiRequest.id
            }: ${decision.reason}`
          );
          updateAiRequest(aiRequest.id, currentRequest => ({
            ...(currentRequest || {
              id: aiRequest.id,
              createdAt: new Date().toISOString(),
              userId: 'local-byok-user',
              error: null,
              output: [],
            }),
            status: 'error',
            updatedAt: new Date().toISOString(),
            error: {
              code: 'repeated-tool-call-loop',
              message: `The local agent was stopped after ${decision.reason}.`,
            },
          }));
          try {
            await suspendAiRequest(aiRequest.id);
          } catch (error) {
            console.error(
              'Error while suspending a request stopped by the loop guard:',
              error
            );
          }
          return;
        }
      }

      // The local studio's delegation tool is not an editor function: it creates
      // a child AI request and stamps the call so the shared loop stops treating
      // it as a call for the editor to execute (`getFunctionCallsToProcess`
      // skips calls carrying a `subAgentAiRequestId`). Only under BYOK: the
      // hosted backend never emits this tool name, so hosted behaviour is
      // untouched and this pre-pass is skipped entirely.
      const spawnCalls = isCustomEndpointEnabled()
        ? functionCallsToProcess.filter(
            functionCall =>
              isSpawnAgentCall(functionCall) &&
              !studioDeniedCallIds.has(functionCall.call_id)
          )
        : [];
      const spawnHandledCallIds = new Set<string>();
      const spawnFailureResults: Array<EditorFunctionCallResult> = [];
      if (spawnCalls.length > 0) {
        // Computed once per batch (W7), not once per spawn.
        const gddContextNote = buildGddContextNote(project);
        // Fan-out cap (W8): bound the live children one parent may have.
        const existingChildCount = Object.keys(aiRequestsRef.current).filter(
          id =>
            (aiRequestsRef.current[id] || {}).parentAiRequestId === aiRequest.id
        ).length;
        let spawnedThisBatch = 0;
        for (const spawnCall of spawnCalls) {
          // The stand-alone view has no studio: sub-agents cannot be spawned.
          if (!isStudioEnabled) {
            spawnHandledCallIds.add(spawnCall.call_id);
            const denial = {
              status: 'finished',
              call_id: spawnCall.call_id,
              success: false,
              output: { message: 'Sub-agents are not available in this view.' },
            };
            spawnFailureResults.push(denial);
            addEditorFunctionCallResults(aiRequest.id, [denial]);
            continue;
          }
          // Beyond the fan-out cap, refuse instead of spawning.
          if (
            existingChildCount + spawnedThisBatch >=
            MAX_SUB_AGENTS_PER_PARENT
          ) {
            spawnHandledCallIds.add(spawnCall.call_id);
            const capDenial = {
              status: 'finished',
              call_id: spawnCall.call_id,
              success: false,
              output: { message: 'Sub-agent limit reached for this request.' },
            };
            spawnFailureResults.push(capDenial);
            addEditorFunctionCallResults(aiRequest.id, [capDenial]);
            continue;
          }
          spawnedThisBatch++;
          let spawnResult;
          try {
            spawnResult = await spawnSubAgent({
              parentAiRequestId: aiRequest.id,
              functionCall: spawnCall,
              gameProjectJson: aiRequest.gameProjectJson || null,
              projectSpecificExtensionsSummaryJson: null,
              project,
              gddContextNote,
              onStamped: subAgentAiRequestId => {
                // Stamp the call in place so the shared loop skips it from here
                // on, then activate the child so AiRequestContext polls it and
                // the editor processes its own function calls.
                spawnCall.subAgentAiRequestId = subAgentAiRequestId;
                activateSubAgent(
                  subAgentAiRequestId,
                  aiRequest.id,
                  spawnCall.call_id
                );
              },
            });
          } catch (error) {
            console.error('Error while spawning a studio sub-agent:', error);
            spawnResult = { error: 'The sub-agent could not be started.' };
          }

          spawnHandledCallIds.add(spawnCall.call_id);
          if (spawnResult.error) {
            // Surface it as a failed call the model sees, rather than a crash.
            const failure = {
              status: 'finished',
              call_id: spawnCall.call_id,
              success: false,
              output: { message: spawnResult.error },
            };
            spawnFailureResults.push(failure);
            addEditorFunctionCallResults(aiRequest.id, [failure]);
          }
        }
      }
      const callsForEditor = functionCallsToProcess.filter(
        functionCall =>
          !spawnHandledCallIds.has(functionCall.call_id) &&
          !loopGuardHandledCallIds.has(functionCall.call_id) &&
          !studioDeniedCallIds.has(functionCall.call_id)
      );
      // Mark only the editor calls as "working": a spawn (or a loop-guard hit)
      // already has a terminal result, and a permanent "working" entry would
      // make `hasUnfinishedResult` silently drop sibling sends.
      addEditorFunctionCallResults(
        aiRequest.id,
        callsForEditor.map(functionCall => ({
          status: 'working',
          call_id: functionCall.call_id,
        }))
      );
      if (callsForEditor.length === 0) {
        // Nothing left for the editor: surface any spawn failures to the model
        // (they are already recorded but not yet sent), then release the locks.
        if (spawnFailureResults.length > 0) {
          await onSendEditorFunctionCallResults(
            aiRequest.id,
            spawnFailureResults,
            {}
          );
        }
        functionCallsToProcess.forEach(functionCall => {
          inFlightFunctionCallIdsRef.current.delete(
            `${aiRequest.id}:${functionCall.call_id}`
          );
        });
        return;
      }

      // The "modified outside editor" callbacks each refresh the editor and can
      // trigger an in-game editor hot reload. Firing them once per function
      // call would, for a batch of modifying calls (e.g. a sub-agent adding 20
      // objects), hot reload the editor 20 times. Instead, accumulate the
      // changes per target (a scene, an external layout or a variant of a
      // custom object) while the batch is processed, then flush a single
      // coalesced notification per change type and target once it is done.
      const accumulatedSceneEventsChanges: Map<
        string,
        SceneEventsOutsideEditorChanges
      > = new Map();
      const accumulatedInstancesChanges: Map<
        string,
        InstancesOutsideEditorChanges
      > = new Map();
      const accumulatedObjectsChanges: Map<
        string,
        ObjectsOutsideEditorChanges
      > = new Map();
      const accumulatedObjectGroupsChanges: Map<
        string,
        ObjectGroupsOutsideEditorChanges
      > = new Map();
      const accumulatedExtensionsChanges = makeExtensionsOutsideEditorChangesAccumulator();
      const flushAccumulatedOutsideEditorChanges = () => {
        accumulatedSceneEventsChanges.forEach(changes =>
          onSceneEventsModifiedOutsideEditor(changes)
        );
        accumulatedInstancesChanges.forEach(changes =>
          onInstancesModifiedOutsideEditor(changes)
        );
        accumulatedObjectsChanges.forEach(changes =>
          onObjectsModifiedOutsideEditor(changes)
        );
        accumulatedObjectGroupsChanges.forEach(changes =>
          onObjectGroupsModifiedOutsideEditor(changes)
        );
      };

      // Regenerate the extensions changed so far, so the platform metadata (and
      // the extensions summary sent with the next message) matches the project
      // again. Awaited by the functions needing fresh metadata to continue, and
      // at the end of the batch so nothing is left dirty.
      const ensureExtensionsUpToDate = async () => {
        if (accumulatedExtensionsChanges.isEmpty()) return;
        const changes = accumulatedExtensionsChanges.flush();

        if (project) {
          if (doExtensionChangesNeedCodeRegeneration(changes)) {
            await eventsFunctionsExtensionsState.reloadProjectEventsFunctionsExtensions(
              project
            );
          } else {
            changes.extensionNames.forEach(extensionName => {
              if (!project.hasEventsFunctionsExtensionNamed(extensionName)) {
                return;
              }
              eventsFunctionsExtensionsState.reloadProjectEventsFunctionsExtensionMetadata(
                project,
                project.getEventsFunctionsExtension(extensionName)
              );
            });
          }
        }

        onExtensionsModifiedOutsideEditor(changes);
        triggerUnsavedChanges();
      };

      // Regenerate the metadata of one extension, without generating its code
      // and without flushing what the batch accumulated: a function that just
      // changed an extension reads back how the editor now describes it.
      const reloadExtensionMetadata = (extensionName: string) => {
        if (
          !project ||
          !project.hasEventsFunctionsExtensionNamed(extensionName)
        )
          return;
        eventsFunctionsExtensionsState.reloadProjectEventsFunctionsExtensionMetadata(
          project,
          project.getEventsFunctionsExtension(extensionName)
        );
      };

      try {
        const {
          results,
          createdSceneNames,
          createdExternalLayoutNames,
          createdProject,
        } = await processEditorFunctionCalls({
          project,
          editorCallbacks,
          // $FlowFixMe[incompatible-type]
          toolOptions: aiRequest.toolOptions || null,
          // Threaded so functions can gate version-dependent behavior (e.g. a
          // no-op counts as success from v12 — see isNoOpConsideredSuccess).
          toolsVersion: aiRequest.toolsVersion || null,
          i18n,
          // Explorer sub-agent scripts are read-only: restrict their
          // `run_script` to non-mutating functions (defense in depth).
          runScriptReadOnly: isReadOnlyScriptContext,
          functionCalls: callsForEditor.map(functionCall => ({
            name: functionCall.name,
            arguments: functionCall.arguments,
            call_id: functionCall.call_id,
          })),
          relatedAiRequestId: aiRequest.id,
          getRelatedAiRequestLastMessages: () =>
            getLastMessagesFromAiRequestOutput(aiRequest.output || []),
          generateEvents,
          onSceneEventsModifiedOutsideEditor: changes => {
            const key = getSceneEventsOutsideEditorChangesKey(changes);
            const existingChanges = accumulatedSceneEventsChanges.get(key);
            if (existingChanges) {
              changes.newOrChangedAiGeneratedEventIds.forEach(id =>
                existingChanges.newOrChangedAiGeneratedEventIds.add(id)
              );
            } else {
              accumulatedSceneEventsChanges.set(key, {
                ...changes,
                newOrChangedAiGeneratedEventIds: new Set(
                  changes.newOrChangedAiGeneratedEventIds
                ),
              });
            }
          },
          onInstancesModifiedOutsideEditor: changes => {
            accumulatedInstancesChanges.set(
              getOutsideEditorChangesTargetKey(changes),
              changes
            );
          },
          onObjectsModifiedOutsideEditor: changes => {
            const key = getOutsideEditorChangesTargetKey(changes);
            const existingChanges = accumulatedObjectsChanges.get(key);
            accumulatedObjectsChanges.set(key, {
              ...changes,
              isNewObjectTypeUsed:
                (existingChanges
                  ? existingChanges.isNewObjectTypeUsed
                  : false) || changes.isNewObjectTypeUsed,
            });
          },
          onObjectGroupsModifiedOutsideEditor: changes => {
            accumulatedObjectGroupsChanges.set(
              getOutsideEditorChangesTargetKey(changes),
              changes
            );
          },
          // Not coalesced: the tab rename must track the model rename, else the
          // open scene editor briefly looks up a now-missing layout name.
          onProjectItemRenamedOutsideEditor,
          // Not coalesced: must run before the scene is actually deleted so
          // the tab can be closed while the gdLayout is still valid.
          onWillDeleteScene,
          onWillDeleteGameplayTest,
          // Not coalesced: must run before the object is actually deleted so
          // editors can safely read it to close a dialog/panel referring to it.
          onWillDeleteObject,
          // Coalesced per extension: regenerating the extensions once for the
          // whole batch instead of once per call.
          onExtensionsModifiedOutsideEditor: changes =>
            accumulatedExtensionsChanges.add(changes),
          ensureExtensionsUpToDate,
          reloadExtensionMetadata,
          // Not coalesced: must run before the extension (or one of its items)
          // is actually deleted so the tabs and selections bound to it are
          // released while it's still valid.
          onWillDeleteExtensionItem,
          ensureExtensionInstalled,
          onWillInstallExtension,
          onExtensionInstalled,
          searchAndInstallAsset,
          searchAndInstallResources,
          getAssetStoreTagForNewObject,
        });

        // If the request was suspended while we were processing, discard the
        // results — we don't want to re-populate the cleared results or send
        // anything to a suspended request.
        if (results.some(r => r.status === 'aborted')) {
          console.info(
            'Some function call results were aborted (request was likely suspended during processing), discarding all results.'
          );
          return;
        }

        // Record outcomes for the loop guard's error-storm trip (a real success
        // clears it; a failure advances it).
        if (guard) {
          results.forEach(result => {
            if (result.status !== 'finished') return;
            if (result.success) guard.recordSuccess();
            else guard.recordError();
          });
        }

        const newResults = addEditorFunctionCallResults(aiRequest.id, results);

        // A plan written by the plan tool is folded over the plan the request
        // already has, matching tasks by id: the tool sends the tasks it knows
        // about, so a field another writer set (the studio's `agentCallId` when
        // it delegates a task) must survive. `result.output` is the object
        // `EditorFunctionCallRunner` builds, so it is read as an object, never
        // parsed.
        const existingPlan = getLatestActivePlan(aiRequest);
        const existingTasks = existingPlan ? existingPlan.tasks : null;
        const mergedResults = newResults.map(result =>
          // $FlowFixMe[incompatible-type]
          mergePlanResultOutput(result, existingTasks)
        );

        const sent = await onSendEditorFunctionCallResults(
          aiRequest.id,
          mergedResults,
          {
            createdSceneNames,
            createdExternalLayoutNames,
            createdProject,
          }
        );
        if (!sent) {
          console.error('[studio] function call results were not sent');
        }
      } finally {
        // Flush the coalesced editor notifications for everything modified in
        // this batch (one hot reload instead of one per call). In `finally` so
        // the editor is still refreshed for whatever was modified even if the
        // batch was aborted or threw, matching the previous inline behavior.
        flushAccumulatedOutsideEditorChanges();

        // Regenerate the extensions left dirty by the batch, so the project
        // summary sent with the next message describes them as they are now.
        try {
          await ensureExtensionsUpToDate();
        } catch (error) {
          console.error(
            'Error while reloading the extensions modified by the AI:',
            error
          );
        }

        // Release the lock so these calls can be retried if needed
        // (e.g. after an error or a suspension). Release every call that was
        // locked (including spawn/loop-guard handled ones), not just the ones
        // sent to the editor.
        functionCallsToProcess.forEach(functionCall => {
          inFlightFunctionCallIdsRef.current.delete(
            `${aiRequest.id}:${functionCall.call_id}`
          );
        });
      }
    },
    [
      i18n,
      isReadyToProcessFunctionCalls,
      addEditorFunctionCallResults,
      project,
      editorCallbacks,
      onSceneEventsModifiedOutsideEditor,
      onInstancesModifiedOutsideEditor,
      onObjectsModifiedOutsideEditor,
      onObjectGroupsModifiedOutsideEditor,
      onProjectItemRenamedOutsideEditor,
      onWillDeleteScene,
      onWillDeleteGameplayTest,
      onWillDeleteObject,
      eventsFunctionsExtensionsState,
      onExtensionsModifiedOutsideEditor,
      onWillDeleteExtensionItem,
      triggerUnsavedChanges,
      ensureExtensionInstalled,
      onWillInstallExtension,
      onExtensionInstalled,
      searchAndInstallAsset,
      searchAndInstallResources,
      getAssetStoreTagForNewObject,
      generateEvents,
      onSendEditorFunctionCallResults,
      isStudioEnabled,
      getIsAutoEditEnabled,
      suspendAiRequest,
      requestEditApproval,
      activateSubAgent,
      updateAiRequest,
    ]
  );

  // Collect all function calls to process across all active AI requests.
  const allFunctionCallsToProcess: Array<{|
    aiRequest: AiRequest,
    functionCalls: Array<AiRequestMessageAssistantFunctionCall>,
  |}> = React.useMemo(
    () => {
      const result = [];
      for (const aiRequest of aiRequestsToProcess) {
        const functionCalls = getFunctionCallsToProcess({
          aiRequest,
          editorFunctionCallResults: getEditorFunctionCallResults(aiRequest.id),
        });
        if (functionCalls.length > 0) {
          result.push({ aiRequest, functionCalls });
        }
      }
      return result;
    },
    [aiRequestsToProcess, getEditorFunctionCallResults]
  );

  React.useEffect(
    () => {
      if (allFunctionCallsToProcess.length === 0) return;

      (async () => {
        for (const { aiRequest, functionCalls } of allFunctionCallsToProcess) {
          if (aiRequest.status === 'suspended') continue;
          console.info(
            `Automatically processing AI function calls for request ${
              aiRequest.id
            }...`
          );
          await onProcessFunctionCalls(aiRequest, functionCalls);
        }
      })();
    },
    [onProcessFunctionCalls, allFunctionCallsToProcess]
  );

  // One write gate per hook instance: the studio's writes to a request go
  // through it, so a write cannot land in the middle of another one for the
  // same request (see `Studio/RequestWriteGate.js`).
  const requestWriteQueueRef = React.useRef<Object | null>(null);
  if (!requestWriteQueueRef.current) {
    requestWriteQueueRef.current = createRequestWriteQueue();
  }

  /**
   * Run `write` once the request is free, through the gate. The reason a write
   * waited is logged, which is the whole point of naming the three block
   * reasons rather than collapsing them to a boolean.
   */
  const enqueueRequestWrite = React.useCallback(
    (aiRequestId: string, write: () => Promise<void>): Promise<void> => {
      const queue = requestWriteQueueRef.current;
      if (!queue) return write();
      return queue.enqueue(aiRequestId, write, () => {
        const block = getRequestWriteBlock({
          aiRequestId,
          request: (aiRequestsRef.current[aiRequestId]: any) || null,
          isSending: isSendingAiRequest(aiRequestId),
          inFlightCallIds: inFlightFunctionCallIdsRef.current,
        });
        if (block) {
          console.info(
            `[studio] deferred a write to ${aiRequestId}: ${block}.`
          );
          return true;
        }
        return false;
      });
    },
    // `isSendingAiRequest` is read through the latest-render closure: the gate
    // must see the current value at write time, not the one captured when the
    // callback was created, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return {
    onProcessFunctionCalls,
    clearApprovedEditBatches,
    enqueueRequestWrite,
  };
};

/**
 * Detects sub-agent function calls in the selected AI request and activates
 * them so that AiRequestContext starts polling and processing them.
 */
export const useActivatePendingSubAgents = ({
  selectedAiRequest,
}: {|
  selectedAiRequest: ?AiRequest,
|}) => {
  const { activateSubAgent } = React.useContext(AiRequestContext);

  React.useEffect(
    () => {
      if (!selectedAiRequest) return;

      const subAgentCalls = getPendingSubAgentFunctionCalls({
        aiRequest: selectedAiRequest,
      });
      subAgentCalls.forEach(call => {
        if (call.subAgentAiRequestId) {
          activateSubAgent(
            call.subAgentAiRequestId,
            selectedAiRequest.id,
            call.call_id
          );
        }
      });
    },
    [selectedAiRequest, activateSubAgent]
  );
};

/**
 * For every sub-agent function call in the selected AI request, ensures that
 * its AiRequest is loaded into the shared `aiRequests` storage so its details
 * can be displayed (e.g. for historical or suspended parents whose sub-agents
 * are no longer being polled by `useActivatePendingSubAgents`).
 *
 * One-shot fetch only — the polling/activation pipeline remains responsible
 * for live updates of still-running sub-agents.
 */
export const useLoadSubAgentRequests = ({
  selectedAiRequest,
}: {|
  selectedAiRequest: ?AiRequest,
|}) => {
  const { aiRequestStorage } = React.useContext(AiRequestContext);
  const { aiRequests, refreshAiRequest } = aiRequestStorage;
  const attemptedFetchRef = React.useRef<Set<string>>(new Set());

  React.useEffect(
    () => {
      if (!selectedAiRequest) return;

      const subAgentCalls = getAllSubAgentFunctionCalls({
        aiRequest: selectedAiRequest,
      });
      for (const call of subAgentCalls) {
        const subAgentAiRequestId = call.subAgentAiRequestId;
        if (!subAgentAiRequestId) continue;
        if (aiRequests[subAgentAiRequestId]) continue;
        if (attemptedFetchRef.current.has(subAgentAiRequestId)) continue;
        attemptedFetchRef.current.add(subAgentAiRequestId);
        refreshAiRequest(subAgentAiRequestId);
      }
    },
    [selectedAiRequest, aiRequests, refreshAiRequest]
  );
};

export const useAiRequestState = ({
  project,
  fileMetadata,
  storageProviderName,
  onSave,
  onSaveProjectAsWithStorageProvider,
}: {|
  project: ?gdProject,
  fileMetadata?: ?FileMetadata,
  storageProviderName?: ?string,
  onSave?: (options?: {|
    skipNewVersionWarning: boolean,
  |}) => Promise<?FileMetadata>,
  onSaveProjectAsWithStorageProvider?: (
    options: ?{|
      requestedStorageProvider?: StorageProvider,
      forcedSavedAsLocation?: SaveAsLocation,
      createdProject?: gdProject,
    |}
  ) => Promise<?FileMetadata>,
|}): {
  isFetchingSuggestions: boolean,
  savingProjectForMessageId: ?string,
} => {
  const authenticatedUser = React.useContext(AuthenticatedUserContext);
  const { profile, getAuthorizationHeader } = authenticatedUser;
  const {
    aiRequestStorage,
    editorFunctionCallResultsStorage,
    isFetchingSuggestions,
    setIsFetchingSuggestions,
    setSelectedAiRequestId,
    selectedAiRequest,
  } = React.useContext(AiRequestContext);
  const { updateAiRequest, isSendingAiRequest } = aiRequestStorage;
  const { getEditorFunctionCallResults } = editorFunctionCallResultsStorage;

  const [
    savingProjectForMessageId,
    setSavingProjectForMessageId,
  ] = React.useState<?string>(null);

  // Best-effort suggestions are attempted at most once per message; this tracks
  // which messages were already attempted (key: aiRequestId + last message id),
  // so that a transient failure cannot loop now that the input stays enabled.
  const attemptedSuggestionMessageIdsRef = React.useRef<Set<string>>(new Set());

  const prevProjectRef = React.useRef(project);
  React.useEffect(
    () => {
      if (prevProjectRef.current !== project) {
        const hadPreviousProject = prevProjectRef.current !== null;
        prevProjectRef.current = project;
        // Only clear the selected request when switching away from an existing
        // project (closing or switching projects). Do NOT clear when a project
        // is first opened from scratch (null → project), e.g. when the AI
        // creates a new project — we want to keep the in-progress request.
        if (hadPreviousProject) {
          setSelectedAiRequestId(null);
        }
      }
    },
    [project, setSelectedAiRequestId]
  );

  const { hasUnsavedChanges } = React.useContext(UnsavedChangesContext);
  const isCloudProjectsMaximumReached = checkIfHasTooManyCloudProjects(
    authenticatedUser
  );
  const isSavingRef = React.useRef<boolean>(false);

  const currentlyOpenedCloudProjectVersionId =
    fileMetadata && storageProviderName === CloudStorageProvider.internalName
      ? fileMetadata.version
      : null;

  React.useEffect(
    () => {
      async function fetchSuggestionsIfNeeded() {
        // If the request :
        // - is an agent request,
        // - is not sending a new message right now,
        // - went from "working" to "ready",
        // - has a few messages already (not an empty request),
        // - does not have any tools waiting to run,
        // - and does not have any suggestions yet,
        // Then ask for some.
        if (
          !selectedAiRequest ||
          !shouldFetchAiRequestSuggestions({
            selectedAiRequest,
            isSending: isSendingAiRequest(selectedAiRequest.id),
            isFetchingSuggestions,
            profile,
            customEndpointEnabled: isCustomEndpointEnabled(),
            hasProject: !!project,
          })
        ) {
          return;
        }

        const activeUserId = profile ? profile.id : LOCAL_BYOK_USER_ID;

        // Check if there are tools being run. If so, no suggestions at this time.
        const hasFunctionsCallsToProcess =
          getFunctionCallsToProcess({
            aiRequest: selectedAiRequest,
            editorFunctionCallResults: getEditorFunctionCallResults(
              selectedAiRequest.id
            ),
          }).length > 0;
        if (hasFunctionsCallsToProcess) return;

        // If there are sub-agents running, it means the request is still running,
        // so no suggestions at this time.
        const hasPendingSubAgentCalls =
          getPendingSubAgentFunctionCalls({
            aiRequest: selectedAiRequest,
          }).length > 0;
        if (hasPendingSubAgentCalls) return;

        const {
          hasUnfinishedResult,
        } = getFunctionCallOutputsFromEditorFunctionCallResults(
          getEditorFunctionCallResults(selectedAiRequest.id)
        );
        if (hasUnfinishedResult) return;

        const outputForSuggestions = selectedAiRequest.output || [];
        const lastMessage =
          outputForSuggestions.length > 0
            ? outputForSuggestions[outputForSuggestions.length - 1]
            : null;
        if (
          !lastMessage ||
          (!(
            lastMessage.type === 'message' && lastMessage.role === 'assistant'
          ) &&
            lastMessage.type !== 'function_call_output') ||
          lastMessage.suggestions
        ) {
          return;
        }

        const lastMessageKey = lastMessage.messageId
          ? lastMessage.messageId
          : `index-${outputForSuggestions.length}`;
        const suggestionAttemptKey = `${
          selectedAiRequest.id
        }:${lastMessageKey}`;
        if (
          attemptedSuggestionMessageIdsRef.current.has(suggestionAttemptKey)
        ) {
          return;
        }

        const isLastMessageFunctionCallOutputProjectInitialization =
          lastMessage.type === 'function_call_output' &&
          getFunctionCallNameByCallId({
            aiRequest: selectedAiRequest,
            callId: lastMessage.call_id,
          }) === 'initialize_project';

        if (selectedAiRequest.mode === 'orchestrator') {
          if (isLastMessageFunctionCallOutputProjectInitialization) {
            // Don't fetch suggestions right after project initialization, as a plan
            // will be generated in the next messages and we want to display it instead.
            return;
          }
          if (getLatestActivePlan(selectedAiRequest)) {
            // For orchestrator mode, don't fetch suggestions if there is an active plan
            // being displayed.
            return;
          }
        }

        const simplifiedProjectBuilder = makeSimplifiedProjectBuilder(gd);
        const simplifiedProjectJson = project
          ? JSON.stringify(
              simplifiedProjectBuilder.getSimplifiedProject(project, {})
            )
          : null;
        const projectSpecificExtensionsSummaryJson = project
          ? JSON.stringify(
              simplifiedProjectBuilder.getProjectSpecificExtensionsSummary(
                project
              )
            )
          : null;
        const preparedAiUserContent = await prepareAiUserContent({
          getAuthorizationHeader,
          userId: activeUserId,
          simplifiedProjectJson,
          projectSpecificExtensionsSummaryJson,
          eventsJson: null,
        });

        try {
          // The request will switch from "ready" to "working" while suggestions are generated.
          // It will be watched and eventually return to "ready" with suggestions.
          setIsFetchingSuggestions(true);
          attemptedSuggestionMessageIdsRef.current.add(suggestionAttemptKey);
          const aiRequestWorkingForSuggestions = await getAiRequestSuggestions(
            getAuthorizationHeader,
            {
              userId: activeUserId,
              aiRequestId: selectedAiRequest.id,
              suggestionsType: isLastMessageFunctionCallOutputProjectInitialization
                ? 'list-with-explanations'
                : 'simple-list',
              gameProjectJsonUserRelativeKey:
                preparedAiUserContent.gameProjectJsonUserRelativeKey,
              gameProjectJson: preparedAiUserContent.gameProjectJson,
              projectSpecificExtensionsSummaryJsonUserRelativeKey:
                preparedAiUserContent.projectSpecificExtensionsSummaryJsonUserRelativeKey,
              projectSpecificExtensionsSummaryJson:
                preparedAiUserContent.projectSpecificExtensionsSummaryJson,
            }
          );

          // While we were fetching, the user may have sent a new message. If the
          // conversation advanced, drop the stale snapshot: the newer message wins.
          const snapshotOutput = aiRequestWorkingForSuggestions.output || [];
          updateAiRequest(selectedAiRequest.id, prevRequest => {
            if (!prevRequest) return aiRequestWorkingForSuggestions;
            if (isSendingAiRequest(selectedAiRequest.id)) return prevRequest;
            const prevOutput = prevRequest.output || [];
            if (prevOutput.length !== snapshotOutput.length) return prevRequest;
            return {
              ...prevRequest,
              ...aiRequestWorkingForSuggestions,
            };
          });

          // If the request is already ready with suggestions, clear the flag immediately
          // Otherwise, it will be watched and cleared when it becomes ready
          if (aiRequestWorkingForSuggestions.status === 'ready') {
            setIsFetchingSuggestions(false);
          }
        } catch (error) {
          const extractedStatusAndCode = extractGDevelopApiErrorStatusAndCode(
            error
          );
          if (
            extractedStatusAndCode &&
            extractedStatusAndCode.status === 400 &&
            extractedStatusAndCode.code === 'ai-request/request-still-working'
          ) {
            // Don't log anything.
            return;
          }

          setIsFetchingSuggestions(false);
          console.error('Error getting AI request suggestions:', error);
          // Do not block updating the request if suggestions fetching fails.
        }
      }

      // Debounce the call to avoid too many requests in a short period
      const timeoutId = setTimeout(() => {
        fetchSuggestionsIfNeeded();
      }, 300);

      return () => clearTimeout(timeoutId);
    },
    [
      selectedAiRequest,
      profile,
      getAuthorizationHeader,
      project,
      getEditorFunctionCallResults,
      updateAiRequest,
      isSendingAiRequest,
      isFetchingSuggestions,
      setIsFetchingSuggestions,
    ]
  );

  React.useEffect(
    () => {
      async function updateAiRequestWithProjectVersion({
        lastMessageId,
        version,
        shouldSaveVersionBeforeMessage,
        shouldSaveVersionAfterMessage,
      }: {|
        lastMessageId: string,
        version: string,
        shouldSaveVersionBeforeMessage: boolean,
        shouldSaveVersionAfterMessage: boolean,
      |}) {
        if (!selectedAiRequest || !profile) return;

        const projectVersionIdBeforeMessage = shouldSaveVersionBeforeMessage
          ? version
          : undefined;
        const projectVersionIdAfterMessage = shouldSaveVersionAfterMessage
          ? version
          : undefined;

        await updateAiRequestMessage(getAuthorizationHeader, {
          userId: profile.id,
          aiRequestId: selectedAiRequest.id,
          aiRequestMessageId: lastMessageId,
          projectVersionIdBeforeMessage,
          projectVersionIdAfterMessage,
        });
        // Update the request with the project version, merging with the latest state
        updateAiRequest(selectedAiRequest.id, prevRequest => {
          if (!prevRequest) {
            console.error(
              'Attempting to update project version on non-existent request'
            );
            return selectedAiRequest;
          }
          return {
            ...prevRequest,
            output: (prevRequest.output || []).map(
              (message: AiRequestMessage) => {
                if (
                  message.messageId === lastMessageId &&
                  message.role !== 'user'
                ) {
                  // $FlowFixMe[incompatible-type] - Flow is not able to understand this is the right type.
                  return {
                    ...message,
                    projectVersionIdAfterMessage,
                  };
                }
                if (
                  message.messageId === lastMessageId &&
                  message.role === 'user'
                ) {
                  // $FlowFixMe[incompatible-type] - Flow is not able to understand this is the right type.
                  return {
                    ...message,
                    projectVersionIdBeforeMessage,
                  };
                }
                return message;
              }
            ),
          };
        });
      }

      async function saveCloudProjectAndStoreOnMessageIfNeeded() {
        // If the request :
        // - is an agent request,
        // - is not sending a new message right now,
        // - has a few messages already (not an empty request),
        // Then we check depending on the type of the last message if we need to save the project
        // and link the project version to it,
        // to allow the user to restore the project to that state later.
        if (
          !selectedAiRequest ||
          (selectedAiRequest.mode !== 'agent' &&
            selectedAiRequest.mode !== 'orchestrator') ||
          isSendingAiRequest(selectedAiRequest.id) ||
          !selectedAiRequest.output ||
          selectedAiRequest.output.length === 0 ||
          !profile ||
          !project ||
          !onSave ||
          !onSaveProjectAsWithStorageProvider ||
          !storageProviderName ||
          isSavingRef.current
        ) {
          return;
        }

        const outputForSave = selectedAiRequest.output || [];
        const lastMessage =
          outputForSave.length > 0
            ? outputForSave[outputForSave.length - 1]
            : null;
        const lastMessageId = lastMessage ? lastMessage.messageId : null;
        if (!lastMessage || !lastMessageId) {
          return;
        }

        const hasFunctionsCallsToProcess =
          getFunctionCallsToProcess({
            aiRequest: selectedAiRequest,
            editorFunctionCallResults: getEditorFunctionCallResults(
              selectedAiRequest.id
            ),
          }).length > 0;
        const {
          hasUnfinishedResult,
        } = getFunctionCallOutputsFromEditorFunctionCallResults(
          getEditorFunctionCallResults(selectedAiRequest.id)
        );
        const hasPendingSubAgentCalls =
          getPendingSubAgentFunctionCalls({
            aiRequest: selectedAiRequest,
          }).length > 0;

        const hasJustInitializedProject =
          lastMessage.type === 'function_call_output' &&
          getFunctionCallNameByCallId({
            aiRequest: selectedAiRequest,
            callId: lastMessage.call_id,
          }) === 'initialize_project';

        // Save as cloud project right after initialization, even if the request
        // is still working (orchestrator keeps running after initialize_project).
        const shouldSaveProjectAsAfterInitialization =
          hasJustInitializedProject &&
          !currentlyOpenedCloudProjectVersionId &&
          !isCloudProjectsMaximumReached;

        const shouldSaveVersionBeforeMessage =
          lastMessage.type === 'message' &&
          lastMessage.role === 'user' &&
          !lastMessage.projectVersionIdBeforeMessage;
        const shouldSaveVersionAfterMessage =
          selectedAiRequest.status === 'ready' &&
          (lastMessage.role === 'assistant' ||
            lastMessage.type === 'function_call_output') &&
          !lastMessage.projectVersionIdAfterMessage &&
          !hasFunctionsCallsToProcess &&
          !hasUnfinishedResult &&
          !hasPendingSubAgentCalls;
        if (
          !shouldSaveVersionBeforeMessage &&
          !shouldSaveVersionAfterMessage &&
          !shouldSaveProjectAsAfterInitialization
        ) {
          return;
        }
        try {
          if (shouldSaveProjectAsAfterInitialization) {
            console.info(
              'Saving project after initialization from AI Request...'
            );
            // Try to save the project in the cloud, giving the ability
            // to restore to previous versions.
            isSavingRef.current = true;
            setSavingProjectForMessageId(lastMessageId);
            onSaveProjectAsWithStorageProvider({
              requestedStorageProvider: CloudStorageProvider,
              forcedSavedAsLocation: {
                name: project ? project.getName() : 'Untitled game',
              },
              createdProject: project,
            }).then(async (newFileMetadata: ?FileMetadata) => {
              console.info(
                'Updating AI request message with latest project version after save...'
              );
              const newVersion = newFileMetadata
                ? newFileMetadata.version
                : null;
              if (!newVersion) {
                isSavingRef.current = false;
                setSavingProjectForMessageId(null);
                return;
              }

              try {
                await updateAiRequestWithProjectVersion({
                  lastMessageId,
                  version: newVersion,
                  // The initialization output is always an "after message" version.
                  shouldSaveVersionBeforeMessage: false,
                  shouldSaveVersionAfterMessage: true,
                });
              } catch (error) {
                console.error(
                  'Error updating AI request message with latest project version:',
                  error
                );
              }
              isSavingRef.current = false;
              setSavingProjectForMessageId(null);
            });
            return;
          }

          if (!currentlyOpenedCloudProjectVersionId) {
            // AI Request on a project not saved in the cloud, do not force saving it.
            return;
          }

          if (!hasUnsavedChanges) {
            console.info(
              'Updating AI request message with current project version...'
            );
            // No unsaved changes, just update the last message with the version opened.
            await updateAiRequestWithProjectVersion({
              lastMessageId,
              version: currentlyOpenedCloudProjectVersionId,
              shouldSaveVersionBeforeMessage,
              shouldSaveVersionAfterMessage,
            });
            return;
          }

          isSavingRef.current = true;
          setSavingProjectForMessageId(lastMessageId);
          console.info('Saving project as part of AI request...');
          // Trigger a save, and then update the last message with the new versionId.
          onSave({ skipNewVersionWarning: true }).then(
            async (newFileMetadata: ?FileMetadata) => {
              console.info(
                'Updating AI request message with latest project version after save...'
              );
              const newVersion = newFileMetadata
                ? newFileMetadata.version
                : null;
              if (!newVersion) {
                isSavingRef.current = false;
                setSavingProjectForMessageId(null);
                return;
              }

              try {
                await updateAiRequestWithProjectVersion({
                  lastMessageId,
                  version: newVersion,
                  shouldSaveVersionBeforeMessage,
                  shouldSaveVersionAfterMessage,
                });
              } catch (error) {
                console.error(
                  'Error updating AI request message with latest project version:',
                  error
                );
              }
              isSavingRef.current = false;
              setSavingProjectForMessageId(null);
            }
          );
        } catch (error) {
          console.error(
            'Error saving cloud project version after AI message:',
            error
          );
          // Do not block updating the request if save fails.
        }
      }

      // Debounce the call to avoid too many requests in a short period.
      const timeoutId = setTimeout(() => {
        saveCloudProjectAndStoreOnMessageIfNeeded();
      }, 300);

      return () => clearTimeout(timeoutId);
    },
    [
      selectedAiRequest,
      profile,
      getAuthorizationHeader,
      project,
      getEditorFunctionCallResults,
      updateAiRequest,
      isSendingAiRequest,
      currentlyOpenedCloudProjectVersionId,
      hasUnsavedChanges,
      onSave,
      onSaveProjectAsWithStorageProvider,
      isCloudProjectsMaximumReached,
      fileMetadata,
      storageProviderName,
    ]
  );

  React.useEffect(
    () => {
      // Reset selected request if user logs out.
      if (!profile) {
        setSelectedAiRequestId(null);
      }
    },
    [profile, setSelectedAiRequestId]
  );

  // Selection-load is intentionally NOT reimplemented here. AiRequestProvider's
  // loadAiRequest effect is the single path: it manages loading/error state,
  // suspends work-in-progress chats, and works offline for local-ai-*/custom
  // endpoint ids. A second fetch from this hook raced that path when a profile
  // was present (double getAiRequest) and cleared the selection on failure
  // instead of keeping the Context's retry UI.

  return {
    isFetchingSuggestions,
    savingProjectForMessageId,
  };
};

// If any of those props is undefined, the previous value is kept.
export type OpenAskAiOptions = {|
  aiRequestId?: string | null, // If null, a new request will be created.
  paneIdentifier?: 'left' | 'center' | 'right',
  continueProcessingFunctionCallsOnMount?: boolean,
  // When set, a new chat is started with this text pre-filled in the input.
  prefilledUserRequest?: string,
|};

export type NewAiRequestOptions = {|
  mode: 'chat' | 'agent' | 'orchestrator',
  userRequest: string,
  aiConfigurationPresetId: string,
|};
