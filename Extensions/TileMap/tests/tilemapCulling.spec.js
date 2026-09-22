// @ts-check
// @ts-nocheck The expect.js assertions take an optional message argument, which
// the installed `expect` typings do not declare.

describe('TileMap viewport culling', function () {
  const COLUMN_COUNT = 80;
  const ROW_COUNT = 80;
  const TILE_SIZE = 32;

  /**
   * The scene's camera is what the culling maths reads, so the layer is sized
   * to the map and positioned per test.
   * @param {gdjs.RuntimeGame} runtimeGame
   * @param {string} [layerName]
   */
  const createScene = (runtimeGame, layerName = '') => {
    const runtimeScene = new gdjs.RuntimeScene(runtimeGame);
    if (layerName !== '') {
      runtimeScene.addLayer({
        name: layerName,
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
    }
    runtimeScene.addLayer({
      name: '',
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
   * A large SimpleTileMap: `dimX + dimY > 100` is required for culling to apply.
   * The tile map itself is not loaded (the texture cache needs a real atlas
   * image); the culling maths only reads the dimensions and the object's grid
   * transform, both of which are set here.
   * @param {gdjs.RuntimeInstanceContainer} instanceContainer
   * @param {string} name
   */
  const createLargeSimpleTileMap = (instanceContainer, name) => {
    const object = new gdjs.SimpleTileMapRuntimeObject(instanceContainer, {
      name,
      type: 'TileMap::SimpleTileMap',
      variables: [],
      behaviors: [],
      effects: [],
      content: {
        atlasImage: '',
        rowCount: ROW_COUNT,
        columnCount: COLUMN_COUNT,
        tileSize: TILE_SIZE,
        tilesWithHitBox: '',
      },
    });
    instanceContainer.addObject(object);
    // The texture-cache path needs a real atlas image, which the test game has
    // none of, so the map is built directly: this is the same object the loader
    // assigns at the end of `_loadTileMap`. The culling maths only reads the
    // map's dimensions and tile size.
    object._tileMap = new TileMapHelper.EditableTileMap(
      TILE_SIZE,
      TILE_SIZE,
      COLUMN_COUNT,
      ROW_COUNT,
      new Map()
    );
    return object;
  };

  const computeBounds = (object) =>
    gdjs.computeTileMapCullingBounds(
      object,
      COLUMN_COUNT,
      ROW_COUNT,
      [0, 0, 0, 0]
    );

  /** left, right, top, bottom. */
  const width = (bounds) => bounds[1] - bounds[0];
  const height = (bounds) => bounds[3] - bounds[2];

  it('culls a large tile map to the camera tile bounds', async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
    const runtimeScene = createScene(runtimeGame);
    const tileMap = createLargeSimpleTileMap(runtimeScene, 'BigMap');

    // moving the camera changes the culled tile bounds
    expect(COLUMN_COUNT + ROW_COUNT).to.be.above(100);

    // Camera over the middle of the map: the drawn window is smaller than the map.
    runtimeScene.getLayer('').setCameraX(400);
    runtimeScene.getLayer('').setCameraY(400);
    const first = computeBounds(tileMap);

    expect(width(first)).to.be.below(COLUMN_COUNT);
    expect(height(first)).to.be.below(ROW_COUNT);
    // Inside the map: the window starts after 0 and is narrower than the map.
    expect(first[0] + first[2]).to.be.above(0);

    // Moving the camera moves the window.
    runtimeScene.getLayer('').setCameraX(1600);
    runtimeScene.getLayer('').setCameraY(1600);
    const second = computeBounds(tileMap);

    expect(second[0]).to.be.above(first[0]);

    // Never more than the whole map.
    expect(width(second)).to.be.below(COLUMN_COUNT + 1);
    expect(height(second)).to.be.below(ROW_COUNT + 1);
  });

  it('clamps the bounds to the map when the camera is far outside it', async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
    const runtimeScene = createScene(runtimeGame);
    const tileMap = createLargeSimpleTileMap(runtimeScene, 'BigMap');

    // Way outside, before the map: bounds stay inside [0, dim].
    runtimeScene.getLayer('').setCameraX(-100000);
    runtimeScene.getLayer('').setCameraY(-100000);
    const outside = computeBounds(tileMap);

    expect(outside[0]).to.be.below(1);
    expect(outside[2]).to.be.below(1);
    expect(outside[1]).to.be.below(COLUMN_COUNT + 1);
    expect(outside[3]).to.be.below(ROW_COUNT + 1);
    // The clamped window draws nothing rather than the whole map.
    expect(width(outside)).to.be(0);

    // Way outside, past the map: clamps on the far side.
    runtimeScene.getLayer('').setCameraX(1000000);
    runtimeScene.getLayer('').setCameraY(1000000);
    const far = computeBounds(tileMap);

    expect(far[0]).to.be(COLUMN_COUNT);
    expect(far[2]).to.be(ROW_COUNT);
    expect(far[1]).to.be.below(COLUMN_COUNT + 1);
    expect(far[3]).to.be.below(ROW_COUNT + 1);
  });

  it('draws a tile map nested in a custom object in full, without culling', async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
    const runtimeScene = createScene(runtimeGame);

    // The tile map's own container is the custom object, which has no camera of
    // its own: culling must resolve the camera from the scene's layer.
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

    const tileMap = createLargeSimpleTileMap(
      // The tile map lives in the custom object's own container, which has no
      // camera: culling must resolve the camera from the scene's layer.
      customObject._instanceContainer,
      'BigMap'
    );
    // The tile map's own container is the custom object, which has no camera of
    // its own. Culling with a wrong window would draw the wrong tiles, so a
    // nested tile map is deliberately drawn in full: the camera must be
    // resolved from the scene's layer only when the container is the scene.
    const bounds = computeBounds(tileMap);
    expect(width(bounds)).to.be(COLUMN_COUNT);
    expect(height(bounds)).to.be(ROW_COUNT);
  });

  it('culls on an unrotated 3D camera and keeps the whole map on a tilted one', async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
    const runtimeScene = createScene(runtimeGame, 'three-d');
    const tileMap = createLargeSimpleTileMap(runtimeScene, 'BigMap');
    tileMap.setLayer('three-d');
    runtimeScene.getLayer('three-d').setCameraX(800);
    runtimeScene.getLayer('three-d').setCameraY(800);

    // The guard reads these two accessors, so they are what the test drives.
    const rotations = sinon.stub(gdjs.scene3d.camera, 'getCameraRotationX');
    const rotationsY = sinon.stub(gdjs.scene3d.camera, 'getCameraRotationY');
    rotations.returns(0);
    rotationsY.returns(0);
    try {
      // An unrotated 3D camera culls.
      const unrotated = computeBounds(tileMap);
      expect(width(unrotated)).to.be.below(COLUMN_COUNT);

      // A camera tilted around Y cannot be culled with axis-aligned tile
      // bounds: the whole map is drawn.
      rotationsY.returns(30);
      const tiltedY = computeBounds(tileMap);
      expect(tiltedY[0]).to.be(0);
      expect(tiltedY[2]).to.be(0);
      expect(tiltedY[1]).to.be(COLUMN_COUNT);
      expect(tiltedY[3]).to.be(ROW_COUNT);

      // Same for a tilt around X.
      rotationsY.returns(0);
      rotations.returns(30);
      const tiltedX = computeBounds(tileMap);
      expect(tiltedX[0]).to.be(0);
      expect(tiltedX[1]).to.be(COLUMN_COUNT);
    } finally {
      rotations.restore();
      rotationsY.restore();
    }

    // An in-plane camera rotation (not a tilt) still culls, using a window that
    // covers the rotated viewport's bounding square.
    runtimeScene.getLayer('three-d').setCameraRotation(45);
    const spun = computeBounds(tileMap);
    expect(width(spun)).to.be.below(COLUMN_COUNT);
  });

  it('does not cull a small map', async () => {
    const runtimeGame = await gdjs.getPixiRuntimeGameWithAssets();
    const runtimeScene = createScene(runtimeGame);
    const tileMap = createLargeSimpleTileMap(runtimeScene, 'SmallMap');

    // dimX + dimY = 100 is the threshold: at it, the whole map is drawn.
    const bounds = gdjs.computeTileMapCullingBounds(
      tileMap,
      50,
      50,
      [0, 0, 0, 0]
    );
    expect(bounds).to.eql([0, 50, 0, 50]);
  });
});
