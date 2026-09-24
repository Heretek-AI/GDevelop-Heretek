// @flow
import {
  STUDIO_ROLES,
  READ_ONLY_TOOL_NAMES,
  MUTATING_TOOL_NAMES,
  getStudioRole,
  getToolsForRole,
} from './Roles';
import { GDEVELOP_OPENAI_TOOLS } from '../../AI/CustomAIClient';

describe('Studio roles', () => {
  const allToolNames: Array<string> = GDEVELOP_OPENAI_TOOLS.map(
    tool => tool.function.name
  );
  const availableToolNames = new Set(allToolNames);

  const roleIds = Object.keys(STUDIO_ROLES);

  it('declares exactly the four studio roles', () => {
    expect(roleIds.sort()).toEqual([
      'designer',
      'developer',
      'manager',
      'tester',
    ]);
  });

  it('every role only names tools that exist', () => {
    roleIds.forEach(roleId => {
      const unknown = STUDIO_ROLES[(roleId: any)].allowedToolNames.filter(
        name => !availableToolNames.has(name)
      );
      expect({ roleId, unknown }).toEqual({ roleId, unknown: [] });
    });
  });

  it('declares every role id and display name consistently', () => {
    roleIds.forEach(roleId => {
      const role = getStudioRole((roleId: any));
      expect(role.id).toBe(roleId);
      expect(role.displayName.length).toBeGreaterThan(0);
      expect(role.systemPrompt.length).toBeGreaterThan(0);
      expect(role.maxTurns).toBeGreaterThan(0);
      // A role with no allowed tool could only talk - it would waste a turn.
      expect(role.allowedToolNames.length).toBeGreaterThan(0);
    });
  });

  it('throws on an unknown role', () => {
    expect(() => getStudioRole(('architect': any))).toThrow(
      'Unknown studio role'
    );
  });

  it('getToolsForRole filters by name and preserves schema order', () => {
    const developerTools = getToolsForRole('developer', GDEVELOP_OPENAI_TOOLS);
    const developerToolNames = developerTools.map(tool => tool.function.name);

    expect(developerToolNames.length).toBeGreaterThan(0);
    // Nothing outside the declared subset leaks in.
    developerToolNames.forEach(name =>
      expect(STUDIO_ROLES.developer.allowedToolNames).toContain(name)
    );
    // Order is the schema's, not the declaration's.
    const schemaOrder = allToolNames.filter(name =>
      developerToolNames.includes(name)
    );
    expect(developerToolNames).toEqual(schemaOrder);

    // The role's whole declared set is offered, since every developer tool is in
    // the schema.
    expect(developerToolNames.sort()).toEqual(
      [...STUDIO_ROLES.developer.allowedToolNames].sort()
    );
  });

  it('getToolsForRole skips a declared tool that the schema does not have', () => {
    // No throw, no placeholder entry.
    const tools = getToolsForRole('manager', [
      { type: 'function', function: { name: 'not_a_real_tool' } },
      { type: 'function', function: { name: 'spawn_agent' } },
    ]);
    expect(tools.map(tool => tool.function.name)).toEqual(['spawn_agent']);
  });

  it('the tester cannot change the project and the designer can only write variables', () => {
    const testerToolNames = new Set(STUDIO_ROLES.tester.allowedToolNames);
    expect(STUDIO_ROLES.tester.readOnly).toBe(true);
    expect(testerToolNames.has('run_script')).toBe(false);
    expect(testerToolNames.has('create_scene')).toBe(false);
    expect(testerToolNames.has('create_or_replace_object')).toBe(false);
    expect(testerToolNames.has('put_2d_instances')).toBe(false);
    expect(testerToolNames.has('put_3d_instances')).toBe(false);
    expect(testerToolNames.has('add_scene_events')).toBe(false);
    expect(testerToolNames.has('create_extension')).toBe(false);

    // The designer writes only variables: every other tool it may call is one
    // of the declared read-only tools.
    const designerToolNames = STUDIO_ROLES.designer.allowedToolNames;
    expect(designerToolNames).toContain('add_or_edit_variable');
    const designerReadOnlyTools = designerToolNames.filter(
      name => name !== 'add_or_edit_variable'
    );
    expect(
      designerReadOnlyTools.filter(name => !READ_ONLY_TOOL_NAMES.includes(name))
    ).toEqual([]);
    // And the tester writes no game content: its only mutating tools (per W1)
    // are the two gameplay-test tools, which change test definitions, never the
    // game itself.
    const testerMutations = STUDIO_ROLES.tester.allowedToolNames.filter(name =>
      MUTATING_TOOL_NAMES.includes(name)
    );
    expect(testerMutations.sort()).toEqual(
      ['change_gameplay_tests', 'run_gameplay_test'].sort()
    );
  });

  it('only the manager may delegate, so a sub-agent never spawns a sub-agent', () => {
    expect(STUDIO_ROLES.manager.allowedToolNames).toContain('spawn_agent');
    ['designer', 'developer', 'tester'].forEach(roleId => {
      expect(STUDIO_ROLES[(roleId: any)].allowedToolNames).not.toContain(
        'spawn_agent'
      );
    });
  });

  it('the manager forwards established facts so sub-agents do not re-derive them', () => {
    // Observed failure: a developer re-probed the run_script sandbox and the
    // texture constraints for ten turns after the designer had settled them,
    // because the spawn instruction carried none of it.
    expect(STUDIO_ROLES.manager.systemPrompt).toContain(
      'facts already established'
    );
  });

  it('the developer prompt documents the sandbox and the image-texture path', () => {
    // Same failure from the developer side: without it, the first resort was
    // enumerating `gd`/globals/webpack chunks, and the second was hunting a
    // non-existent image upload.
    const prompt = STUDIO_ROLES.developer.systemPrompt;
    expect(prompt).toContain('never probe for project access');
    expect(prompt).toContain('no tool uploads an image');
    expect(prompt).toContain('search_object_asset_store');
  });

  it('gives the developer every mutating tool the schema offers, and the tester none', () => {
    const mutatingNames = [
      'run_script',
      'create_scene',
      'create_or_replace_object',
      'change_object_properties_effects',
      'add_behavior',
      'change_behavior_property',
      'put_2d_instances',
      'put_3d_instances',
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
    mutatingNames.forEach(name => {
      expect(STUDIO_ROLES.developer.allowedToolNames).toContain(name);
      expect(STUDIO_ROLES.tester.allowedToolNames).not.toContain(name);
    });
  });
});
