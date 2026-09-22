// @ts-check
// @ts-nocheck The runtime types do not describe the internals these tests drive
// (the instance pool slot, the resource manager registry), which the built
// runtime does expose.

describe('Model3D instancing', function () {
  /** The single-mesh model shipped for these tests. */
  const MODEL_RESOURCE_NAME = 'model3D/tests-utils/assets/single-mesh.glb';

  /**
   * A game with one loaded single-mesh model resource, so the instanced path
   * can apply. `getPixiRuntimeGameWithAssets` has no 3D resource, so the model
   * is loaded through the manager from the test assets folder.
   * @return {Promise<gdjs.RuntimeGame>}
   */
  const makeGameWithSingleMeshModel = async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
    const model3DManager = runtimeGame.getModel3DManager();
    // The resource has to be declared for the manager to find its file.
    const resourceLoader = model3DManager._resourceLoader;
    resourceLoader.privateResourceManager._resources.set(MODEL_RESOURCE_NAME, {
      name: MODEL_RESOURCE_NAME,
      kind: 'model3D',
      file: 'base/GDJS/tests/tests-utils/assets/single-mesh.glb',
      metadata: '',
      userAdded: true,
    });
    await model3DManager.loadResource(MODEL_RESOURCE_NAME);
    return runtimeGame;
  };

  const createSceneWith3DLayer = (runtimeGame) => {
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    runtimeScene.addLayer({
      name: '',
      renderingType: '3d',
      cameraType: 'perspective',
      visibility: true,
      cameras: [],
      effects: [],
      ambientLightColorR: 255,
      ambientLightColorG: 255,
      ambientLightColorB: 255,
      isLightingLayer: false,
      followBaseLayerCamera: false,
    });
    return runtimeScene;
  };

  /**
   * @param {gdjs.RuntimeInstanceContainer} instanceContainer
   * @param {string} name
   * @param {boolean} useInstancing
   * @param {string} [materialType]
   */
  const createModel3D = (
    instanceContainer,
    name,
    useInstancing,
    materialType = 'StandardWithoutMetalness'
  ) => {
    const object = new gdjs.Model3DRuntimeObject(instanceContainer, {
      name,
      type: 'Scene3D::Model3DObject',
      variables: [],
      behaviors: [],
      effects: [],
      content: {
        width: 100,
        height: 100,
        depth: 100,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        keepAspectRatio: false,
        modelResourceName: MODEL_RESOURCE_NAME,
        materialType,
        originLocation: 'TopLeft',
        centerLocation: 'ObjectCenter',
        animations: [],
        crossfadeDuration: 0,
        isCastingShadow: true,
        isReceivingShadow: true,
        useInstancing,
      },
    });
    instanceContainer.addObject(object);
    return object;
  };

  const getThreeChildren = (runtimeScene) =>
    runtimeScene.getLayer('').getRenderer().getThreeGroup().children;

  /** The instance pool of the scene's 3D layer. */
  const getLayerPool = (runtimeScene) =>
    runtimeScene.getLayer('').getRenderer().getModelInstancePool();

  // `constructor.name` is minified in the built runtime, so count with the
  // Three.js type flags instead.
  const countInstancedMeshes = (runtimeScene) =>
    getThreeChildren(runtimeScene).filter((child) => child.isInstancedMesh)
      .length;

  const countGroups = (runtimeScene) =>
    getThreeChildren(runtimeScene).filter((child) => child.isGroup).length;

  it('shares one InstancedMesh between instanced models and keeps the clone path for the others', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    const first = createModel3D(runtimeScene, 'First', true);
    const second = createModel3D(runtimeScene, 'Second', true);
    const third = createModel3D(runtimeScene, 'Third', true);
    // Not opted in: must keep the per-object clone.
    const cloned = createModel3D(runtimeScene, 'Cloned', false);

    runtimeScene.render();

    // the three instanced models share one InstancedMesh
    expect(countInstancedMeshes(runtimeScene)).to.be(1);
    // the fourth, non-instanced model still gets its own clone
    expect(countGroups(runtimeScene)).to.be(1);

    // moving the first instance rewrites its matrix
    expect(getLayerPool(runtimeScene).getKeys().length).to.be(1);
    expect(first.getRenderer().getInstanceSlot()).to.be(0);
    expect(second.getRenderer().getInstanceSlot()).to.be(1);
    expect(third.getRenderer().getInstanceSlot()).to.be(2);
    expect(cloned.getRenderer().getInstanceSlot()).to.be(null);
  });

  it('writes the instance matrix of each instance when it moves', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    const first = createModel3D(runtimeScene, 'First', true);
    const second = createModel3D(runtimeScene, 'Second', true);
    runtimeScene.render();

    const key = getLayerPool(runtimeScene).getKeys()[0];
    const instancedMesh = getLayerPool(runtimeScene).getInstancedMesh(key);
    expect(instancedMesh).to.be.ok();

    const matrix = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix);
    const firstX = matrix.elements[12];

    first.setX(1000);
    runtimeScene.render();
    instancedMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).to.be.above(firstX);

    instancedMesh.getMatrixAt(1, matrix);
    const secondX = matrix.elements[12];
    second.setX(2000);
    runtimeScene.render();
    instancedMesh.getMatrixAt(1, matrix);
    // the freed slot 0 is handed to the next instanced model
    expect(matrix.elements[12]).to.be.above(secondX);
  });

  it('frees a slot when an instanced model leaves the scene, for reuse', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    const first = createModel3D(runtimeScene, 'First', true);
    const second = createModel3D(runtimeScene, 'Second', true);
    runtimeScene.render();

    expect(first.getRenderer().getInstanceSlot()).to.be(0);
    expect(second.getRenderer().getInstanceSlot()).to.be(1);

    // Removing the first object gives slot 0 back.
    runtimeScene.markObjectForDeletion(first);
    runtimeScene.render();

    const third = createModel3D(runtimeScene, 'Third', true);
    runtimeScene.render();
    expect(third.getRenderer().getInstanceSlot()).to.be(0);
  });

  it('silently keeps the clone path for a Basic material', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    // "Basic" replaces every material per instance: not shareable.
    const object = createModel3D(runtimeScene, 'Basic', true, 'Basic');
    runtimeScene.render();

    expect(object.getRenderer().getInstanceSlot()).to.be(null);
    expect(countInstancedMeshes(runtimeScene)).to.be(0);
    expect(countGroups(runtimeScene)).to.be(1);
  });
});
