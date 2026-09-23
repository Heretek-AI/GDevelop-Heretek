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

  it('falls back to default when the list is empty', () => {
    expect(getDefaultAiConfigurationPresetId('orchestrator', [])).toBe(
      'default'
    );
  });
});
