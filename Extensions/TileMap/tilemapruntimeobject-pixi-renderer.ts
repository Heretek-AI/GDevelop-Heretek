/// <reference path="helper/TileMapHelper.d.ts" />
/// <reference path="pixi-tilemap/dist/pixi-tilemap.d.ts" />
namespace gdjs {
  /**
   * The tile bounds of a tile map to draw for the current camera position, as
   * `[left, right, top, bottom]`.
   *
   * The whole map (`[0, dimX, 0, dimY]`) is returned whenever culling must not
   * be applied:
   * - the map is small (`dimX + dimY <= 100`): the maths is not worth paying for;
   * - the container has no scene or the scene has no such layer;
   * - the layer's 3D camera is tilted, because the axis-aligned tile-bounds
   *   maths is only valid for an unrotated camera.
   *
   * The camera is resolved from the **scene's** layer, so a tile map nested in
   * a custom object is culled too - its own container has no camera.
   *
   * The computed bounds are clamped to `[0, dimX] x [0, dimY]`: a camera outside
   * the map must not produce out-of-range bounds that differ every frame and so
   * force a full re-render at every step.
   *
   * Written into `result` (a 4-element array) to avoid allocating; returns it.
   * @category Renderers > Tile Map
   */
  export const computeTileMapCullingBounds = (
    object: gdjs.TileMapRuntimeObject | gdjs.SimpleTileMapRuntimeObject,
    dimX: integer,
    dimY: integer,
    result: Array<integer>
  ): Array<integer> => {
    result[0] = 0;
    result[1] = dimX;
    result[2] = 0;
    result[3] = dimY;

    // Don't cull small maps or chunks.
    if (dimX + dimY <= 100) return result;

    const instanceContainer = object.getInstanceContainer();
    const scene = instanceContainer.getScene();
    const layerName = object.getLayer();
    const layer = scene ? scene.getLayer(layerName) : null;
    if (!layer) return result;

    // The axis-aligned tile bounds maths is only valid for an unrotated camera.
    if (
      gdjs.scene3d &&
      (gdjs.scene3d.camera.getCameraRotationX(scene, layerName, 0) !== 0 ||
        gdjs.scene3d.camera.getCameraRotationY(scene, layerName, 0) !== 0)
    ) {
      return result;
    }

    const cameraX = layer.getCameraX();
    const cameraY = layer.getCameraY();
    let cameraHalfWidth = layer.getCameraWidth() / 2;
    let cameraHalfHeight = layer.getCameraHeight() / 2;
    if (layer.getCameraRotation() !== 0) {
      const hypot = cameraHalfWidth + cameraHalfHeight;
      cameraHalfWidth = hypot;
      cameraHalfHeight = hypot;
    }
    const [cameraLeftTile, cameraTopTile] =
      object.getGridCoordinatesFromSceneCoordinates(
        cameraX - cameraHalfWidth,
        cameraY - cameraHalfHeight
      );
    const [cameraRightTile, cameraBottomTile] =
      object.getGridCoordinatesFromSceneCoordinates(
        cameraX + cameraHalfWidth,
        cameraY + cameraHalfHeight
      );

    // Clamp to the map.
    result[0] = Math.max(
      0,
      Math.min(dimX, Math.min(cameraLeftTile, cameraRightTile))
    );
    result[1] = Math.max(
      0,
      Math.min(dimX, Math.max(cameraLeftTile, cameraRightTile) + 1)
    );
    result[2] = Math.max(
      0,
      Math.min(dimY, Math.min(cameraTopTile, cameraBottomTile))
    );
    result[3] = Math.max(
      0,
      Math.min(dimY, Math.max(cameraTopTile, cameraBottomTile) + 1)
    );
    return result;
  };

  /**
   * The PIXI.js renderer for the Tile map runtime object.
   *
   * @class TileMapRuntimeObjectPixiRenderer
   * @category Renderers > Tile Map
   */
  export class TileMapRuntimeObjectPixiRenderer {
    private _object:
      gdjs.TileMapRuntimeObject | gdjs.SimpleTileMapRuntimeObject;

    private _pixiObject: PIXI.tilemap.CompositeTilemap;
    /** Scratch array reused by the culling maths; never returned. */
    private _temporaryCullingBounds: Array<integer> = [0, 0, 0, 0];
    private _lastCullingLeftBound = 0;
    private _lastCullingRightBound = 0;
    private _lastCullingTopBound = 0;
    private _lastCullingBottomBound = 0;

    /**
     * @param runtimeObject The object to render
     * @param instanceContainer The gdjs.RuntimeScene in which the object is
     */
    constructor(
      runtimeObject:
        gdjs.TileMapRuntimeObject | gdjs.SimpleTileMapRuntimeObject,
      instanceContainer: gdjs.RuntimeInstanceContainer
    ) {
      this._object = runtimeObject;

      // This setting allows tile maps with more than 16K tiles.
      PIXI.tilemap.settings.use32bitIndex = true;

      // Load (or reset)
      this._pixiObject = new PIXI.tilemap.CompositeTilemap();
      this._pixiObject.tileAnim = [0, 0];

      instanceContainer
        .getLayer('')
        .getRenderer()
        .addRendererObject(this._pixiObject, runtimeObject.getZOrder());
      this.updateAngle();
      this.updateOpacity();
      this.updatePosition();
    }

