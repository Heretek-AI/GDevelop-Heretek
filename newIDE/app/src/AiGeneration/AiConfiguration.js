// @flow
import { type Limits } from '../Utils/GDevelopServices/Usage';
import {
  type AiConfigurationPreset,
  type AiSettings,
} from '../Utils/GDevelopServices/Generation';
import {
  isCustomEndpointEnabled,
  DEFAULT_LOCAL_AI_SETTINGS,
} from '../AI/CustomAIClient';

export type AiConfigurationPresetWithAvailability = {|
  ...AiConfigurationPreset,
  disabled: boolean,
  enableWith: 'higher-tier-plan' | null,
  enabledWithPlans: Array<string>,
|};

export const getAiConfigurationPresetsWithAvailability = ({
  getAiSettings,
  limits,
}: {|
  getAiSettings: () => AiSettings | null,
  limits: ?Limits,
|}): Array<AiConfigurationPresetWithAvailability> => {
  if (isCustomEndpointEnabled()) {
    const aiSettings = getAiSettings() || DEFAULT_LOCAL_AI_SETTINGS;
    return aiSettings.aiRequest.presets.map(preset => ({
      ...preset,
      enableWith: null,
      enabledWithPlans: [],
      disabled: false,
    }));
  }

  // Settings may still be loading (or the CDN returned a bad shape after
  // retries). An empty preset list hides the selector and blocks mode
  // defaults — fall back to the offline BYOK catalog instead.
  const aiSettings = getAiSettings() || DEFAULT_LOCAL_AI_SETTINGS;

  if (!limits) {
    return aiSettings.aiRequest.presets.map(preset => ({
      ...preset,
      enableWith: null,
      enabledWithPlans: [],
      disabled: !preset.isDefault,
    }));
  }

  return aiSettings.aiRequest.presets.map(preset => {
    const presetAvailability = limits.capabilities.ai.availablePresets.find(
      presetAvailability =>
        presetAvailability.id === preset.id &&
        presetAvailability.mode === preset.mode
    );

    return {
      ...preset,
      disabled:
        presetAvailability && presetAvailability.disabled !== undefined
          ? presetAvailability.disabled
          : preset.disabled,
      enableWith: (presetAvailability && presetAvailability.enableWith) || null,
      enabledWithPlans:
        (presetAvailability && presetAvailability.enabledWithPlans) || [],
    };
  });
};

export const getDefaultAiConfigurationPresetId = (
  mode: 'chat' | 'agent' | 'orchestrator',
  aiConfigurationPresetsWithAvailability: Array<AiConfigurationPresetWithAvailability>
): string => {
  const presetsForMode = aiConfigurationPresetsWithAvailability.filter(
    preset => preset.mode === mode
  );

  // The backend can mark the default preset disabled for a user's tier. Picking
  // it anyway preselects a configuration the user cannot use (the selector shows
  // it struck through / the send path may refuse it), so prefer an enabled
  // preset: the enabled default first, then any enabled one.
  const enabledDefault = presetsForMode.find(
    preset => preset.isDefault && !preset.disabled
  );
  if (enabledDefault) return enabledDefault.id;

  const anyEnabled = presetsForMode.find(preset => !preset.disabled);
  if (anyEnabled) return anyEnabled.id;

  // Everything is disabled (or the list is empty): keep the previous behaviour
  // so the selector still has a value to show.
  const defaultPresetWithAvailability = presetsForMode.find(
    preset => preset.isDefault
  );

  return (
    (defaultPresetWithAvailability && defaultPresetWithAvailability.id) ||
    'default'
  );
};
