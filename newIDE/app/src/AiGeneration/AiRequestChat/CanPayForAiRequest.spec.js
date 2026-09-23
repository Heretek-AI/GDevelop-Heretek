// @flow
import {
  canPayForAiRequest,
  canAffordAiRequest,
  canCancelPendingCreateAiRequest,
} from './Utils';
import {
  type Quota,
  type UsagePrice,
} from '../../Utils/GDevelopServices/Usage';

const price: UsagePrice = { priceInCredits: 5 };

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
