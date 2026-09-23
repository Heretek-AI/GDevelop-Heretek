// @flow
import {
  getAiConfigurationPresetsWithAvailability,
  getDefaultAiConfigurationPresetId,
} from './AiConfiguration';
import {
  setCustomEndpointConfig,
  DEFAULT_LOCAL_AI_SETTINGS,
  _resetCustomAiClientForTesting,
} from '../AI/CustomAIClient';

const defaultEndpointOff = () => {
  setCustomEndpointConfig({
    enabled: false,
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'qwen2.5-coder',
    temperature: 0.7,
  });
};

describe('getAiConfigurationPresetsWithAvailability', () => {
  beforeEach(() => {
    _resetCustomAiClientForTesting();
    defaultEndpointOff();
  });

  afterEach(() => {
    defaultEndpointOff();
  });

  it('falls back to offline defaults when settings have not loaded (hosted path)', () => {
    const presets = getAiConfigurationPresetsWithAvailability({
      getAiSettings: () => null,
      limits: null,
    });

    expect(presets.length).toBeGreaterThan(0);
    expect(presets.map(preset => preset.id)).toEqual(
      DEFAULT_LOCAL_AI_SETTINGS.aiRequest.presets.map(preset => preset.id)
    );
    // Without limits, non-default presets stay disabled on the hosted path.
    const defaultsOnly = presets.filter(preset => preset.isDefault);
    expect(defaultsOnly.length).toBeGreaterThan(0);
    defaultsOnly.forEach(preset => {
      expect(preset.disabled).toBe(false);
    });
  });

  it('enables every offline default preset when the custom endpoint is on', () => {
    setCustomEndpointConfig({
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      temperature: 0.7,
    });

    const presets = getAiConfigurationPresetsWithAvailability({
      getAiSettings: () => null,
      limits: null,
    });

    expect(presets.length).toBeGreaterThan(0);
    presets.forEach(preset => {
      expect(preset.disabled).toBe(false);
      expect(preset.enableWith).toBe(null);
    });
  });

  it('still maps hosted settings when they are loaded', () => {
    const presets = getAiConfigurationPresetsWithAvailability({
      getAiSettings: () => ({
        aiRequest: {
          presets: [
            {
              mode: 'chat',
              id: 'hosted-chat',
              nameByLocale: { en: 'Hosted chat' },
              disabled: false,
              isDefault: true,
            },
          ],
        },
      }),
      limits: null,
    });

    expect(presets.map(preset => preset.id)).toEqual(['hosted-chat']);
    expect(presets[0].disabled).toBe(false);
  });
});

describe('getDefaultAiConfigurationPresetId', () => {
  it('returns the default preset id for the mode', () => {
    const id = getDefaultAiConfigurationPresetId('chat', [
      {
        ...DEFAULT_LOCAL_AI_SETTINGS.aiRequest.presets[1],
        disabled: false,
        enableWith: null,
        enabledWithPlans: [],
      },
    ]);
    expect(id).toBe('chat-default');
  });

  it('prefers an enabled preset when the default one is disabled', () => {
    // The backend can mark the default preset disabled for a user's tier.
    // Returning it would preselect a configuration the user cannot use.
    const id = getDefaultAiConfigurationPresetId('chat', [
      {
        mode: 'chat',
        id: 'chat-premium',
        nameByLocale: { en: 'Premium chat' },
        disabled: true,
        isDefault: true,
        enableWith: 'higher-tier-plan',
        enabledWithPlans: ['gold'],
      },
      {
        mode: 'chat',
        id: 'chat-basic',
        nameByLocale: { en: 'Basic chat' },
        disabled: false,
        isDefault: false,
        enableWith: null,
        enabledWithPlans: [],
      },
    ]);
    expect(id).toBe('chat-basic');
  });

  it('picks the enabled default when the default itself is usable', () => {
    const id = getDefaultAiConfigurationPresetId('chat', [
      {
        mode: 'chat',
        id: 'chat-other',
        nameByLocale: { en: 'Other' },
        disabled: false,
        isDefault: false,
        enableWith: null,
        enabledWithPlans: [],
      },
      {
        mode: 'chat',
        id: 'chat-default',
        nameByLocale: { en: 'Default' },
        disabled: false,
        isDefault: true,
        enableWith: null,
        enabledWithPlans: [],
      },
    ]);
    expect(id).toBe('chat-default');
  });

  it('keeps the disabled default when every preset is disabled', () => {
    // Nothing usable: still return a real id so the selector has a value.
    const id = getDefaultAiConfigurationPresetId('agent', [
      {
        mode: 'agent',
        id: 'agent-locked',
        nameByLocale: { en: 'Locked' },
        disabled: true,
        isDefault: true,
        enableWith: 'higher-tier-plan',
        enabledWithPlans: ['gold'],
      },
    ]);
    expect(id).toBe('agent-locked');
  });

  it('ignores presets of another mode', () => {
    const id = getDefaultAiConfigurationPresetId('orchestrator', [
      {
        mode: 'chat',
        id: 'chat-default',
        nameByLocale: { en: 'Chat' },
        disabled: false,
        isDefault: true,
        enableWith: null,
        enabledWithPlans: [],
      },
    ]);
    // No orchestrator preset at all: the documented fallback.
    expect(id).toBe('default');
  });

  it('falls back to default when the list is empty', () => {
    expect(getDefaultAiConfigurationPresetId('orchestrator', [])).toBe(
      'default'
    );
  });

  it('does not throw when the limits response is missing capabilities.ai', () => {
    // getUserLimits only validates that the top-level `capabilities` key
    // exists (ensureObjectHasProperty), so a partial response passes through.
    // `limits.capabilities.ai.availablePresets` was walked three levels deep
    // behind only an `if (!limits)` guard, and this runs on every chat render.
    const settings = {
      aiRequest: {
        presets: [
          {
            mode: 'chat',
            id: 'default',
            name: 'Default',
            isDefault: true,
            disabled: false,
            nameByLocale: {},
          },
        ],
      },
    };
    for (const limits of [
      { capabilities: {} },
      { capabilities: { ai: {} } },
      { capabilities: null },
    ]) {
      // $FlowFixMe deliberately a partial Limits shape.
      const presets = getAiConfigurationPresetsWithAvailability({
        getAiSettings: () => settings,
        limits,
      });
      expect(presets.length).toBe(1);
      expect(presets[0].id).toBe('default');
    }
  });
});
