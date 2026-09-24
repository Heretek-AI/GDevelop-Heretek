/**
 * @jest-environment jsdom
 */
// @flow
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
  canPayForAiRequest,
  getAvailableCredits,
  canAffordAiRequest,
  canCancelPendingCreateAiRequest,
  shouldShowSendAgainLabel,
  shouldShowLocalColdStartHint,
  useLocalColdStartHint,
  hasModelResponded,
  COLD_START_HINT_DELAY_MS,
} from './Utils';
import {
  type Quota,
  type UsagePrice,
} from '../../Utils/GDevelopServices/Usage';

const price: UsagePrice = { priceInCredits: 5 };

describe('getAvailableCredits', () => {
  it('reads the balance from a complete limits response', () => {
    expect(
      getAvailableCredits(({ credits: { userBalance: { amount: 42 } } }: any))
    ).toBe(42);
  });

  it('returns 0 for an absent or partial limits response', () => {
    // getUserLimits validates only the top-level `capabilities` key, so
    // `credits.userBalance.amount` is unverified at runtime; reading it behind
    // only a `limits ?` guard threw on every chat render.
    for (const limits of [
      null,
      undefined,
      {},
      { credits: null },
      { credits: {} },
      { credits: { userBalance: {} } },
    ]) {
      expect(getAvailableCredits((limits: any))).toBe(0);
    }
  });

  it('ignores a non-numeric balance', () => {
    expect(
      getAvailableCredits(({ credits: { userBalance: { amount: '12' } } }: any))
    ).toBe(0);
  });
});

const exhaustedQuota: Quota = {
  limitReached: true,
  current: 100,
  max: 100,
  period: '7days',
};

const remainingQuota: Quota = {
  ...exhaustedQuota,
  limitReached: false,
  current: 10,
};