    getRendererObject() {
      return this._pixiObject;
    }

    incrementAnimationFrameX(instanceContainer: gdjs.RuntimeInstanceContainer) {
      this._pixiObject.tileAnim[0] += 1;
    }

    updatePosition(): void {
      this._pixiObject.pivot.x = this._object.getOriginalWidth() / 2;
      this._pixiObject.pivot.y = this._object.getOriginalHeight() / 2;
      this._pixiObject.position.x = this._object.x + this.getWidth() / 2;
      this._pixiObject.position.y = this._object.y + this.getHeight() / 2;
    }

    updateAngle(): void {
      this._pixiObject.rotation = gdjs.toRad(this._object.angle);
    }

    updateOpacity(): void {
      const newAlpha = this._object._opacity / 255;
      if (this._pixiObject.alpha === newAlpha) {
        return;
      }

      this._pixiObject.alpha = newAlpha;
      const tileMap = this._object.getTileMap();
      if (!tileMap) return;
      for (const layer of tileMap.getLayers()) {
        const isLayerHidden =
          (this._object.getDisplayMode() === 'index' &&
            this._object.getDisplayedLayerIndex() !== layer.id) ||
          (this._object.getDisplayMode() === 'visible' && !layer.isVisible());

        // Only set alpha on editable layers that are not hidden,
        // as others are not rendered.
        if (isLayerHidden) continue;
        if (layer instanceof TileMapHelper.EditableTileMapLayer) {
          layer.setAlpha(this._pixiObject.alpha);
        }
      }

      // Changing the alpha requires a full re-render of the tile map.
      this._object.updateTileMap(true);
    }

    setWidth(width: float): void {
      this._pixiObject.scale.x = width / this._object.getOriginalWidth();
      this._pixiObject.position.x = this._object.x + width / 2;
    }

    setHeight(height: float): void {
      this._pixiObject.scale.y = height / this._object.getOriginalHeight();
      this._pixiObject.position.y = this._object.y + height / 2;
    }

    setScaleX(scaleX: float): void {
      this._pixiObject.scale.x = scaleX;
      const width = scaleX * this._object.getOriginalWidth();
      this._pixiObject.position.x = this._object.x + width / 2;
    }

    setScaleY(scaleY: float): void {
      this._pixiObject.scale.y = scaleY;
      const height = scaleY * this._object.getOriginalHeight();
      this._pixiObject.position.y = this._object.y + height / 2;
    }

    getWidth(): float {
      return this._object.getOriginalWidth() * this._pixiObject.scale.x;
    }

    getHeight(): float {
      return this._object.getOriginalHeight() * this._pixiObject.scale.y;
    }

    getScaleX(): float {
      return this._pixiObject.scale.x;
    }

    getScaleY(): float {
      return this._pixiObject.scale.y;
    }

    refreshPixiTileMap(
      textureCache: TileMapHelper.TileTextureCache,
      forceRefresh: boolean
    ) {
      const object = this._object;
      const tileMap = object.getTileMap();
      if (!tileMap) return;
      const dimX = tileMap.getDimensionX();
      const dimY = tileMap.getDimensionY();

      const cullingBounds = computeTileMapCullingBounds(
        object,
        dimX,
        dimY,
        this._temporaryCullingBounds
      );
      const leftBound = cullingBounds[0];
      const rightBound = cullingBounds[1];
      const topBound = cullingBounds[2];
      const bottomBound = cullingBounds[3];

      if (
        forceRefresh ||
        this._lastCullingLeftBound !== leftBound ||
        this._lastCullingRightBound !== rightBound ||
        this._lastCullingTopBound !== topBound ||
        this._lastCullingBottomBound !== bottomBound
      ) {
        this._lastCullingLeftBound = leftBound;
        this._lastCullingRightBound = rightBound;
        this._lastCullingTopBound = topBound;
        this._lastCullingBottomBound = bottomBound;

        TileMapHelper.PixiTileMapHelper.updatePixiTileMap(
          this._pixiObject,
          tileMap,
          textureCache,
          // @ts-ignore
          this._object.getDisplayMode(),
          this._object.getDisplayedLayerIndex(),
          leftBound,
          rightBound,
          topBound,
          bottomBound
        );
      }
    }

    destroy(): void {
      // Keep textures because they are shared by all tile maps.
      this._pixiObject.destroy(false);
    }
  }

  /**
   * @category Renderers > Tile Map
   */
  export const TileMapRuntimeObjectRenderer =
    gdjs.TileMapRuntimeObjectPixiRenderer;
  /**
   * @category Renderers > Tile Map
   */
  export type TileMapRuntimeObjectRenderer =
    gdjs.TileMapRuntimeObjectPixiRenderer;
}
