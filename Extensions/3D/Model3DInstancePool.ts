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
  };

  export class Model3DInstancePool {
    private _entries: Map<string, InstanceEntry> = new Map();
    /** The scratch matrix, reused by `setMatrix`; never returned. */
    private _temporaryMatrix: THREE.Matrix4 = new THREE.Matrix4();

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
            // Move the matrices already written onto the bigger mesh.
            for (let slot = 0; slot < newEntry.usedSlotCount; slot++) {
              instancedMesh.getMatrixAt(slot, this._temporaryMatrix);
              grown.setMatrixAt(slot, this._temporaryMatrix);
            }
            grown.instanceMatrix.needsUpdate = true;
            if (instancedMesh.parent) {
              instancedMesh.parent.remove(instancedMesh);
              instancedMesh.parent.add(grown);
            }
            instancedMesh.dispose();
            newEntry.instancedMesh = grown;
            return grown;
          },
          freeSlots: [],
          usedSlotCount: 0,
          isMatrixDirty: true,
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
      entry.freeSlots.push(slot);
    }

    /**
     * Write the instance matrix of `slot`. Copies into a scratch matrix and marks
     * the entry dirty; the caller flushes once per frame.
     */
    setMatrix(key: string, slot: integer, matrix: THREE.Matrix4): void {
      const entry = this._entries.get(key);
      if (!entry) return;
      if (slot < 0 || slot >= entry.instancedMesh.count) return;
      this._temporaryMatrix.copy(matrix);
      entry.instancedMesh.setMatrixAt(slot, this._temporaryMatrix);
      entry.isMatrixDirty = true;
    }

    /**
     * Upload the instance matrices of every entry whose matrices changed. Call
     * once per frame, after all the objects of the frame wrote their matrices.
     */
    flush(): void {
      this._entries.forEach((entry) => {
        if (!entry.isMatrixDirty) return;
        entry.instancedMesh.instanceMatrix.needsUpdate = true;
        entry.isMatrixDirty = false;
      });
    }

    /** The `InstancedMesh` of a key, for a caller that needs to check or scene it. */
    getInstancedMesh(key: string): THREE.InstancedMesh | null {
      const entry = this._entries.get(key);
      return entry ? entry.instancedMesh : null;
    }

    /** The keys currently held, in insertion order. */
    getKeys(): Array<string> {
      const keys: Array<string> = [];
      this._entries.forEach((entry, key) => keys.push(key));
      return keys;
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
   * The pool key of one Model3D instance: the model resource, the material type and
   * the layer it is rendered on. Two objects with the same key can share one
   * `InstancedMesh` because their meshes and material are interchangeable.
   */
  export const getModelInstanceKey = (
    modelResourceName: string,
    materialType: string,
    layerName: string
  ): string => `${modelResourceName}|${materialType}|${layerName}`;
}
