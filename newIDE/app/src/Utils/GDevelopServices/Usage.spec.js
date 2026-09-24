// @flow
import {
  canBenefitFromSocialRole,
  hasValidSubscriptionPlan,
  UNLOCKED_HERETEK_SUBSCRIPTION,
  UNLOCKED_HERETEK_CAPABILITIES,
  type Subscription,
} from './Usage';

jest.mock('axios');

describe('Usage service', () => {
  describe('canBenefitFromSocialRole', () => {
    it('should return false when subscription is null', () => {
      const result = canBenefitFromSocialRole(null);
      expect(result).toBe(false);
    });

    it('should return false when subscription does not have a planId', () => {
      const subscription: Subscription = {
        planId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: 'user_id',
        pricingSystemId: null,
      };
      const result = canBenefitFromSocialRole(subscription);
      expect(result).toBe(false);
    });

    it('should return true for silver subscription', () => {
      const subscription: Subscription = {
        planId: 'gdevelop_silver',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: 'user_id',
        pricingSystemId: 'silver_1month',
      };
      const result = canBenefitFromSocialRole(subscription);
      expect(result).toBe(true);
    });

    it('should return false for legacy sub', () => {
      const subscription: Subscription = {
        planId: 'gdevelop_pro',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: 'user_id',
        pricingSystemId: 'pro_1month',
      };
      const result = canBenefitFromSocialRole(subscription);
      expect(result).toBe(false);
    });

    it('should return false when subscription benefits from education plan', () => {
      const subscription: Subscription = {
        planId: 'gdevelop_gold',
        benefitsFromEducationPlan: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: 'user_id',
        pricingSystemId: 'TEAM_MEMBER',
      };
      const result = canBenefitFromSocialRole(subscription);
      expect(result).toBe(false);
    });

    it('should return true for education subscription', () => {
      const subscription: Subscription = {
        planId: 'gdevelop_education',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: 'user_id',
        pricingSystemId: 'education_1month',
      };
      const result = canBenefitFromSocialRole(subscription);
      expect(result).toBe(true);
    });

    it('should return true for gold subscription', () => {
      const subscription: Subscription = {
        planId: 'gdevelop_gold',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: 'user_id',
        pricingSystemId: 'gold_1month',
      };
      const result = canBenefitFromSocialRole(subscription);
      expect(result).toBe(true);
    });

    it('should return true for Startup (Pro) subscription', () => {
      const subscription: Subscription = {
        planId: 'gdevelop_startup',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: 'user_id',
        pricingSystemId: 'startup_1month',
      };
      const result = canBenefitFromSocialRole(subscription);
      expect(result).toBe(true);
    });
  });
});

describe('BYOK unlock (no subscription gates in GDevelop-Heretek)', () => {
  // The fork's master switch: every client-side gate (watermark, splash
  // clamp, network preview, debugger, paywalled prompts) resolves through
  // hasValidSubscriptionPlan. If an upstream sync restores a real check here,
  // the whole fork re-paywalls with no visible error — so the unconditional
  // grant is pinned, including the no-argument call shape used in
  // AskAiEditorContainer.
  it('grants a valid plan for any subscription shape, including none', () => {
    expect(hasValidSubscriptionPlan()).toBe(true);
    expect(hasValidSubscriptionPlan(null)).toBe(true);
    expect(hasValidSubscriptionPlan(undefined)).toBe(true);
    expect(hasValidSubscriptionPlan(({}: any))).toBe(true);
    expect(hasValidSubscriptionPlan(({ planId: null }: any))).toBe(true);
    expect(
      hasValidSubscriptionPlan(
        ({ planId: 'gdevelop_free', pricingSystemId: 'FREE' }: any)
      )
    ).toBe(true);
  });

  it('seeds an unlocked subscription on the local BYOK identity', () => {
    expect(UNLOCKED_HERETEK_SUBSCRIPTION.userId).toBe('local-byok-user');
    // A paid-tier plan id: gates comparing planId keep resolving as paid.
    expect(UNLOCKED_HERETEK_SUBSCRIPTION.planId).toBe('gdevelop_startup');
    expect(UNLOCKED_HERETEK_SUBSCRIPTION.pricingSystemId).toBe(
      'HERETEK_UNLOCKED'
    );
  });

  it('seeds capabilities with every client gate open', () => {
    // Leaderboard admin (theme CSS, disabled-login) and max-count alerts.
    expect(
      UNLOCKED_HERETEK_CAPABILITIES.leaderboards.themeCustomizationCapabilities
    ).toBe('FULL');
    expect(UNLOCKED_HERETEK_CAPABILITIES.leaderboards.canUseCustomCss).toBe(
      true
    );
    expect(
      UNLOCKED_HERETEK_CAPABILITIES.leaderboards.canDisableLoginInLeaderboard
    ).toBe(true);
    // Analytics, version history, multiplayer lobbies.
    expect(UNLOCKED_HERETEK_CAPABILITIES.analytics.sessions).toBe(true);
    expect(UNLOCKED_HERETEK_CAPABILITIES.versionHistory.enabled).toBe(true);
    expect(UNLOCKED_HERETEK_CAPABILITIES.multiplayer.lobbiesCount).toBe(99);
    // Cloud projects and AI version history retained, not clamped.
    expect(UNLOCKED_HERETEK_CAPABILITIES.cloudProjects.maximumCount).toBe(999);
    expect(UNLOCKED_HERETEK_CAPABILITIES.ai.versionHistory.enabled).toBe(true);
  });
});
