// @ts-nocheck The runtime types do not describe the internals these tests drive
// (the instance pool, the resource manager registry), which the built runtime
// does expose.

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

  const make3DLayerData = (name) => ({
    name,
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

  const createSceneWith3DLayer = (runtimeGame) => {
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    runtimeScene.addLayer(make3DLayerData(''));
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

  const getPoolKey = (runtimeScene) => getLayerPool(runtimeScene).getKeys()[0];

  it('shares one InstancedMesh between same-key models and draws no clones', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    createModel3D(runtimeScene, 'First', true);
    createModel3D(runtimeScene, 'Second', true);
    runtimeScene.render();

    // (i) one InstancedMesh in the layer group and no per-object clones.
    expect(countInstancedMeshes(runtimeScene)).to.be(1);
    expect(countGroups(runtimeScene)).to.be(0);
  });

  it('grows past the initial capacity without throwing or losing matrices', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    // 16 fill the initial capacity; the 17th grows the mesh.
    for (let i = 0; i < 16; i++) {
      const object = createModel3D(runtimeScene, 'O' + i, true);
      object.setX(i * 1000);
    }
    runtimeScene.render();

    // (ii) the 17th acquire grows the mesh (pre-fix: `TypeError` on `null.add`).
    const seventeenth = createModel3D(runtimeScene, 'O16', true);
    seventeenth.setX(16000);

    // Slots 0..15 keep the matrices written before the grow.
    const instancedMesh = getLayerPool(runtimeScene).getInstancedMesh(
      getPoolKey(runtimeScene)
    );
    expect(instancedMesh).to.be.ok();
    const matrix = new THREE.Matrix4();
    for (let slot = 0; slot < 16; slot++) {
      instancedMesh.getMatrixAt(slot, matrix);
      // A lost/collapsed slot would have a zero scale; the grow copies it as-is.
      expect(matrix.elements[0]).to.not.be(0);
    }
  });

  it('collapses the slot of a deleted model to zero scale', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    const first = createModel3D(runtimeScene, 'First', true);
    createModel3D(runtimeScene, 'Second', true);
    runtimeScene.render();

    const instancedMesh = getLayerPool(runtimeScene).getInstancedMesh(
      getPoolKey(runtimeScene)
    );
    const matrix = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).to.not.be(0);

    // (iii) deleting the first model collapses its slot (pre-fix: drawn forever).
    runtimeScene.markObjectForDeletion(first);
    runtimeScene.render();
    instancedMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).to.be(0);
  });

  it('rewrites the instance matrix on rotation', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    const object = createModel3D(runtimeScene, 'First', true);
    runtimeScene.render();

    const instancedMesh = getLayerPool(runtimeScene).getInstancedMesh(
      getPoolKey(runtimeScene)
    );
    const matrix = new THREE.Matrix4();
    instancedMesh.getMatrixAt(0, matrix);
    const before = matrix.elements[0];

    // (iv) a rotation reaches the instance matrix (pre-fix: unchanged).
    object.setAngle(Math.PI / 2);
    runtimeScene.render();
    instancedMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).to.not.be(before);
  });

  it('collapses the slot on hide and restores it on unhide', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    const object = createModel3D(runtimeScene, 'First', true);
    runtimeScene.render();

    const instancedMesh = getLayerPool(runtimeScene).getInstancedMesh(
      getPoolKey(runtimeScene)
    );
    const matrix = new THREE.Matrix4();

    // (v) hide collapses the slot; unhide restores the transform matrix.
    object.hide(true);
    runtimeScene.render();
    instancedMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).to.be(0);

    object.hide(false);
    runtimeScene.render();
    instancedMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).to.not.be(0);
  });

  it('moves the instance matrix to the new layer pool on a layer change', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    runtimeScene.addLayer(make3DLayerData(''));
    runtimeScene.addLayer(make3DLayerData('other'));

    const object = createModel3D(runtimeScene, 'First', true);
    runtimeScene.render();

    const sourceMesh = runtimeScene
      .getLayer('')
      .getRenderer()
      .getModelInstancePool()
      .getInstancedMesh(
        runtimeScene.getLayer('').getRenderer().getModelInstancePool().getKeys()[0]
      );
    const matrix = new THREE.Matrix4();
    sourceMesh.getMatrixAt(0, matrix);
    const before = matrix.elements[0];

    // (vi) the slot is re-acquired from the destination layer's pool.
    object.setLayer('other');
    runtimeScene.render();

    const targetPool = runtimeScene
      .getLayer('other')
      .getRenderer()
      .getModelInstancePool();
    const targetMesh = targetPool.getInstancedMesh(targetPool.getKeys()[0]);
    expect(targetMesh).to.be.ok();
    targetMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).to.be(before);
  });

  it('silently keeps the clone path for a Basic material', async () => {
    const runtimeGame = await makeGameWithSingleMeshModel();
    const runtimeScene = createSceneWith3DLayer(runtimeGame);

    // "Basic" replaces every material per instance: not shareable.
    createModel3D(runtimeScene, 'Basic', true, 'Basic');
    runtimeScene.render();

    // Materials/skins/animation clips never take the instanced path.
    expect(countInstancedMeshes(runtimeScene)).to.be(0);
    expect(countGroups(runtimeScene)).to.be(1);
  });
});
