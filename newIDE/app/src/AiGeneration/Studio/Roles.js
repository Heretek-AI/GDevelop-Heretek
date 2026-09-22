// @flow

/**
 * The role registry of the local (BYOK) AI game studio.
 *
 * Upstream's hosted backend runs a multi-agent company server-side: it decides
 * which sub-agents exist and what each may do. Under BYOK there is no server, so
 * the fork has to declare that here: for every role, the prompt it runs with, the
 * exact tools it may call, whether it may change the project, and how many
 * assistant turns it gets before it is finalized.
 *
 * Roles are a fork concept. Nothing in the hosted path reads this file: the
 * server's own `run_edit_agent`/`run_explorer_agent` split is unrelated and keeps
 * working untouched (see `EditorFunctions/index.js`).
 */

export type StudioRoleId = 'manager' | 'designer' | 'developer' | 'tester';

export type StudioRole = {|
  id: StudioRoleId,
  /** Shown in the chat for the sub-agent. Becomes `short_title` of the spawn call. */
  displayName: string,
  /** Prepended to the shared system prompt for this role's requests. */
  systemPrompt: string,
  /**
   * Exact tool names exposed to this role. Any name not listed here is never
   * sent to the model (see `getToolsForRole`), so a role cannot be talked into
   * using a tool it was not granted.
   */
  allowedToolNames: Array<string>,
  /**
   * True when the role's tools may not mutate the project. Drives the read-only
   * `run_script` restriction and skips the edit approval prompt.
   */
  readOnly: boolean,
  /**
   * Hard cap on assistant turns for one sub-agent request. On reaching it, the
   * agent is finalized with its last message (see `FinalizeSubAgents`).
   */
  maxTurns: number,
|};

/** The tools that only read the project, shared by the roles that inspect. */
export const READ_ONLY_TOOL_NAMES: Array<string> = [
  'read_game_project_json',
  'read_events_source',
  'describe_instances',
  'inspect_variables',
  'inspect_object_properties_effects',
  'inspect_scene_properties_layers_effects',
  'inspect_project_properties_resources',
  'inspect_behavior_properties',
  'inspect_extension',
  'search_object_asset_store',
  'search_resource_store',
  'search_docs',
  'read_full_docs',
];

/** Every tool that changes the project, in schema order. */
export const MUTATING_TOOL_NAMES: Array<string> = [
  'run_script',
  'create_scene',
  'create_or_replace_object',
  'change_object_properties_effects',
  'add_behavior',
  'change_behavior_property',
  'put_2d_instances',
  'put_3d_instances',
  // `generate_events` is a registry alias of this one, not a separate tool the
  // schema exposes (see EditorFunctions/index.js).
  'add_scene_events',
  'change_scene_properties_layers_effects_groups',
  'change_project_properties_resources',
  'add_or_edit_variable',
  'create_extension',
  'change_extension_properties',
  'create_custom_object',
  'change_custom_object',
  'create_custom_behavior',
  'change_custom_behavior',
  'create_custom_function',
  'change_custom_function',
];

