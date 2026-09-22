// @flow

/**
 * One gate owns every write to an `AiRequest`.
 *
 * Ported from munder-difflin's "one gate, one writer" (`src/renderer/src/
 * components/terminalAutomation.ts` + `docs/message-queue.md` §1). There, a
 * second writer with its own idea of when the terminal was free landed its text
 * on a half-written line; here, the studio runtime, the shared dispatcher and the
 * user's own send all write to the same request, and a write that lands in the
 * middle of a function-call batch can be silently replaced by the next one
 * (`updateAiRequest(id, () => aiRequest)` discards previous state).
 *
 * The gate does two things:
 *  - `getRequestWriteBlock` says, with a named reason, why a write must wait;
 *  - `createRequestWriteQueue` serializes the writes per request, keeping at most
 *    one pending write (latest wins) and retrying a blocked one rather than
 *    dropping it.
 *
 * A `write` must never `await` an `enqueue` for the same `aiRequestId`: the drain
 * loop cannot interleave and that promise would never settle.
 */

export type RequestWriteBlock =
  // The request is suspended: the editor has cleared its function-call results
  // and a write now would re-populate them (`AiRequestContext:1438`).
  | 'suspended'
  // A user message is in flight for this request.
  | 'sending'
  // A function call of this request is being processed by the editor.
  | 'call-in-flight'
  // Nothing blocks a write.
  | null;

export const getRequestWriteBlock = ({
  aiRequestId,
  request,
  isSending,
  inFlightCallIds,
}: {|
  aiRequestId: string,
  request: ?{ +status?: string },
  isSending: boolean,
  inFlightCallIds: Set<string>,
|}): RequestWriteBlock => {
  if (request && request.status === 'suspended') return 'suspended';
  if (isSending) return 'sending';
  const prefix = `${aiRequestId}:`;
  for (const callId of inFlightCallIds) {
    if (callId.startsWith(prefix)) return 'call-in-flight';
  }
  return null;
};

type PendingWrite = {|
  write: () => Promise<void>,
  isBlocked: () => boolean,
  resolve: () => void,
  reject: (error: Error) => void,
|};

type QueueEntry = {
  isRunning: boolean,
  /** At most one pending write per request: a newer one replaces it. */
  pending: PendingWrite | null,
};

export type RequestWriteQueue = {|
  enqueue: (
    aiRequestId: string,
    write: () => Promise<void>,
    isBlocked: () => boolean
  ) => Promise<void>,
  isIdle: (aiRequestId: string) => boolean,
|};

/**
 * A per-request FIFO holding at most one pending write.
 *
 * A newer write for the same request replaces the older pending one (latest
 * wins, matching munder-difflin's `MAX_PENDING_STEERS` drop-from-the-front rule
 * in `src/main/control.ts`). A write whose `isBlocked()` is true is retried on
 * the next `enqueue` for that request rather than dropped: the caller is not
 * asked to poll, and the last enqueue always resolves when the queue drains.
 */
export const createRequestWriteQueue = (): RequestWriteQueue => {
  const entries: Map<string, QueueEntry> = new Map();

  const getEntry = (aiRequestId: string): QueueEntry => {
    let entry = entries.get(aiRequestId);
    if (!entry) {
      entry = { isRunning: false, pending: null };
      entries.set(aiRequestId, entry);
    }
    return entry;
  };

  const runEntry = async (aiRequestId: string): Promise<void> => {
    const entry = getEntry(aiRequestId);
    if (entry.isRunning) return;

    entry.isRunning = true;
    try {
      // Keep draining until there is nothing left to run: a write enqueued
      // while this loop awaited has to be picked up by the same loop, not left
      // to a second `runEntry` that would see `isRunning` and return.
      while (entry.pending) {
        const pending = entry.pending;
        if (pending.isBlocked()) {
          // Do not drop it, and do not wait for another enqueue (none may ever
          // come): schedule a self-recheck. The promise stays pending until the
          // write actually runs.
          setTimeout(() => {
            if (!entry.isRunning && entry.pending) {
              runEntry(aiRequestId).catch(error => {
                console.error('[studio] request write queue failure:', error);
              });
            }
          }, 50);
          break;
        }
        entry.pending = null;
        try {
          await pending.write();
          pending.resolve();
        } catch (error) {
          pending.reject(error);
        }
      }
    } finally {
      entry.isRunning = false;
      if (!entry.pending) {
        entries.delete(aiRequestId);
      }
    }
  };

  return {
    enqueue: (
      aiRequestId: string,
      write: () => Promise<void>,
      isBlocked: () => boolean
    ): Promise<void> => {
      const entry = getEntry(aiRequestId);
      // Latest wins: replace whatever was waiting, and settle it as superseded
      // (rejected, not resolved - a replaced write never ran and must not report
      // success).
      if (entry.pending) {
        const superseded = entry.pending;
        entry.pending = null;
        superseded.reject(
          Object.assign(
            new Error('Superseded by a newer write for this request.'),
            {
              code: 'superseded',
            }
          )
        );
      }
      return new Promise<void>((resolve, reject) => {
        entry.pending = { write, isBlocked, resolve, reject };
        if (!entry.isRunning) {
          runEntry(aiRequestId).catch(error => {
            // `runEntry` handles its own per-write errors; this is a safety net
            // so a bug there cannot produce an unhandled rejection.
            console.error('[studio] request write queue failure:', error);
          });
        }
      });
    },
    isIdle: (aiRequestId: string): boolean => {
      const entry = entries.get(aiRequestId);
      return !entry || (!entry.isRunning && !entry.pending);
    },
  };
};
