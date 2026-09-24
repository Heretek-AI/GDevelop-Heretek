// @flow
import { executeScript } from './ScriptRunner';
import { buildExposedScriptFunctions } from './ExposedFunctions';
import { NON_SCRIPTABLE_FUNCTION_NAMES } from './NonScriptableFunctionNames';
import {
  capScriptExecutionResult,
  buildNoEditorCallsGuidance,
} from './CapScriptOutput';

// Deliberately gd-free (like ScriptRunner.spec.js): fake registries following
// the EditorFunction contract, so the exposed-functions bridge and the output
// caps can be tested without a real project.

// The bridge only FORWARDS the collaborators bag and the project, so the tests
// pass deliberately partial fakes and assert what came out the other side.
const asCollaborators = (fake: Object): any => fake;
const asProject = (fake: mixed): any => fake;

const makeFakeEditorFunction = ({
  modifiesProject,
  launch,
}: {|
  modifiesProject?: boolean,
  launch?: (options: any) => Promise<any>,
|}) => ({
  modifiesProject: !!modifiesProject,
  launchFunction:
    launch ||
    (async (options: any) => ({ success: true, message: 'ok', options })),
});

describe('buildExposedScriptFunctions', () => {
  it('exposes client-side functions, excluding non-scriptable ones', () => {
    const editorFunctions = {
      create_scene: makeFakeEditorFunction({ modifiesProject: true }),
      describe_instances: makeFakeEditorFunction({}),
      run_script: makeFakeEditorFunction({ modifiesProject: true }),
      read_full_docs: makeFakeEditorFunction({}),
      generate_events: makeFakeEditorFunction({ modifiesProject: true }),
    };
    const editorFunctionsWithoutProject = {
      initialize_project: makeFakeEditorFunction({ modifiesProject: true }),
    };

    const exposed = buildExposedScriptFunctions({
      editorFunctions,
      editorFunctionsWithoutProject,
      launchOptions: asCollaborators({}),
      project: asProject({}),
    });

    const names = exposed.map(f => f.name).sort();
    expect(names).toEqual(['create_scene', 'describe_instances']);
    // Sanity: the excluded names are the non-scriptable ones.
    expect(NON_SCRIPTABLE_FUNCTION_NAMES.has('run_script')).toBe(true);
    expect(NON_SCRIPTABLE_FUNCTION_NAMES.has('read_full_docs')).toBe(true);
  });

  it('restricts to allowedFunctionNames when given', () => {
    const editorFunctions = {
      create_scene: makeFakeEditorFunction({ modifiesProject: true }),
      describe_instances: makeFakeEditorFunction({}),
      put_2d_instances: makeFakeEditorFunction({ modifiesProject: true }),
    };
    const exposed = buildExposedScriptFunctions({
      editorFunctions,
      editorFunctionsWithoutProject: {},
      launchOptions: asCollaborators({}),
      project: asProject({}),
      allowedFunctionNames: ['describe_instances'],
    });
    expect(exposed.map(f => f.name)).toEqual(['describe_instances']);
  });

  it('binds launch to the collaborators bag + per-call args + project', async () => {
    let received = null;
    const editorFunctions = {
      create_scene: makeFakeEditorFunction({
        modifiesProject: true,
        launch: async options => {
          received = options;
          return { success: true, message: 'created' };
        },
      }),
    };
    const exposed = buildExposedScriptFunctions({
      editorFunctions,
      editorFunctionsWithoutProject: {},
      launchOptions: asCollaborators({ i18n: 'FAKE_I18N', toolOptions: null }),
      project: asProject('FAKE_PROJECT'),
    });

    const result = await executeScript({
      jsCode: `await create_scene({ scene_name: 'Level1' });`,
      exposedFunctions: exposed,
    });

    expect(result.success).toBe(true);
    // The legacy `scene_name` is mapped to a `scope` before the call.
    expect(received).toEqual({
      i18n: 'FAKE_I18N',
      toolOptions: null,
      args: {
        scene_name: 'Level1',
        scope: { type: 'scene', scene_name: 'Level1' },
      },
      project: 'FAKE_PROJECT',
    });
  });
});

