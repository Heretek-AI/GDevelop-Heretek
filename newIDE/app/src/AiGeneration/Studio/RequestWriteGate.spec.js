// @flow
import {
  getRequestWriteBlock,
  createRequestWriteQueue,
} from './RequestWriteGate';

describe('RequestWriteGate', () => {
  describe('getRequestWriteBlock', () => {
    it('blocks a suspended request', () => {
      expect(
        getRequestWriteBlock({
          aiRequestId: 'req-1',
          request: { status: 'suspended' },
          isSending: false,
          inFlightCallIds: new Set(),
        })
      ).toBe('suspended');
    });

    it('blocks while a user send is in flight', () => {
      expect(
        getRequestWriteBlock({
          aiRequestId: 'req-1',
          request: { status: 'ready' },
          isSending: true,
          inFlightCallIds: new Set(),
        })
      ).toBe('sending');
    });

    it('blocks while one of this request function calls is being processed', () => {
      expect(
        getRequestWriteBlock({
          aiRequestId: 'req-1',
          request: { status: 'ready' },
          isSending: false,
          inFlightCallIds: new Set(['req-1:call-1']),
        })
      ).toBe('call-in-flight');
      // Another request's call must not block this one.
      expect(
        getRequestWriteBlock({
          aiRequestId: 'req-1',
          request: { status: 'ready' },
          isSending: false,
          inFlightCallIds: new Set(['req-2:call-1']),
        })
      ).toBeNull();
    });

    it('reports the suspension first', () => {
      // A suspended request that also has a call in flight stays 'suspended':
      // that is the path that cleared the results, so it is the decisive one.
      expect(
        getRequestWriteBlock({
          aiRequestId: 'req-1',
          request: { status: 'suspended' },
          isSending: true,
          inFlightCallIds: new Set(['req-1:call-1']),
        })
      ).toBe('suspended');
    });

    it('does not block a clean request', () => {
      expect(
        getRequestWriteBlock({
          aiRequestId: 'req-1',
          request: { status: 'ready' },
          isSending: false,
          inFlightCallIds: new Set(),
        })
      ).toBeNull();
      expect(
        getRequestWriteBlock({
          aiRequestId: 'req-1',
          request: null,
          isSending: false,
          inFlightCallIds: new Set(),
        })
      ).toBeNull();
    });
  });

  describe('createRequestWriteQueue', () => {
    it('runs a write and reports the queue idle afterwards', async () => {
      const queue = createRequestWriteQueue();
      const order = [];
      await queue.enqueue(
        'req-1',
        async () => {
          order.push('write');
        },
        () => false
      );
      expect(order).toEqual(['write']);
      expect(queue.isIdle('req-1')).toBe(true);
    });

    it('never interleaves two writes for one request', async () => {
      const queue = createRequestWriteQueue();
      const events = [];

      const first = queue.enqueue(
        'req-1',
        async () => {
          events.push('first-start');
          await new Promise(resolve => setTimeout(resolve, 20));
          events.push('first-end');
        },
        () => false
      );
      const second = queue.enqueue(
        'req-1',
        async () => {
          events.push('second-start');
          events.push('second-end');
        },
        () => false
      );

      await Promise.all([first, second]);

      // The second write starts only after the first finished.
      expect(events).toEqual([
        'first-start',
        'first-end',
        'second-start',
        'second-end',
      ]);
    });

    it('does not block writes for different request ids', async () => {
      const queue = createRequestWriteQueue();
      const events = [];

      const slow = queue.enqueue(
        'req-1',
        async () => {
          events.push('slow-start');
          await new Promise(resolve => setTimeout(resolve, 20));
          events.push('slow-end');
        },
        () => false
      );
      const fast = queue.enqueue(
        'req-2',
        async () => {
          events.push('fast-start');
          events.push('fast-end');
        },
        () => false
      );

      await Promise.all([slow, fast]);

      // The second request's write completed while the first was still running.
      expect(events).toEqual([
        'slow-start',
        'fast-start',
        'fast-end',
        'slow-end',
      ]);
    });

    it('keeps only the latest pending write for a request', async () => {
      const queue = createRequestWriteQueue();
      const events = [];

      const first = queue.enqueue(
        'req-1',
        async () => {
          events.push('first');
          await new Promise(resolve => setTimeout(resolve, 20));
        },
        () => false
      );
      // These two are enqueued while `first` runs: the middle one is superseded.
      const second = queue.enqueue(
        'req-1',
        async () => {
          events.push('second');
        },
        () => false
      );
      const third = queue.enqueue(
        'req-1',
        async () => {
          events.push('third');
        },
        () => false
      );

      // The superseded write never ran and must reject, not report success.
      let supersededError = null;
      try {
        await second;
      } catch (error) {
        supersededError = error;
      }
      await Promise.all([first, third]);
      expect(supersededError && supersededError.code).toBe('superseded');
      expect(events).toEqual(['first', 'third']);
    });

    it('retries a blocked write rather than dropping it', async () => {
      const queue = createRequestWriteQueue();
      let blocked = true;
      const events = [];

      const first = queue.enqueue(
        'req-1',
        async () => {
          events.push('first-ran');
        },
        () => blocked
      );

      // Give the queue a chance to observe the block.
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(events).toEqual([]);

      // Unblock: the queue retries the blocked write itself (no new enqueue).
      blocked = false;
      await new Promise(resolve => setTimeout(resolve, 80));
      await first;
      expect(events).toEqual(['first-ran']);

      // A later write runs after it: both ran, so the first was retried, not
      // dropped.
      await queue.enqueue(
        'req-1',
        async () => {
          events.push('second-ran');
        },
        () => false
      );
      expect(events).toEqual(['first-ran', 'second-ran']);
    });

    it('rejects the caller when its write throws', async () => {
      const queue = createRequestWriteQueue();
      let caught = null;
      try {
        await queue.enqueue(
          'req-1',
          async () => {
            throw new Error('boom');
          },
          () => false
        );
      } catch (error) {
        caught = error;
      }
      expect(caught && caught.message).toBe('boom');
      // A failed write does not wedge the queue.
      expect(queue.isIdle('req-1')).toBe(true);
    });
  });
});