describe('canPayForAiRequest', () => {
  it('lets the user send while their allowance is not exhausted', () => {
    expect(
      canPayForAiRequest({
        quota: remainingQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(true);
  });

  it('lets the user send when their limits are not known', () => {
    expect(
      canPayForAiRequest({
        quota: null,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(true);
  });

  it('blocks the user when their allowance is exhausted and they did not accept to pay with credits', () => {
    expect(
      canPayForAiRequest({
        quota: exhaustedQuota,
        price,
        availableCredits: 1000,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(false);
  });

  it('blocks the user when their allowance is exhausted and they have no credits left', () => {
    expect(
      canPayForAiRequest({
        quota: exhaustedQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: true,
      })
    ).toBe(false);
    expect(
      canPayForAiRequest({
        quota: exhaustedQuota,
        price,
        availableCredits: 4,
        automaticallyUseCreditsForAiRequests: true,
      })
    ).toBe(false);
  });

  // The case a user hit: their allowance was exhausted, they were already paying
  // with credits and bought some. Nothing must keep blocking them once the
  // limits say they can pay.
  it('lets the user send as soon as they have enough credits to pay with', () => {
    expect(
      canPayForAiRequest({
        quota: exhaustedQuota,
        price,
        availableCredits: 5,
        automaticallyUseCreditsForAiRequests: true,
      })
    ).toBe(true);
    expect(
      canPayForAiRequest({
        quota: exhaustedQuota,
        price,
        availableCredits: 500,
        automaticallyUseCreditsForAiRequests: true,
      })
    ).toBe(true);
  });

  it('lets the user send when the price is not known or free', () => {
    expect(
      canPayForAiRequest({
        quota: exhaustedQuota,
        price: null,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: true,
      })
    ).toBe(true);
    expect(
      canPayForAiRequest({
        quota: exhaustedQuota,
        price: { priceInCredits: 0 },
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: true,
      })
    ).toBe(true);
  });
});

describe('canAffordAiRequest', () => {
  it('allows local/BYOK (custom endpoint) even when the hosted quota is exhausted', () => {
    expect(
      canAffordAiRequest({
        isCustomEndpointEnabled: true,
        quota: exhaustedQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(true);
  });

  it('still blocks hosted sends when the allowance is exhausted and credits cannot pay', () => {
    expect(
      canAffordAiRequest({
        isCustomEndpointEnabled: false,
        quota: exhaustedQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(false);
    expect(
      canAffordAiRequest({
        isCustomEndpointEnabled: false,
        quota: exhaustedQuota,
        price,
        availableCredits: 4,
        automaticallyUseCreditsForAiRequests: true,
      })
    ).toBe(false);
  });

  it('allows hosted sends when the allowance is not exhausted', () => {
    expect(
      canAffordAiRequest({
        isCustomEndpointEnabled: false,
        quota: remainingQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(true);
  });

  it('allows a local-ai-* chat when the endpoint toggle is off and the hosted quota is exhausted', () => {
    expect(
      canAffordAiRequest({
        isCustomEndpointEnabled: false,
        aiRequestId: 'local-ai-123-0.456',
        quota: exhaustedQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(true);
  });

  it('allows the offline BYOK user id when the endpoint toggle is off and the hosted quota is exhausted', () => {
    expect(
      canAffordAiRequest({
        isCustomEndpointEnabled: false,
        userId: 'local-byok-user',
        quota: exhaustedQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(true);
  });

  it('still blocks a hosted chat id when the allowance is exhausted', () => {
    expect(
      canAffordAiRequest({
        isCustomEndpointEnabled: false,
        aiRequestId: 'hosted-ai-request-1',
        userId: 'firebase-uid-1',
        quota: exhaustedQuota,
        price,
        availableCredits: 0,
        automaticallyUseCreditsForAiRequests: false,
      })
    ).toBe(false);
  });
});

describe('canCancelPendingCreateAiRequest', () => {
  it('allows Stop while the endpoint is on before the create registers', () => {
    expect(
      canCancelPendingCreateAiRequest({
        isCustomEndpointEnabled: true,
        hasPendingCreate: false,
        isSending: true,
        hasAiRequest: false,
      })
    ).toBe(true);
  });

  it('allows Stop when a create is pending and the endpoint was turned off', () => {
    expect(
      canCancelPendingCreateAiRequest({
        isCustomEndpointEnabled: false,
        hasPendingCreate: true,
        isSending: true,
        hasAiRequest: false,
      })
    ).toBe(true);
  });

  it('does not offer Stop when nothing is being created', () => {
    expect(
      canCancelPendingCreateAiRequest({
        isCustomEndpointEnabled: false,
        hasPendingCreate: false,
        isSending: false,
        hasAiRequest: false,
      })
    ).toBe(false);
    expect(
      canCancelPendingCreateAiRequest({
        isCustomEndpointEnabled: true,
        hasPendingCreate: false,
        isSending: false,
        hasAiRequest: false,
      })
    ).toBe(false);
  });

  it('does not use the pending-create Stop once an AiRequest exists', () => {
    expect(
      canCancelPendingCreateAiRequest({
        isCustomEndpointEnabled: false,
        hasPendingCreate: true,
        isSending: true,
        hasAiRequest: true,
      })
    ).toBe(false);
  });
});

describe('shouldShowSendAgainLabel', () => {
  it('shows Send again after a failed send while idle', () => {
    expect(
      shouldShowSendAgainLabel({ hasSendError: true, isWorking: false })
    ).toBe(true);
  });

  it('hides the label when a request is working', () => {
    expect(
      shouldShowSendAgainLabel({ hasSendError: true, isWorking: true })
    ).toBe(false);
  });

  it('keeps the default icon-only button when there is no error', () => {
    expect(
      shouldShowSendAgainLabel({ hasSendError: false, isWorking: false })
    ).toBe(false);
    expect(
      shouldShowSendAgainLabel({ hasSendError: false, isWorking: true })
    ).toBe(false);
  });
});

describe('shouldShowLocalColdStartHint', () => {
  it('explains the wait once a local model has been silent past the delay', () => {
    expect(
      shouldShowLocalColdStartHint({
        isLocalRequest: true,
        hasBytes: false,
        elapsedMs: COLD_START_HINT_DELAY_MS,
      })
    ).toBe(true);
  });

  it('stays quiet before the delay so a normal first token is not narrated', () => {
    expect(
      shouldShowLocalColdStartHint({
        isLocalRequest: true,
        hasBytes: false,
        elapsedMs: COLD_START_HINT_DELAY_MS - 1,
      })
    ).toBe(false);
  });

  it('clears as soon as the stream produces content', () => {
    // Once the first token lands, the partial text is the progress indicator;
    // a "still loading" hint beside it would contradict what is on screen.
    expect(
      shouldShowLocalColdStartHint({
        isLocalRequest: true,
        hasBytes: true,
        elapsedMs: COLD_START_HINT_DELAY_MS * 10,
      })
    ).toBe(false);
  });

  it('never shows for a hosted request, which streams its first token promptly', () => {
    expect(
      shouldShowLocalColdStartHint({
        isLocalRequest: false,
        hasBytes: false,
        elapsedMs: COLD_START_HINT_DELAY_MS * 10,
      })
    ).toBe(false);
  });

  it('does not fire exactly at the boundary-less zero elapsed time', () => {
    expect(
      shouldShowLocalColdStartHint({
        isLocalRequest: true,
        hasBytes: false,
        elapsedMs: 0,
      })
    ).toBe(false);
  });
});

const Probe = ({ isLocalRequest, readHasBytes, progressKey, hasResponded }) => {
  const showHint = useLocalColdStartHint({
    isLocalRequest,
    readHasBytes,
    progressKey,
    hasResponded,
  });
  return showHint ? <span>SHOWING</span> : null;
};

const renderProbe = (props: Object) => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => {
    root.render(<Probe {...props} />);
  });
  return { container, root };
};

describe('useLocalColdStartHint', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the hint only after the model has been silent past the delay', () => {
    const { container } = renderProbe({
      isLocalRequest: true,
      readHasBytes: () => false,
    });
    act(() => {
      jest.advanceTimersByTime(COLD_START_HINT_DELAY_MS - 1000);
    });
    expect(container.textContent).toBe('');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(container.textContent).toBe('SHOWING');
  });

  it('clears the hint as soon as the stream produces bytes', () => {
    let hasBytes = false;
    const { container } = renderProbe({
      isLocalRequest: true,
      readHasBytes: () => hasBytes,
    });
    act(() => {
      jest.advanceTimersByTime(COLD_START_HINT_DELAY_MS);
    });
    expect(container.textContent).toBe('SHOWING');
    hasBytes = true;
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(container.textContent).toBe('');
  });

  it('never shows for a hosted request, however long it waits', () => {
    const { container } = renderProbe({
      isLocalRequest: false,
      readHasBytes: () => false,
    });
    act(() => {
      jest.advanceTimersByTime(COLD_START_HINT_DELAY_MS * 5);
    });
    expect(container.textContent).toBe('');
  });

  it('stops polling once unmounted, so a settled chat leaves no timer behind', () => {
    const readHasBytes = jest.fn(() => false);
    const { root } = renderProbe({ isLocalRequest: true, readHasBytes });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    const callsWhileMounted = readHasBytes.mock.calls.length;
    act(() => {
      root.unmount();
    });
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(readHasBytes.mock.calls.length).toBe(callsWhileMounted);
  });

  it('re-arms the wait when the transcript advances, so tool progress clears a stale hint', () => {
    // Non-streaming turns never record partial bytes, and a multi-turn agent
    // run keeps the working row mounted: without re-arming, the hint fires
    // once and then sticks for the rest of the run even while tool calls land.
    const { container, root } = renderProbe({
      isLocalRequest: true,
      readHasBytes: () => false,
      progressKey: 3,
    });
    act(() => {
      jest.advanceTimersByTime(COLD_START_HINT_DELAY_MS);
    });
    expect(container.textContent).toBe('SHOWING');
    // A new assistant message / tool call output advances the transcript.
    act(() => {
      root.render(
        <Probe isLocalRequest readHasBytes={() => false} progressKey={4} />
      );
    });
    // The stale hint clears immediately and the wait restarts from here.
    expect(container.textContent).toBe('');
    act(() => {
      jest.advanceTimersByTime(COLD_START_HINT_DELAY_MS - 1000);
    });
    expect(container.textContent).toBe('');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(container.textContent).toBe('SHOWING');
  });

  it('retires once the model has responded: later slow turns are not a cold start', () => {
    const { container, root } = renderProbe({
      isLocalRequest: true,
      readHasBytes: () => false,
      progressKey: 1,
      hasResponded: false,
    });
    act(() => {
      jest.advanceTimersByTime(COLD_START_HINT_DELAY_MS);
    });
    expect(container.textContent).toBe('SHOWING');
    // The first assistant message lands.
    act(() => {
      root.render(
        <Probe
          isLocalRequest
          readHasBytes={() => false}
          progressKey={2}
          hasResponded
        />
      );
    });
    expect(container.textContent).toBe('');
    // Even a full further delay of silence on a later turn stays quiet: the
    // thinking phrases narrate it, not the cold-start hint.
    act(() => {
      jest.advanceTimersByTime(COLD_START_HINT_DELAY_MS * 3);
    });
    expect(container.textContent).toBe('');
  });
});

describe('hasModelResponded', () => {
  it('is false before the model produces anything', () => {
    expect(hasModelResponded(null)).toBe(false);
    expect(hasModelResponded(undefined)).toBe(false);
    expect(hasModelResponded([])).toBe(false);
    expect(
      hasModelResponded([{ type: 'message', role: 'user', content: [] }])
    ).toBe(false);
  });

  it('is true on an assistant message or a tool round-trip', () => {
    expect(
      hasModelResponded([
        { type: 'message', role: 'user', content: [] },
        { type: 'message', role: 'assistant', content: [] },
      ])
    ).toBe(true);
    expect(
      hasModelResponded([
        { type: 'function_call_output', call_id: 'c1', output: '{}' },
      ])
    ).toBe(true);
  });
});

describe('useLocalColdStartHint under parent re-renders', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps counting while the parent re-renders with a new callback each time', () => {
    // ChatMessages re-renders every 8s (thinking-phrase rotation) and passes
    // `readHasBytes: () => ...` inline, so the callback identity changes on
    // every parent render. The wait must be measured from the turn start, not
    // restarted whenever the chat re-renders — otherwise the hint never fires.
    const container = document.createElement('div');
    const root = createRoot(container);
    const renderWithFreshCallback = () =>
      root.render(<Probe isLocalRequest readHasBytes={() => false} />);

    act(() => {
      renderWithFreshCallback();
    });
    // Parent re-renders every 4s, twice as often as the 8s rotation would but
    // still well inside the delay window.
    for (let i = 0; i < 7; i += 1) {
      act(() => {
        jest.advanceTimersByTime(4000);
      });
      act(() => {
        renderWithFreshCallback();
      });
    }
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(container.textContent).toBe('SHOWING');
  });
});