describe('capScriptExecutionResult', () => {
  it('reduces read-only outputs to { message } and keeps modifying outputs', async () => {
    const editorFunctions = {
      describe_instances: makeFakeEditorFunction({
        launch: async () => ({
          success: true,
          message: 'found',
          instances: Array.from({ length: 500 }, () => ({ x: 1, y: 2 })),
        }),
      }),
      create_scene: makeFakeEditorFunction({
        modifiesProject: true,
        launch: async () => ({
          success: true,
          message: 'created',
          sceneNames: ['A', 'B'],
        }),
      }),
    };
    const exposed = buildExposedScriptFunctions({
      editorFunctions,
      editorFunctionsWithoutProject: {},
      launchOptions: asCollaborators({}),
      project: asProject({}),
    });
    const result = await executeScript({
      jsCode: [
        `await describe_instances({ scene_name: 'L' });`,
        `await create_scene({ scene_name: 'L2' });`,
      ].join('\n'),
      exposedFunctions: exposed,
    });

    const capped = capScriptExecutionResult(result);
    const readOnlyRecord = capped.functionCallRecords[0];
    const modifyingRecord = capped.functionCallRecords[1];

    // Read-only: output reduced to just { message } (no big `instances` array).
    expect(readOnlyRecord.output).toEqual({ message: 'found' });
    expect(readOnlyRecord.output.instances).toBeUndefined();
    // Modifying: full output kept, and flagged.
    expect(modifyingRecord.output.sceneNames).toEqual(['A', 'B']);
    expect(modifyingRecord.didModifyProject).toBe(true);
    // The whole script modified the project.
    expect(capped.didModifyProject).toBe(true);
  });

  it('caps console logs with a truncation note', async () => {
    const jsCode = [
      'for (let i = 0; i < 150; i++) {',
      "  console.log('line ' + i);",
      '}',
    ].join('\n');
    const result = await executeScript({ jsCode, exposedFunctions: [] });
    const capped = capScriptExecutionResult(result);
    // 100 kept + 1 note line.
    expect(capped.consoleLogs.length).toBe(101);
    expect(capped.consoleLogs[100]).toContain('truncated');
  });

  it('teaches the API when a successful script called no editor functions', async () => {
    // The observed thrash: a model probing `gd`/globals/webpack chunks for
    // turns on end because nothing told it what IS in scope. A successful
    // zero-call script is that probe - answer it once, here.
    const result = await executeScript({
      jsCode: `const keys = [1, 2, 3];\nreturn keys.length;`,
      exposedFunctions: [],
    });
    expect(result.success).toBe(true);
    expect(result.functionCallRecords).toEqual([]);
    const capped = capScriptExecutionResult(result, [
      'create_scene',
      'describe_instances',
    ]);
    expect(capped.guidance).toContain('await create_or_replace_object');
    expect(capped.guidance).toContain('create_scene, describe_instances');
    expect(capped.guidance).toContain('do not probe');
  });

  it('omits the guidance once the script calls functions', async () => {
    const editorFunctions = {
      describe_instances: makeFakeEditorFunction({}),
    };
    const exposed = buildExposedScriptFunctions({
      editorFunctions,
      editorFunctionsWithoutProject: {},
      launchOptions: asCollaborators({}),
      project: asProject({}),
    });
    const result = await executeScript({
      jsCode: `await describe_instances({ scene_name: 'L' });`,
      exposedFunctions: exposed,
    });
    const capped = capScriptExecutionResult(result, ['describe_instances']);
    expect(capped.guidance).toBeUndefined();
  });

  it('omits the guidance on failure (the error already names the functions)', async () => {
    const result = await executeScript({
      jsCode: `await no_such_function({});`,
      exposedFunctions: [],
    });
    expect(result.success).toBe(false);
    const capped = capScriptExecutionResult(result, ['create_scene']);
    expect(capped.guidance).toBeUndefined();
    expect(capped.error).not.toBeNull();
  });

  it('omits the guidance when no function names are given', async () => {
    const result = await executeScript({
      jsCode: `return 42;`,
      exposedFunctions: [],
    });
    const capped = capScriptExecutionResult(result);
    expect(capped.guidance).toBeUndefined();
  });
});

describe('buildNoEditorCallsGuidance', () => {
  it('lists exactly the exposed names and the calling convention', () => {
    const guidance = buildNoEditorCallsGuidance(['b_fn', 'a_fn']);
    expect(guidance).toContain('await');
    expect(guidance).toContain('b_fn, a_fn');
  });
});
