namespace gdjs {
  /**
   * A pool of `THREE.InstancedMesh`, one per (model resource, material type, layer)
   * so repeated 3D models sharing a model resource can be drawn in one call instead
   * of one call per instance.
   *
   * The pool is opt-in per object (the Model3D "Use instancing" property). It is
   * only useful, and only correct, for models that share the *same* model resource
   * and material: a per-instance material substitution (the "Basic" material type
   * replaces every material with a `MeshBasicMaterial`) cannot be expressed in a
   * shared instanced material, so the caller must keep those on the per-object
   * clone path.
   *
   * Keys are strings built by `getModelInstanceKey`; a slot is an index into the
   * `InstancedMesh`'s instance matrix. Entries grow by doubling when the slots run
   * out, copying the matrices already written.
   */

  /** The instance capacity an entry starts with, and how much it grows by. */
  const INITIAL_INSTANCE_CAPACITY = 16;

  type InstanceEntry = {
    instancedMesh: THREE.InstancedMesh;
    /** Rebuilds the mesh with a new capacity, in the same parent. */
    growMesh: (newCapacity: integer) => THREE.InstancedMesh;
    /** Indices that were released and can be handed out again. */
    freeSlots: Array<integer>;
    /** How many slots have ever been handed out (the used prefix of the mesh). */
    usedSlotCount: integer;
    /** Whether the instance matrices changed since the last `flush`. */
    isMatrixDirty: boolean;
    /**
     * Slots that cast/receive shadows. Drives the `InstancedMesh`'s mesh-level
     * shadow flags (Three.js shadows are per-mesh, not per-instance).
     */
    castShadowSlots: Set<integer>;
    receiveShadowSlots: Set<integer>;
  };

  export class Model3DInstancePool {
    private _entries: Map<string, InstanceEntry> = new Map();
    /**
     * Reused scratch (a `getMatrixAt` target and the collapsed matrix); never
     * returned to callers. Allocated lazily so an unused pool allocates nothing.
     */
    private _scratchMatrix: THREE.Matrix4 | null = null;
    /** Preallocated `flush` handler so `flush` allocates no closure per frame. */
    private _flushEntry: (entry: InstanceEntry) => void;

    constructor() {
      this._flushEntry = (entry: InstanceEntry): void => {
        if (!entry.isMatrixDirty) return;
        entry.instancedMesh.instanceMatrix.needsUpdate = true;
        entry.isMatrixDirty = false;
      };
    }

    /**
     * Take a free slot for `key`, creating the `InstancedMesh` when the key is
     * first seen and growing it when the slots run out. Returns the slot index.
     */
    acquire(
      key: string,
      createMesh: (capacity: integer) => THREE.InstancedMesh
    ): integer {
      const entry = this._entries.get(key);
      if (!entry) {
        const capacity = INITIAL_INSTANCE_CAPACITY;
        const instancedMesh = createMesh(capacity);
        const newEntry: InstanceEntry = {
          instancedMesh,
          growMesh: (newCapacity: integer) => {
            const grown = createMesh(newCapacity);
            // Move the matrices already written onto the bigger mesh. Read from
            // the *current* mesh, not the one this closure first saw - a second
            // grow must copy from the previous grown mesh, not a disposed one.
            const current = newEntry.instancedMesh;
            const scratch =
              this._scratchMatrix || (this._scratchMatrix = new THREE.Matrix4());
            for (let slot = 0; slot < newEntry.usedSlotCount; slot++) {
              current.getMatrixAt(slot, scratch);
              grown.setMatrixAt(slot, scratch);
            }
            grown.instanceMatrix.needsUpdate = true;
            // `createMesh` already adds the grown mesh to the layer group; only
            // the old one must be dropped (capture the parent first: `remove`
            // nulls `.parent`).
            const parent = current.parent;
            if (parent) parent.remove(current);
            current.dispose();
            newEntry.instancedMesh = grown;
            return grown;
          },
          freeSlots: [],
          usedSlotCount: 0,
          isMatrixDirty: true,
          castShadowSlots: new Set<integer>(),
          receiveShadowSlots: new Set<integer>(),
        };
        this._entries.set(key, newEntry);
        return this._takeSlot(newEntry);
      }
      return this._takeSlot(entry);
    }

    private _takeSlot(entry: InstanceEntry): integer {
      const freeSlot = entry.freeSlots.pop();
      if (freeSlot !== undefined) {
        return freeSlot;
      }
      if (entry.usedSlotCount >= entry.instancedMesh.count) {
        entry.growMesh(entry.instancedMesh.count * 2);
      }
      const slot = entry.usedSlotCount;
      entry.usedSlotCount++;
      return slot;
    }

