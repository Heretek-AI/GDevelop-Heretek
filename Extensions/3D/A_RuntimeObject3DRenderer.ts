namespace gdjs {
  /** @category Renderers */
  export abstract class RuntimeObject3DRenderer {
    protected _object: gdjs.RuntimeObject3D;
    private _threeObject3D: THREE.Object3D;
    private _basis: Basis | null = null;
    private static matrix4: THREE.Matrix4 | null = null;

    constructor(
      runtimeObject: gdjs.RuntimeObject3D,
      instanceContainer: gdjs.RuntimeInstanceContainer,
      threeObject3D: THREE.Object3D
    ) {
      this._object = runtimeObject;
      this._threeObject3D = threeObject3D;
      this._threeObject3D.rotation.order = 'ZYX';
      //@ts-ignore
      this._threeObject3D.gdjsRuntimeObject = runtimeObject;

      instanceContainer
        .getLayer('')
        .getRenderer()
        .add3DRendererObject(this._threeObject3D);
    }

    get3DRendererObject() {
      return this._threeObject3D;
    }

    updatePosition() {
      this._threeObject3D.position.set(
        this._object.getX() + this._object.getWidth() / 2,
        this._object.getY() + this._object.getHeight() / 2,
        this._object.getZ() + this._object.getDepth() / 2
      );
    }

    updateRotation() {
      this._threeObject3D.rotation.set(
        gdjs.toRad(this._object.getRotationX()),
        gdjs.toRad(this._object.getRotationY()),
        gdjs.toRad(this._object.angle)
      );
      this.invalidateRotation();
    }

    updateSize() {
      const object = this._object;
      this._threeObject3D.scale.set(
        object.isFlippedX() ? -object.getWidth() : object.getWidth(),
        object.isFlippedY() ? -object.getHeight() : object.getHeight(),
        object.isFlippedZ() ? -object.getDepth() : object.getDepth()
      );
      this.updatePosition();
    }

    /**
     * The object's own hidden state (`!isHidden()`) and its frustum-cull state,
     * combined by `applyRenderVisibility`. Kept separate so hiding and culling
     * stay independent and can both be routed through the renderer (a detached
     * three.js node is not enough: an instanced model's real draw is an
     * `InstancedMesh` slot, which `Model3DRuntimeObject3DRenderer` collapses).
     */
    protected _isVisible: boolean = true;
    protected _isCulled: boolean = false;

    updateVisibility(visible: boolean) {
      this._isVisible = !!visible;
      this.applyRenderVisibility();
    }

    setCullingVisible(culled: boolean): void {
      this._isCulled = !!culled;
      this.applyRenderVisibility();
    }

    /** Combine the object's hidden state with its frustum-cull state. */
    protected applyRenderVisibility(): void {
      const threeObject = this.get3DRendererObject();
      if (threeObject) threeObject.visible = this._isVisible && !this._isCulled;
    }

    invalidateRotation(): void {
      if (this._basis) {
        this._basis.isDirty = true;
      }
    }

    getForwardX(): float {
      return this.getBasis().forwardX;
    }

    getForwardY(): float {
      return this.getBasis().forwardY;
    }

    getForwardZ(): float {
      return this.getBasis().forwardZ;
    }

    getUpX(): float {
      return this.getBasis().upX;
    }

    getUpY(): float {
      return this.getBasis().upY;
    }

    getUpZ(): float {
      return this.getBasis().upZ;
    }

    getRightX(): float {
      return this.getBasis().rightX;
    }

    getRightY(): float {
      return this.getBasis().rightY;
    }

    getRightZ(): float {
      return this.getBasis().rightZ;
    }

    private getBasis(): Basis {
      if (!this._basis) {
        this._basis = new Basis();
      }
      if (!this._basis.isDirty) {
        return this._basis;
      }

      let rotationMatrix = gdjs.RuntimeObject3DRenderer.matrix4;
      if (!rotationMatrix) {
        rotationMatrix = new THREE.Matrix4();
        gdjs.RuntimeObject3DRenderer.matrix4 = rotationMatrix;
      }
      rotationMatrix.makeRotationFromEuler(this._threeObject3D.rotation);
      const elements = rotationMatrix.elements;

      this._basis.forwardX = elements[0];
      this._basis.forwardY = elements[1];
      this._basis.forwardZ = elements[2];

      this._basis.rightX = -elements[4];
      this._basis.rightY = -elements[5];
      this._basis.rightZ = -elements[6];

      this._basis.upX = elements[8];
      this._basis.upY = elements[9];
      this._basis.upZ = elements[10];

      return this._basis;
    }
  }

  class Basis {
    isDirty = true;
    forwardX: float = 0;
    forwardY: float = 0;
    forwardZ: float = 0;
    upX: float = 0;
    upY: float = 0;
    upZ: float = 0;
    rightX: float = 0;
    rightY: float = 0;
    rightZ: float = 0;
  }
}
