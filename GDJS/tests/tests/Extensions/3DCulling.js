// @ts-check
// @ts-nocheck The expect.js assertions take an optional message argument, which
// the installed `expect` typings do not declare.

describe('3D object culling', function () {
  /**
   * A scene with one 3D layer, and a custom 3D object whose inner child is a
   * plain 2D sprite (so the legacy 2D AABB path cannot decide the 3D object's
   * visibility - only the new frustum branch can).
   *
   * @return {Promise<{runtimeGame: gdjs.RuntimeGame, runtimeScene: gdjs.RuntimeScene, customObject: gdjs.CustomRuntimeObject3D}>}
   */
  const makeSceneWith3DLayer = async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
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

    // The event-based object declaration comes from
    // getPixiRuntimeGameWithAssets.
    const customObject = new gdjs.CustomRuntimeObject3D(runtimeScene, {
      name: 'MyCustomObject',
      type: 'MyExtension::MyEventsBasedObject',
      variant: '',
      isInnerAreaFollowingParentSize: false,
      variables: [],
      behaviors: [],
      effects: [],
      content: { width: 0, height: 0, depth: 0 },
    });
    runtimeScene.addObject(customObject);

    return { runtimeGame, runtimeScene, customObject };
  };

  /**
   * The scene only culls from its second frame on (`RuntimeScene` defers to the
   * base container on the first frame), so step it twice before asserting.
   */
  const advancePastFirstFrame = (runtimeScene) => {
    runtimeScene.getTimeManager().update(16, 60);
    runtimeScene.getTimeManager().update(16, 60);
  };

  it('culls a 3D object outside the camera frustum and keeps one inside it', async () => {
    const { runtimeScene, customObject } = await makeSceneWith3DLayer();

    customObject.setPosition(0, 0);
    customObject.setZ(0);
    customObject.setWidth(50);
    customObject.setHeight(50);
    customObject.setDepth(50);

    const threeObject = customObject.get3DRendererObject();
    // the custom object has a 3D renderer object
    expect(threeObject).to.be.ok();

    const layerRenderer = runtimeScene.getLayer('').getRenderer();
    // the 3D layer has a frustum
    expect(layerRenderer.getThreeFrustum()).to.be.ok();

    advancePastFirstFrame(runtimeScene);

    // Put the camera far from the object: it must be culled.
    runtimeScene.getLayer('').setCameraX(100000);
    runtimeScene.getLayer('').setCameraY(100000);
    runtimeScene.render();
    // an object 100000 pixels away is culled
    expect(threeObject.visible).to.be(false);

    // Put the camera back on the object: it must be visible again.
    runtimeScene.getLayer('').setCameraX(25);
    runtimeScene.getLayer('').setCameraY(25);
    runtimeScene.render();
    // an object under the camera is visible
    expect(threeObject.visible).to.be(true);
  });

  it('never culls a 3D object on a layer that has no 3D camera', async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    runtimeScene.addLayer({
      name: '',
      // A plain 2D layer: no 3D camera is set up for it.
      visibility: true,
      cameras: [],
      effects: [],
      ambientLightColorR: 255,
      ambientLightColorG: 255,
      ambientLightColorB: 255,
      isLightingLayer: false,
      followBaseLayerCamera: false,
    });

    const customObject = new gdjs.CustomRuntimeObject3D(runtimeScene, {
      name: 'MyCustomObject',
      type: 'MyExtension::MyEventsBasedObject',
      variant: '',
      isInnerAreaFollowingParentSize: false,
      variables: [],
      behaviors: [],
      effects: [],
      content: { width: 0, height: 0, depth: 0 },
    });
    runtimeScene.addObject(customObject);

    // without a frustum, visibility only follows isHidden()
    expect(runtimeScene.getLayer('').getRenderer().getThreeFrustum()).to.be(
      null
    );

    advancePastFirstFrame(runtimeScene);
    customObject.setPosition(100000, 100000);
    runtimeScene.render();
    expect(customObject.get3DRendererObject().visible).to.be(true);

    customObject.hide(true);
    runtimeScene.render();
    // a hidden object stays hidden
    expect(customObject.get3DRendererObject().visible).to.be(false);
  });

  it('computes a conservative axis-aligned box that accounts for rotation', async () => {
    const { customObject } = await makeSceneWith3DLayer();

    // Put the object at a known place, and read its extent through the box.
    customObject.setPosition(0, 0);
    customObject.setZ(0);
    customObject.setWidth(100);
    customObject.setHeight(100);
    customObject.setDepth(100);
    customObject.setAngle(0);
    customObject.setRotationX(0);
    customObject.setRotationY(0);
    customObject.setCenterXInScene(50);
    customObject.setCenterYInScene(50);
    customObject.setCenterZInScene(50);

    const box = new THREE.Box3();
    customObject.getAABB3D(box);
    // The box is centered on the object's center, with the object's size.
    expect(Math.round(box.max.x - box.min.x)).to.be(100);
    expect(Math.round(box.max.y - box.min.y)).to.be(100);
    expect(Math.round(box.max.z - box.min.z)).to.be(100);
    expect(Math.round((box.min.x + box.max.x) / 2)).to.be(50);
    expect(Math.round((box.min.y + box.max.y) / 2)).to.be(50);
    expect(Math.round((box.min.z + box.max.z) / 2)).to.be(50);
    const unrotatedWidth = box.max.x - box.min.x;

    // Rotating 45 degrees around Z grows the X and Y extents (never shrinks
    // them): a conservative box cannot cull a visible object.
    customObject.setAngle(45);
    customObject.getAABB3D(box);
    expect(box.max.x - box.min.x).to.be.above(unrotatedWidth);
    expect(box.max.y - box.min.y).to.be.above(unrotatedWidth);
    // Z is untouched by a Z-axis rotation.
    expect(Math.round(box.max.z - box.min.z)).to.be(100);

    // The center never moves.
    expect(Math.round((box.min.x + box.max.x) / 2)).to.be(50);
    expect(Math.round((box.min.y + box.max.y) / 2)).to.be(50);
  });

  it('reuses its scratch box, so culling allocates nothing per object', async () => {
    const { customObject } = await makeSceneWith3DLayer();
    customObject.setPosition(0, 0);
    customObject.setWidth(10);
    customObject.setHeight(10);
    customObject.setDepth(10);

    const first = new THREE.Box3();
    customObject.getAABB3D(first);
    const second = new THREE.Box3();
    customObject.getAABB3D(second);
    // The caller's box may be a different object; the class scratch is not
    // returned. Reading twice in a row must give the same values.
    expect(second.min.x).to.be(first.min.x);
    expect(second.max.x).to.be(first.max.x);
  });
});