    /** Give a slot back so a later `acquire` for the same key can reuse it. */
    release(key: string, slot: integer): void {
      const entry = this._entries.get(key);
      if (!entry) return;
      if (slot < 0 || slot >= entry.usedSlotCount) return;
      if (entry.freeSlots.indexOf(slot) !== -1) return;
      // Collapse first: a deleted object must stop being drawn even before the
      // slot is reused.
      this._collapseSlot(entry, slot);
      entry.freeSlots.push(slot);
    }

    /**
     * Collapse a slot to zero scale (a zero instance matrix turns the triangle
     * into a point, so it stops being drawn). Marks the entry dirty and clears
     * the slot from the shadow sets so it stops driving the mesh's shadow flags.
     */
    private _collapseSlot(entry: InstanceEntry, slot: integer): void {
      const scratch =
        this._scratchMatrix || (this._scratchMatrix = new THREE.Matrix4());
      scratch.makeScale(0, 0, 0);
      entry.instancedMesh.setMatrixAt(slot, scratch);
      entry.isMatrixDirty = true;
      entry.castShadowSlots.delete(slot);
      entry.receiveShadowSlots.delete(slot);
      entry.instancedMesh.castShadow = entry.castShadowSlots.size > 0;
      entry.instancedMesh.receiveShadow = entry.receiveShadowSlots.size > 0;
    }

    /** Collapse a live slot without releasing it (used by hide/cull). */
    collapseSlot(key: string, slot: integer): void {
      const entry = this._entries.get(key);
      if (!entry) return;
      if (slot < 0 || slot >= entry.usedSlotCount) return;
      this._collapseSlot(entry, slot);
    }

    /**
     * Record which slots cast/receive shadows and update the `InstancedMesh`'s
     * mesh-level shadow flags (the mesh casts if any live slot does).
     */
    setSlotShadows(
      key: string,
      slot: integer,
      castShadow: boolean,
      receiveShadow: boolean
    ): void {
      const entry = this._entries.get(key);
      if (!entry) return;
      if (slot < 0 || slot >= entry.usedSlotCount) return;
      if (castShadow) entry.castShadowSlots.add(slot);
      else entry.castShadowSlots.delete(slot);
      if (receiveShadow) entry.receiveShadowSlots.add(slot);
      else entry.receiveShadowSlots.delete(slot);
      entry.instancedMesh.castShadow = entry.castShadowSlots.size > 0;
      entry.instancedMesh.receiveShadow = entry.receiveShadowSlots.size > 0;
    }

    /**
     * Write the instance matrix of `slot` (passed straight through, no copy);
     * the caller flushes once per frame.
     */
    setMatrix(key: string, slot: integer, matrix: THREE.Matrix4): void {
      const entry = this._entries.get(key);
      if (!entry) return;
      if (slot < 0 || slot >= entry.instancedMesh.count) return;
      entry.instancedMesh.setMatrixAt(slot, matrix);
      entry.isMatrixDirty = true;
    }

    /**
     * Upload the instance matrices of every entry whose matrices changed. Call
     * once per frame, after all the objects of the frame wrote their matrices.
     */
    flush(): void {
      this._entries.forEach(this._flushEntry);
    }

    /** The `InstancedMesh` of a key, for a caller that needs to check or scene it. */
    getInstancedMesh(key: string): THREE.InstancedMesh | null {
      const entry = this._entries.get(key);
      return entry ? entry.instancedMesh : null;
    }

    /** The keys currently held, in insertion order. */
    getKeys(): Array<string> {
      return Array.from(this._entries.keys());
    }

    /** Release every mesh this pool created and forget every key. */
    dispose(): void {
      this._entries.forEach((entry) => {
        if (entry.instancedMesh.parent) {
          entry.instancedMesh.parent.remove(entry.instancedMesh);
        }
        entry.instancedMesh.dispose();
      });
      this._entries.clear();
    }
  }

  /**
   * The pool key of one Model3D instance: the model resource, the material type
   * and the layer it is rendered on. Two objects with the same key can share one
   * `InstancedMesh` because their meshes and material are interchangeable.
   *
   * Each part is `JSON.stringify`-escaped so the comma-joined key is injective
   * (a name containing `,` or `|` cannot collide with another triple).
   */
  export const getModelInstanceKey = (
    modelResourceName: string,
    materialType: string,
    layerName: string
  ): string =>
    `${JSON.stringify(modelResourceName)},${JSON.stringify(
      materialType
    )},${JSON.stringify(layerName)}`;
}