export const STUDIO_ROLES: { [StudioRoleId]: StudioRole } = {
  manager: {
    id: 'manager',
    displayName: 'Studio lead',
    readOnly: false,
    maxTurns: 60,
    allowedToolNames: [
      'create_or_update_plan',
      'spawn_agent',
      'read_game_project_json',
      'describe_instances',
      'read_events_source',
      'inspect_variables',
      'inspect_scene_properties_layers_effects',
      'inspect_object_properties_effects',
      'inspect_extension',
      'inspect_project_properties_resources',
      'run_gameplay_test',
      'search_docs',
      'read_full_docs',
    ],
    systemPrompt: `You are the studio lead of a small game studio building a game in GDevelop.

Your job is to plan and delegate. You never edit the project yourself - you have no tool to do so.

Follow this loop, every time:
1. Decompose the goal into a short list of concrete tasks with create_or_update_plan. Give each task an id, a title, a description of what "done" means, and any dependsOn.
2. Delegate each ready task with spawn_agent. Pick the role that matches the work: designer for the design document, developer for anything that changes the project, tester for verifying a feature. Give each sub-agent a complete, self-contained instruction - it cannot see this conversation.
3. Pass the plan task's id as related_task_id, so the task is marked done when the agent reports back.
4. Wait for a sub-agent's report before treating its task as done. Do not spawn a second agent for the same task.
5. If a report says the work failed or is incomplete, spawn a follow-up agent with the specifics, or report the problem to the user.

Finish with a short summary of what was built, what was verified, and what is left. If a task genuinely cannot be done with the tools available, say so plainly instead of delegating it again.`,
  },

  designer: {
    id: 'designer',
    displayName: 'Designer',
    readOnly: false,
    maxTurns: 30,
    // The only mutating tool: a design document has to survive into the next
    // role, and project variables are the only artifact a later agent can read.
    allowedToolNames: [...READ_ONLY_TOOL_NAMES, 'add_or_edit_variable'],
    systemPrompt: `You are the designer of a small game studio. You produce the game design document for the studio lead.

You write the design as GDevelop project variables: one variable per section, named with the GDD_ prefix (for example GDD_Overview, GDD_Economy, GDD_Progression, GDD_Controls), with a string value holding the section's text. Project variables are the only artifact the next role can read - never write your design only as a chat message.

You never create scenes, objects or events: another role does that. Your tools that change anything are limited to add_or_edit_variable.

Read the project first with read_game_project_json and describe_instances, so the design fits what already exists. Be specific and numeric: name the resources, the costs, the rates and the win condition, so the developer does not have to invent them. Report which GDD_ variables you wrote.`,
  },

  developer: {
    id: 'developer',
    displayName: 'Developer',
    readOnly: false,
    maxTurns: 80,
    allowedToolNames: [
      ...MUTATING_TOOL_NAMES,
      'read_game_project_json',
      'read_events_source',
      'describe_instances',
      'inspect_variables',
      'inspect_object_properties_effects',
      'inspect_behavior_properties',
      'inspect_scene_properties_layers_effects',
      'inspect_extension',
      'inspect_project_properties_resources',
      'search_object_asset_store',
      'search_resource_store',
      'search_docs',
      'read_full_docs',
    ],
    systemPrompt: `You are the developer of a small game studio. You implement exactly the task you were given, and nothing else.

Read the GDD_ project variables first: they hold the design you are implementing. If the task you were given contradicts them, follow the task and say so in your report.

Prefer run_script when a change needs many calls (placing a grid of instances, setting up many objects): one script doing fifty calls beats fifty tool calls. Await every call inside the script, and keep the script under a few hundred calls.

Inspect before you write: read the project, describe the instances and inspect the objects you are about to change, so you edit what actually exists.

When you are done, report what you changed, naming the scenes, objects, variables and events you touched, and state anything you could not do. A partial implementation reported honestly is worth more than a silent failure.`,
  },

  tester: {
    id: 'tester',
    displayName: 'QA tester',
    readOnly: true,
    maxTurns: 30,
    // Nothing here changes the project: the tester writes a test, runs it, and
    // reports. `change_gameplay_tests` is the one exception - it edits a test
    // definition, never the game.
    allowedToolNames: [
      'run_gameplay_test',
      'change_gameplay_tests',
      'read_game_project_json',
      'read_events_source',
      'describe_instances',
      'inspect_variables',
      'inspect_object_properties_effects',
      'inspect_scene_properties_layers_effects',
      'inspect_behavior_properties',
    ],
    systemPrompt: `You are the QA tester of a small game studio. You verify the feature you were asked about, and you never change game content.

Write a gameplay test with run_gameplay_test, using harness assertions that actually exercise the named feature - assert on the state the feature is supposed to produce, not on it merely existing. Read the project first so your test names the real objects, scenes and variables.

Run the test, then report PASS or FAIL and quote the assertions and any errors verbatim. If it fails, say which assertion failed and what the game did instead. If the feature is not implemented at all, say that plainly: a missing feature is a finding, not a test to make pass.`,
  },
};

/** The roles a `spawn_agent` call may name. A sub-agent never spawns sub-agents. */
export const SPAWNABLE_ROLE_IDS: Array<StudioRoleId> = [
  'designer',
  'developer',
  'tester',
];

export const isStudioRoleId = (value: any): boolean =>
  typeof value === 'string' && !!STUDIO_ROLES[(value: any)];

export const isSpawnableRoleId = (value: any): boolean =>
  isStudioRoleId(value) && SPAWNABLE_ROLE_IDS.includes((value: StudioRoleId));

export const getStudioRole = (roleId: StudioRoleId): StudioRole => {
  const role = STUDIO_ROLES[roleId];
  if (!role) {
    throw new Error(`Unknown studio role: ${String(roleId)}.`);
  }
  return role;
};

/**
 * The subset of `allTools` a role may call, in `allTools` order.
 *
 * A role naming a tool that is not in `allTools` is not an error: the tool is
 * skipped. That keeps a role declaration usable against an older tool schema
 * (and lets `Roles.spec.js` state the invariant without importing a second
 * source of truth).
 */
export const getToolsForRole = (
  roleId: StudioRoleId,
  allTools: Array<Object>
): Array<Object> => {
  const allowedNames = new Set(getStudioRole(roleId).allowedToolNames);
  return allTools.filter(
    tool => !!tool && !!tool.function && allowedNames.has(tool.function.name)
  );
};
