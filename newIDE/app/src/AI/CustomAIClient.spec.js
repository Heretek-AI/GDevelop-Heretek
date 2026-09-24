// @flow
import axios from 'axios';
import {
  getCustomEndpointConfig,
  setCustomEndpointConfig,
  isCustomEndpointEnabled,
  normalizeBaseUrl,
  getEndpointUrl,
  extractThinkingAndContent,
  transformGDevelopMessagesToOpenAi,
  parseAssistantMessage,
  DEFAULT_CUSTOM_AI_CONFIG,
  MAX_TIMEOUT_MS,
  GDEVELOP_OPENAI_TOOLS,
  SIDE_EFFECT_FREE_TOOLS,
  LOCAL_BYOK_USER_ID,
  _resetCustomAiClientForTesting,
  customCreateAiRequest,
  customCreateSubAgentAiRequest,
  customAddMessageToAiRequest,
  customUpdateAiRequest,
  customGetAiRequest,
  customGetAiRequestPartialContent,
  customGetAiRequests,
  customGetAiRequestStatuses,
  customSuspendAiRequest,
  customForkAiRequest,
  customDeleteAiRequest,
  customPatchAiRequestAttributes,
  customRetryAiRequest,
  customGetAiRequestSuggestions,
  sanitizeAiRequestSuggestions,
  customCreateAiGeneratedEvent,
  customCreateAssetSearch,
  customCreateResourceSearch,
  testConnection,
  sendChatCompletion,
  formatProviderTelemetry,
  withoutBackendOnlyTools,
  BACKEND_ONLY_TOOL_NAMES,
  buildSystemPrompt,
  getEffectiveConfigForRequest,
  parseProviderTelemetry,
  customGetAiRequestProviderTelemetry,
  isContextOverflowError,
  isNetworkLevelError,
  isRetryableProviderError,
  getProviderErrorStatus,
  estimateTokens,
  estimateToolsTokens,
  getMessageBudget,
  getTokenBudget,
  estimateMessagesTokens,
  trimMessagesToBudget,
  compactSystemMessageToBudget,
  validateToolCallArguments,
  customGetAiRequestContextTrimCount,
  customGetAiRequestSystemCompacted,
  customHasPendingCreateAiRequest,
  customAbortPendingCreateAiRequests,
  customGetAiRequestTokenTotal,
  customGetAiRequestContextTokens,
  customSetAiRequestModelOverride,
  customGetAiRequestModelOverride,
  loadLocalAiRequests,
  withLocalAiTurnLock,
  loadLocalAiRequestModelOverridesForTesting,
  loadLocalAiRequestTokenTotalsForTesting,
  recordLocalAiRequestTokenUsageForTesting,
  loadLocalAiSubAgentRequestsForTesting,
  saveLocalAiRequests,
  _resetCustomAiClientForTesting as _resetForStreamTests,
} from './CustomAIClient';
import { isFailedAiRequestStart } from '../AiGeneration/AiRequestUtils';

import {
  getToolsForRole,
  MUTATING_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
} from '../AiGeneration/Studio/Roles';

jest.mock('axios');

describe('CustomAIClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetCustomAiClientForTesting();
    setCustomEndpointConfig({
      enabled: false,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      temperature: 0.7,
    });
  });

  describe('Configuration & URL normalization', () => {
    it('returns default configuration initially', () => {
      const config = getCustomEndpointConfig();
      expect(config.baseUrl).toBe('http://localhost:11434/v1');
      expect(config.model).toBe('qwen2.5-coder');
      expect(config.temperature).toBe(0.7);
    });

    it('updates configuration and reflects enabled state', () => {
      expect(isCustomEndpointEnabled()).toBe(false);
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:8080/v1',
        apiKey: 'test-key',
        model: 'llama-3.2',
        temperature: 0.2,
      });
      expect(isCustomEndpointEnabled()).toBe(true);
      const config = getCustomEndpointConfig();
      expect(config.baseUrl).toBe('http://localhost:8080/v1');
      expect(config.apiKey).toBe('test-key');
      expect(config.model).toBe('llama-3.2');
      expect(config.temperature).toBe(0.2);
    });

    it('normalizes base URLs correctly without auto-appending /v1', () => {
      expect(normalizeBaseUrl('http://localhost:11434')).toBe(
        'http://localhost:11434'
      );
      expect(normalizeBaseUrl('http://localhost:11434/')).toBe(
        'http://localhost:11434'
      );
      expect(normalizeBaseUrl('http://localhost:11434/v1/')).toBe(
        'http://localhost:11434/v1'
      );
      expect(normalizeBaseUrl('localhost:11434/v1')).toBe(
        'http://localhost:11434/v1'
      );
      expect(normalizeBaseUrl('api.openai.com/v1')).toBe(
        'https://api.openai.com/v1'
      );
      expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe(
        'https://api.openai.com/v1'
      );
      expect(normalizeBaseUrl('https://openrouter.ai/api/v1/')).toBe(
        'https://openrouter.ai/api/v1'
      );
      expect(normalizeBaseUrl('')).toBe(DEFAULT_CUSTOM_AI_CONFIG.baseUrl);
    });

    it('constructs correct endpoint URLs', () => {
      expect(
        getEndpointUrl('http://localhost:11434/v1', '/chat/completions')
      ).toBe('http://localhost:11434/v1/chat/completions');
      expect(getEndpointUrl('http://localhost:11434', '/models')).toBe(
        'http://localhost:11434/models'
      );
    });
  });

  describe('normalizeBaseUrl does not mask a malformed scheme', () => {
    it('leaves a mistyped scheme alone so the error names the real problem', () => {
      // Prefixing https:// to `htpp://localhost:11434` produced the host
      // `htpp`, which fails later as a confusing DNS error. Returning it means
      // the request fails with the "check the base URL" guidance instead.
      expect(normalizeBaseUrl('htpp://localhost:11434/v1')).toBe(
        'htpp://localhost:11434/v1'
      );
      expect(normalizeBaseUrl('ftp://host/v1')).toBe('ftp://host/v1');
      expect(normalizeBaseUrl('http:/localhost:11434')).toBe(
        'http:/localhost:11434'
      );
    });

    it('still repairs genuinely schemeless input', () => {
      // The cases the fallback exists for must keep working.
      expect(normalizeBaseUrl('localhost:11434/v1')).toBe(
        'http://localhost:11434/v1'
      );
      expect(normalizeBaseUrl('localhost')).toBe('http://localhost');
      expect(normalizeBaseUrl('example.com/v1')).toBe('https://example.com/v1');
      expect(normalizeBaseUrl('')).toBe('http://localhost:11434/v1');
    });
  });

  describe('extractThinkingAndContent', () => {
    it('extracts <think> tags from text', () => {
      const input =
        '<think>I should create an object</think>Here is the answer';
      const result = extractThinkingAndContent(input);
      expect(result.thinking).toBe('I should create an object');
      expect(result.content).toBe('Here is the answer');
    });

    it('handles text without <think> tags', () => {
      const input = 'Simple response with no thinking tag';
      const result = extractThinkingAndContent(input);
      expect(result.thinking).toBeNull();
      expect(result.content).toBe('Simple response with no thinking tag');
    });

    // Built by concatenation so linters/display layers never treat the tag
    // as markup.
    const THINK_OPEN = String.fromCharCode(60) + 'think>';
    const THINK_CLOSE = String.fromCharCode(60) + '/think>';

    it('treats an unclosed think tag as thinking (truncated reasoning)', () => {
      const input = THINK_OPEN + 'Let me create the object';
      const result = extractThinkingAndContent(input);
      expect(result.thinking).toBe('Let me create the object');
      expect(result.content).toBe('');
      expect(result.cleanContent).toBe('');
    });

    it('still extracts closed tags when both open and close exist', () => {
      const input = THINK_OPEN + 'Answer' + THINK_CLOSE + 'more';
      const result = extractThinkingAndContent(input);
      expect(result.thinking).toBe('Answer');
      expect(result.content).toBe('more');
    });

    it('handles empty or non-string input', () => {
      expect(extractThinkingAndContent('')).toEqual({
        thinking: null,
        cleanContent: '',
        content: '',
      });
      // $FlowFixMe
      expect(extractThinkingAndContent(null)).toEqual({
        thinking: null,
        cleanContent: '',
        content: '',
      });
    });
  });

  describe('transformGDevelopMessagesToOpenAi', () => {
    it('skips null and scalar entries instead of throwing', () => {
      // A persisted request's output is not shape-validated on load, and
      // normalizePersistedMessages passes a non-message entry through
      // unchanged — so a hole or a scalar reaches this loop, whose first read
      // is `msg.role`.
      const messages: any = [
        null,
        undefined,
        'a string',
        42,
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'user_request', text: 'hi' }],
        },
      ];
      const openAiMessages = transformGDevelopMessagesToOpenAi(messages);
      expect(openAiMessages.some(m => m.role === 'user')).toBe(true);
    });

    it('skips null entries inside content and call arrays instead of throwing', () => {
      // normalizePersistedMessages validates that `output` is an array but
      // passes inner entries through unchanged, so a null inside a content,
      // functionCalls or functionCallOutputs array reaches every `.type`/`.id`
      // read below. All four threw `Cannot read properties of null`.
      const messages: any = [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'user_request', text: 'hi' }, null, 'scalar'],
        },
        {
          type: 'message',
          role: 'assistant',
          text: 'working',
          content: [
            {
              type: 'function_call',
              name: 'describe_instances',
              call_id: 'c1',
              arguments: '{}',
            },
            null,
          ],
          functionCalls: [null],
        },
        {
          type: 'function_call_output',
          functionCallOutputs: [null],
        },
      ];
      let openAiMessages;
      expect(
        () => (openAiMessages = transformGDevelopMessagesToOpenAi(messages))
      ).not.toThrow();
      expect(
        openAiMessages.some(m => m.role === 'user' && m.content === 'hi')
      ).toBe(true);
      expect(
        openAiMessages.some(
          m =>
            m.role === 'assistant' &&
            Array.isArray(m.tool_calls) &&
            m.tool_calls[0].function.name === 'describe_instances'
        )
      ).toBe(true);
    });

    it('formats user messages and system prompt', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'user',
          text: 'Hello, create a player object',
          createdAt: new Date().toISOString(),
        },
      ];
      const openAiMessages = transformGDevelopMessagesToOpenAi(
        messages,
        '{"objects":[]}',
        null,
        'agent'
      );

      expect(openAiMessages[0].role).toBe('system');
      expect(openAiMessages[0].content).toContain('GDevelop AI Assistant');
      expect(openAiMessages[0].content).toContain('{"objects":[]}');

      const userMsg = openAiMessages.find(m => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg && userMsg.content).toBe('Hello, create a player object');
    });

    it('formats assistant messages with function calls and reasoning', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'user',
          text: 'Add sprite',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          type: 'assistant',
          text: 'I am creating the object',
          thinking: 'Let us make Player',
          functionCalls: [
            {
              id: 'call-1',
              name: 'create_or_replace_object',
              callArguments: { objectName: 'Player', objectType: 'Sprite' },
            },
          ],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'msg-3',
          type: 'function_call_output',
          functionCallOutputs: [
            {
              callId: 'call-1',
              output: '{"status":"ok"}',
            },
          ],
          createdAt: new Date().toISOString(),
        },
      ];

      const openAiMessages = transformGDevelopMessagesToOpenAi(
        messages,
        null,
        null,
        'agent'
      );

      const assistantMsg = openAiMessages.find(m => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg && assistantMsg.content).toBe(
        'I am creating the object'
      );
      expect(assistantMsg && assistantMsg.tool_calls).toBeDefined();
      expect(
        assistantMsg &&
          assistantMsg.tool_calls &&
          assistantMsg.tool_calls[0].function.name
      ).toBe('create_or_replace_object');

      const toolMsg = openAiMessages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg && toolMsg.tool_call_id).toBe('call-1');
      expect(toolMsg && toolMsg.content).toBe('{"status":"ok"}');
    });
  });

  describe('parseAssistantMessage', () => {
    it('parses standard OpenAI tool calls', () => {
      const choice = {
        message: {
          role: 'assistant',
          content: 'Creating a scene',
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'create_scene',
                arguments: '{"scene_name":"Level1"}',
              },
            },
          ],
        },
      };

      const parsed = parseAssistantMessage(choice);
      expect(parsed.text).toBe('Creating a scene');
      expect(parsed.functionCalls).toHaveLength(1);
      expect(parsed.functionCalls[0].name).toBe('create_scene');
      expect(parsed.functionCalls[0].callArguments).toEqual({
        scene_name: 'Level1',
      });
    });

    it('extracts embedded JSON function call markdown if tool_calls not present for side-effect-free tools', () => {
      const choice = {
        message: {
          role: 'assistant',
          content:
            'I will inspect the instances now:\n```json\n{"name":"describe_instances","arguments":{"scene_name":"Level1"}}\n```',
        },
      };

      const parsed = parseAssistantMessage(choice);
      expect(parsed.functionCalls).toHaveLength(1);
      expect(parsed.functionCalls[0].name).toBe('describe_instances');
      expect(parsed.functionCalls[0].callArguments).toEqual({
        scene_name: 'Level1',
      });
    });

    it('extracts an embedded JSON call for a name that was previously dead', () => {
      // The set listed describe_events/describe_variables/
      // describe_scene_layers_effects_groups, none of which the registry
      // declares — so these tools were silently excluded from the fallback.
      // The existing behavioural tests only used describe_instances, the one
      // correct entry, which is why the typo went unnoticed.
      // Each tool's own required arguments (the fallback still validates the
      // schema, so an empty object would be skipped for the wrong reason).
      for (const [name, args] of [
        ['read_events_source', { scene_name: 'Level1' }],
        ['inspect_variables', { variable_scope: 'scene' }],
        ['inspect_scene_properties_layers_effects', { scene_name: 'Level1' }],
      ]) {
        const parsed = parseAssistantMessage({
          message: {
            role: 'assistant',
            content: `\`\`\`json\n${JSON.stringify({
              name,
              arguments: args,
            })}\n\`\`\``,
          },
        });
        expect(parsed.functionCalls).toHaveLength(1);
        expect(parsed.functionCalls[0].name).toBe(name);
      }
    });

    it('skips markdown tool calls whose arguments are not JSON objects', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const choice = {
        message: {
          role: 'assistant',
          content:
            '```json\n{"name":"describe_instances","arguments":["not","an","object"]}\n```',
        },
      };
      const parsed = parseAssistantMessage(choice);
      expect(parsed.functionCalls).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('invalid arguments')
      );
      warn.mockRestore();
    });

    it('skips markdown tool calls that fail schema validation', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const choice = {
        message: {
          role: 'assistant',
          content:
            '```json\n{"name":"describe_instances","arguments":{"wrong_arg":1}}\n```',
        },
      };
      const parsed = parseAssistantMessage(choice);
      expect(parsed.functionCalls).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('invalid arguments')
      );
      warn.mockRestore();
    });

    it('extracts reasoning_content if provided by model', () => {
      const choice = {
        message: {
          role: 'assistant',
          content: 'Done!',
          reasoning_content: 'Step 1: check parameters. Step 2: verify.',
        },
      };

      const parsed = parseAssistantMessage(choice);
      expect(parsed.text).toBe('Done!');
      expect(parsed.thinking).toBe('Step 1: check parameters. Step 2: verify.');
    });
  });

  describe('GDevelop OpenAI Tool Definitions', () => {
    it('defines standard GDevelop tools', () => {
      const toolNames = GDEVELOP_OPENAI_TOOLS.map(t => t.function.name);
      expect(toolNames).toContain('create_scene');
      expect(toolNames).toContain('create_or_replace_object');
      expect(toolNames).toContain('add_behavior');
      expect(toolNames).toContain('put_2d_instances');
      expect(toolNames).toContain('add_scene_events');
      expect(toolNames).toContain('run_script');
      expect(toolNames).toContain('create_or_update_plan');
    });

    it('documents the run_script sandbox so models call functions instead of probing globals', () => {
      // Observed failure: ten turns enumerating `gd`/globals/webpack chunks
      // because the description said only "project APIs". Pin the teaching.
      const runScript = GDEVELOP_OPENAI_TOOLS.find(
        t => t.function.name === 'run_script'
      );
      expect(runScript).toBeTruthy();
      const description = runScript.function.description;
      expect(description).toContain('await');
      expect(description).toContain('never probe');
    });

    it('advertises behavior changes as changed_properties, matching the implementation', () => {
      // Observed failure (feedback-loop Run 4): the schema listed flat
      // `property_name`/`new_value` while the tool reads `changed_properties`
      // (like its sibling change_object_properties_effects). A model following
      // the schema sent flat fields, `changed_properties` was always empty, and
      // every call reported "Nothing changed. Issues: ...". Pin the array shape
      // so schema and implementation cannot drift apart again.
      const tool = GDEVELOP_OPENAI_TOOLS.find(
        t => t.function.name === 'change_behavior_property'
      );
      expect(tool).toBeTruthy();
      const parameters: any = tool && tool.function.parameters;
      const properties: any = parameters.properties;
      expect(properties.changed_properties.type).toBe('array');
      expect(properties.changed_properties.items.required).toEqual([
        'property_name',
        'new_value',
      ]);
      expect(properties.property_name).toBeUndefined();
      expect(properties.new_value).toBeUndefined();
      expect(parameters.required).toEqual(['object_name', 'behavior_name']);
    });

    it('advertises the array args the change tools actually read', () => {
      // Second half of the change_behavior_property bug: several change tools
      // read a top-level array/object arg the schema never advertised, so a
      // schema-conformant model could never use the capability. Pin each.
      const toolProps = (name: string): any => {
        const tool = GDEVELOP_OPENAI_TOOLS.find(t => t.function.name === name);
        expect(tool).toBeTruthy();
        return tool ? tool.function.parameters.properties : {};
      };
      expect(
        toolProps('change_object_properties_effects').changed_effects.type
      ).toBe('array');
      const groups = toolProps('change_scene_properties_layers_effects_groups');
      expect(groups.changed_groups.type).toBe('array');
      expect(groups.changed_layer_effects.type).toBe('array');
      expect(groups.move_instances.type).toBe('object');
      expect(
        toolProps('change_project_properties_resources').changed_resources.type
      ).toBe('array');
    });
  });

  describe('testConnection', () => {
    it('successfully connects when endpoint responds', async () => {
      // $FlowFixMe
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: {
          data: [{ id: 'qwen2.5-coder' }, { id: 'gpt-4o' }],
        },
      });

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.models).toContain('qwen2.5-coder');
    });

    it('warns when the configured model is not in the endpoint list', async () => {
      // $FlowFixMe
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { data: [{ id: 'qwen2.5-coder' }, { id: 'llama3.2' }] },
      });

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.6-coder-typo',
        temperature: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('was not found in the endpoint');
    });

    it('does not warn when the configured model exists', async () => {
      // $FlowFixMe
      axios.get.mockResolvedValueOnce({
        status: 200,
        data: { data: [{ id: 'qwen2.5-coder' }] },
      });

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.message).not.toContain('was not found');
    });

    it('handles endpoint error gracefully', async () => {
      // $FlowFixMe
      axios.get.mockRejectedValueOnce(new Error('Connection refused'));
      // $FlowFixMe
      axios.post.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:9999/v1',
        apiKey: '',
        model: 'test-model',
        temperature: 0.7,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection failed');
    });

    it('sends the API key as a Bearer token and the safe custom headers', async () => {
      // $FlowFixMe
      axios.get.mockResolvedValueOnce({ status: 200, data: { data: [] } });

      await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'secret-key',
        model: 'qwen2.5-coder',
        temperature: 0.7,
        customHeaders: { 'X-Ok': 'yes', 'X-Bad': 'a\nb', Host: 'evil' },
      });

      const headers = axios.get.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer secret-key');
      expect(headers['X-Ok']).toBe('yes');
      // Header-injection and hop-by-hop names must not reach the probe either.
      expect(headers['X-Bad']).toBeUndefined();
      expect(headers.Host).toBeUndefined();
    });

    it('sends no Authorization header when the key is blank', async () => {
      // $FlowFixMe
      axios.get.mockResolvedValueOnce({ status: 200, data: { data: [] } });

      await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '   ',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });

      const headers = axios.get.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it('falls back to a chat completion when /models is unavailable', async () => {
      // $FlowFixMe
      axios.get.mockRejectedValueOnce(new Error('404 not found'));
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'OK' } }] },
      });

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('OK');
    });
  });

  describe('tool-call argument validation', () => {
    const parseOne = content =>
      parseAssistantMessage({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            function: { name: 'test_tool', arguments: content },
          },
        ],
      });

    it('parses valid JSON object arguments', () => {
      const message = parseOne('{"sceneName": "Menu"}');
      const call = message.functionCalls[0];
      expect(call.callArguments).toEqual({ sceneName: 'Menu' });
    });

    it('falls back to empty arguments on malformed JSON', () => {
      const message = parseOne('{not valid json');
      expect(message.functionCalls[0].callArguments).toEqual({});
    });

    it('rejects non-object arguments (array, scalar)', () => {
      const arrayMessage = parseOne('["not","an","object"]');
      expect(arrayMessage.functionCalls[0].callArguments).toEqual({});

      const scalarMessage = parseOne('42');
      expect(scalarMessage.functionCalls[0].callArguments).toEqual({});
    });
  });

  describe('per-tool schema validation', () => {
    it('accepts arguments matching the tool schema', () => {
      const validation = validateToolCallArguments('create_scene', {
        scene_name: 'Menu',
      });
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it('flags missing required arguments', () => {
      const validation = validateToolCallArguments('create_scene', {});
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('scene_name');
    });

    it('flags wrong argument types and unknown arguments', () => {
      const wrongType = validateToolCallArguments('create_scene', {
        scene_name: 42,
      });
      expect(wrongType.valid).toBe(false);
      expect(wrongType.errors[0]).toContain("should be of type 'string'");

      const unknown = validateToolCallArguments('create_scene', {
        scene_name: 'Menu',
        not_in_schema: true,
      });
      expect(unknown.valid).toBe(false);
      expect(unknown.errors[0]).toContain('not_in_schema');
    });

    it('passes unknown tools through unvalidated', () => {
      const validation = validateToolCallArguments('not_a_real_tool', {
        anything: 'goes',
      });
      expect(validation.valid).toBe(true);
    });

    it('accepts run_script with js_code (matching the editor implementation)', () => {
      const validation = validateToolCallArguments('run_script', {
        js_code: 'return 1;',
      });
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it('accepts run_script with the legacy script alias via parseAssistantMessage', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const message = parseAssistantMessage({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-alias',
            function: {
              name: 'run_script',
              arguments: JSON.stringify({ script: 'return 1;' }),
            },
          },
        ],
      });
      expect(message.functionCalls[0].callArguments).toEqual({
        script: 'return 1;',
        js_code: 'return 1;',
      });
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('failed schema validation')
      );
      warn.mockRestore();
    });

    it('keeps Ollama-style reasoning field as thinking', () => {
      const message = parseAssistantMessage({
        role: 'assistant',
        content: 'Hello',
        reasoning: 'Let me think about TileMap.',
      });
      const reasoningEntry = (message.content || []).find(
        entry => entry.type === 'reasoning'
      );
      expect(reasoningEntry && reasoningEntry.summary.text).toBe(
        'Let me think about TileMap.'
      );
    });

    it('treats a non-string network content as empty instead of throwing', () => {
      // A proxy may send content as an object or an array of blocks (both
      // truthy): the old `openAiMessage.content || ''` passed it into
      // extractThinkingAndContent, whose `.match` then threw out of the turn.
      expect(() =>
        parseAssistantMessage({
          role: 'assistant',
          content: ({ text: 'hi' }: any),
        })
      ).not.toThrow();
      expect(() =>
        parseAssistantMessage({
          role: 'assistant',
          content: ([{ type: 'text', text: 'hi' }]: any),
        })
      ).not.toThrow();
    });

    it('ignores a non-string reasoning field instead of rendering an object', () => {
      // summary.text is rendered as chat text: an object there throws
      // 'Objects are not valid as a React child' on the next render.
      const message = parseAssistantMessage({
        role: 'assistant',
        content: 'Hello',
        reasoning: (({ text: 'deep thought' }: any): string),
      });
      const reasoningEntry = (message.content || []).find(
        entry => entry.type === 'reasoning'
      );
      expect(reasoningEntry).toBeUndefined();
    });

    it('sanitizes schema-invalid tool calls in parseAssistantMessage', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const message = parseAssistantMessage({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-schema',
            function: { name: 'create_scene', arguments: '{}' },
          },
        ],
      });
      expect(message.functionCalls[0].callArguments).toEqual({});
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('failed schema validation')
      );
      warn.mockRestore();
    });
  });

  describe('token budget helpers', () => {
    it('estimates ASCII tokens at ~4 characters per token', () => {
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcde')).toBe(2);
      expect(estimateTokens('a'.repeat(400))).toBe(100);
    });

    it('counts non-Latin characters far more densely than ASCII', () => {
      // CJK is roughly one token per character. Counting it at 1-per-4 (the
      // old flat rule) under-reported a Chinese project structure by ~4x, so
      // the trimmed prompt still exceeded the window it was trimmed for.
      const cjk = '创建一个名为英雄的精灵对象并设置生命值'; // 18 chars
      expect(estimateTokens(cjk)).toBe(cjk.length);
      // Much denser than the ASCII rule would have produced.
      expect(estimateTokens(cjk)).toBeGreaterThan(
        Math.ceil(cjk.length / 4) * 3
      );
    });

    it('counts the non-Latin part densely and the ASCII part at 1-per-4', () => {
      // Mixed content: the ASCII names in a project JSON stay cheap while the
      // translated labels cost their real weight.
      const mixed = 'abcd英雄'; // 4 ascii + 2 cjk
      expect(estimateTokens(mixed)).toBe(1 + 2);
    });

    it('keeps accented Latin text cheap (they are single-byte-ish letters)', () => {
      // Guard against over-counting: é is non-ASCII but still ~1 token per
      // few characters, far from CJK density.
      const accented = 'Café'.repeat(20); // 80 chars, 20 non-ascii
      const estimate = estimateTokens(accented);
      expect(estimate).toBeLessThan(accented.length);
      expect(estimate).toBeGreaterThanOrEqual(Math.ceil(accented.length / 4));
    });

    it('scales the budget by model family and reserves output room', () => {
      expect(getTokenBudget({ model: 'gpt-4o' })).toBe(64000);
      expect(getTokenBudget({ model: 'claude-3-5-sonnet' })).toBe(64000);
      expect(getTokenBudget({ model: 'llama3.2' })).toBe(4096);
      expect(getTokenBudget({ model: 'mistral-7b' })).toBe(16384);
      expect(getTokenBudget({ model: 'unknown-model' })).toBe(64000);
      expect(getTokenBudget(null)).toBe(64000);
    });

    it('trims oldest history but keeps system prompt and latest exchange', () => {
      const system = { role: 'system', content: 'x'.repeat(400) }; // 100 tokens
      const old = Array.from({ length: 10 }, (_, i) => ({
        role: 'user',
        content: 'y'.repeat(400), // 100 tokens each
      }));
      const last = [
        { role: 'user', content: 'z'.repeat(400) },
        { role: 'assistant', content: 'w'.repeat(400) },
      ];
      const messages = [system, ...old, ...last];

      // Budget fits system(100) + last2(200) + 2 old(200): 500 tokens.
      const trimmed = trimMessagesToBudget(messages, 500);
      expect(trimmed[0]).toBe(system);
      expect(trimmed).toContain(last[0]);
      expect(trimmed).toContain(last[1]);
      expect(trimmed.length).toBeLessThan(messages.length);
      expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(500);

      // A malformed tool_calls field must not break the estimate: `|| []` kept
      // a truthy non-array, which is not iterable.
      expect(() =>
        estimateMessagesTokens([
          ({
            role: 'assistant',
            content: 'x',
            tool_calls: { not: 'an array' },
          }: any),
          ({ role: 'assistant', content: 'y', tool_calls: 3 }: any),
        ])
      ).not.toThrow();
    });

    it('does not split a surrogate pair when capping the system prompt', () => {
      // Astral characters (emoji, rare CJK) are two UTF-16 code units; cutting
      // between them leaves a lone surrogate, which encodes to U+FFFD — the
      // truncated prompt reached the model with a replacement character where a
      // real scene/object name was.
      const hasLoneSurrogate = (value: string): boolean => {
        for (let i = 0; i < value.length; i++) {
          const code = value.charCodeAt(i);
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(i + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
            i++;
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
          }
        }
        return false;
      };

      // maxSystemTokens is floored at 128 and 256 tokens are reserved for the
      // newest exchange, so the body must genuinely exceed the cap. Repeating
      // 'A<emoji>' puts a high surrogate at every odd code-unit offset, so
      // roughly half of all cut points fall between the halves of a pair —
      // the sweep below lands on many of them without the fix.
      const body = 'A\u{1F3AE}'.repeat(2000);
      const messages = [
        { role: 'system', content: body },
        { role: 'user', content: 'hi' },
      ];

      let sawTruncation = false;
      for (let budget = 300; budget <= 700; budget += 7) {
        const [system] = compactSystemMessageToBudget(messages, budget);
        const content = system.content;
        if (typeof content !== 'string') continue;
        if (content !== body) sawTruncation = true;
        expect(hasLoneSurrogate(content)).toBe(false);
      }
      // Guard the premise: the sweep really did truncate.
      expect(sawTruncation).toBe(true);
    });

    it('still returns the original system prompt when it already fits', () => {
      const body = 'AAAA \u{1F3AE} BBBB';
      const messages = [
        { role: 'system', content: body },
        { role: 'user', content: 'hi' },
      ];
      const [system] = compactSystemMessageToBudget(messages, 4096);
      expect(system.content).toBe(body);
    });

    it('compacts large tool outputs in place before dropping anything', () => {
      const system = { role: 'system', content: 'sys' };
      const assistantWithCalls = {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', function: { name: 'test_tool', arguments: '{}' } },
        ],
      };
      const toolOutput = {
        role: 'tool',
        tool_call_id: 'c1',
        content: 'o'.repeat(20000), // ~5000 tokens
      };
      const last = [
        { role: 'user', content: 'u'.repeat(400) },
        { role: 'assistant', content: 'w'.repeat(400) },
      ];
      const messages = [system, assistantWithCalls, toolOutput, ...last];

      // Budget forces compaction but not dropping: compacted output
      // (~500 chars + marker ≈ 140 tokens) + system + last2 < 600.
      const trimmed = trimMessagesToBudget(messages, 600);
      const compactedTool = trimmed.find(m => m.role === 'tool');
      expect(compactedTool).toBeDefined();
      expect(compactedTool.content).toContain('trimmed');
      expect(compactedTool.content.length).toBeLessThan(700);
      // The tool_calls assistant stays paired with its output.
      expect(
        trimmed.find(m => m.role === 'assistant' && m.tool_calls)
      ).toBeDefined();
      expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(600);
      // The original message objects are not mutated.
      expect(toolOutput.content.length).toBe(20000);
    });

    it('compacts long assistant messages too, not only tool outputs', () => {
      const system = { role: 'system', content: 'sys' };
      const longAssistant = {
        role: 'assistant',
        content: 'a'.repeat(20000),
      };
      const last = [
        { role: 'user', content: 'u'.repeat(400) },
        { role: 'assistant', content: 'w'.repeat(400) },
      ];
      const messages = [system, longAssistant, ...last];

      const trimmed = trimMessagesToBudget(messages, 600);
      const compacted = trimmed.find(
        m => m.role === 'assistant' && m !== last[1]
      );
      expect(compacted).toBeDefined();
      expect(compacted.content).toContain('trimmed');
      expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(600);
      expect(longAssistant.content.length).toBe(20000);
    });

    it('respects the budget exactly once tool outputs are accounted for', () => {
      // Regression: tokens of tool outputs dropped via the pairing flag were
      // not subtracted from the estimate, inflating it and over-dropping
      // subsequent history.
      const system = { role: 'system', content: 'x'.repeat(400) }; // 100 tokens
      const messages = [system];
      for (let i = 0; i < 30; i++) {
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: `c${i}`, function: { name: 't', arguments: '{}' } },
          ],
        });
        messages.push({
          role: 'tool',
          tool_call_id: `c${i}`,
          content: 'o'.repeat(4000), // 1000 tokens each
        });
      }
      messages.push({ role: 'user', content: 'u'.repeat(400) }); // 100
      messages.push({ role: 'assistant', content: 'w'.repeat(400) }); // 100

      // Budget fits system(100) + last2(200) + 3 tool pairs (3×~1001) ≈ 3300.
      const trimmed = trimMessagesToBudget(messages, 3303);
      expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(3303);
      // Nothing beyond the tool pairs was over-dropped.
      const keptPairs = trimmed.filter(m => m.role === 'tool').length;
      expect(keptPairs).toBeGreaterThanOrEqual(2);
      expect(trimmed[trimmed.length - 2].content.length).toBe(400);
      expect(trimmed[trimmed.length - 1].content.length).toBe(400);
    });

    it('drops tool outputs together with their tool_calls assistant', () => {
      const system = { role: 'system', content: 'sys' };
      const assistantWithCalls = {
        role: 'assistant',
        content: 'a'.repeat(4000),
        tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{}' } }],
      };
      const toolOutput = {
        role: 'tool',
        tool_call_id: 'c1',
        content: 't'.repeat(4000),
      };
      const last = [
        { role: 'user', content: 'u'.repeat(400) },
        { role: 'assistant', content: 'w'.repeat(400) },
      ];
      const messages = [system, assistantWithCalls, toolOutput, ...last];

      const trimmed = trimMessagesToBudget(messages, 300);
      expect(trimmed).not.toContain(assistantWithCalls);
      expect(trimmed).not.toContain(toolOutput);
      // No orphan tool messages remain.
      expect(trimmed.filter(m => m.role === 'tool')).toEqual([]);
      expect(trimmed[0]).toBe(system);
    });

    it('compacts an oversized system project structure so create fits a small local budget', () => {
      const guidelines = 'You are GDevelop AI Assistant.\n';
      const structure =
        'Current Project Structure:\n' +
        JSON.stringify({
          scenes: Array.from({ length: 500 }, (_, i) => ({
            name: 'Scene' + i,
            events: 'x'.repeat(200),
          })),
        });
      const extensions =
        '\nInstalled Project Extensions:\n' + 'ext'.repeat(200) + '\n';
      const system = {
        role: 'system',
        content: guidelines + structure + extensions,
      };
      const user = { role: 'user', content: 'hello' };
      // llama budget is 4096; system alone is far larger.
      expect(estimateTokens(system.content)).toBeGreaterThan(4096);

      const trimmed = trimMessagesToBudget([system, user], 4096);
      expect(trimmed).toHaveLength(2);
      expect(trimmed[1]).toBe(user);
      const sys = trimmed[0];
      expect(sys.role).toBe('system');
      expect(sys.content).toContain('You are GDevelop AI Assistant');
      expect(sys.content).toContain(
        'truncated to fit the model context window'
      );
      // Guidelines head preserved; structure body shortened.
      expect(sys.content.indexOf('Current Project Structure:')).toBeGreaterThan(
        -1
      );
      expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(4096);
      expect(estimateTokens(sys.content)).toBeLessThanOrEqual(4096 - 256);
    });

    it('leaves a system prompt that already fits the budget untouched (same reference)', () => {
      const system = { role: 'system', content: 'short guidelines' };
      const user = { role: 'user', content: 'hi' };
      const messages = [system, user];
      const trimmed = trimMessagesToBudget(messages, 4096);
      expect(trimmed[0]).toBe(system);
      expect(trimmed).toBe(messages);
    });
  });

  describe('normalizeBaseUrl tolerates non-string input', () => {
    it('falls back to the default instead of throwing', () => {
      // Preferences hydrate each stored key without type-checking it, so a
      // corrupted `aiCustomBaseUrl` (a number, null, an object) reached this
      // function through testConnection and threw `trim is not a function`
      // before any request was made.
      for (const bad of [123, null, undefined, {}, [], true]) {
        // $FlowFixMe deliberately passing wrong types.
        expect(normalizeBaseUrl(bad)).toBe('http://localhost:11434/v1');
      }
    });

    it('still normalizes real strings', () => {
      expect(normalizeBaseUrl('localhost:11434/v1')).toBe(
        'http://localhost:11434/v1'
      );
      expect(normalizeBaseUrl('  example.com/v1  ')).toBe(
        'https://example.com/v1'
      );
    });
  });

  describe('wire temperature bound', () => {
    it('clamps an out-of-range temperature on the bypass path', async () => {
      // sendChatCompletion accepts a raw config, and testConnection merges a
      // caller-supplied partial over the stored one, so sanitizeCustomAIConfig
      // is not always in the path. An unclamped 42 (or a NaN that serializes
      // to null) reached the provider.
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'llama3.2',
          temperature: 42,
        },
      });

      expect(axios.post.mock.calls[0][1].temperature).toBe(1);
    });

    it('fails with an explanatory error when the request rejects with no reason', async () => {
      // A rejection with no reason (undefined/null) must not throw a second
      // TypeError out of the error handler, masking the real failure - and
      // testConnection below must still return a failure object, not throw.
      // $FlowFixMe
      axios.post.mockRejectedValueOnce(undefined);

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: {
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'llama3.2',
            temperature: 0.7,
          },
        })
      ).rejects.toThrow('AI request failed');
    });

    it('replaces a non-finite temperature with the default', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'llama3.2',
          temperature: NaN,
        },
      });

      // Not null: JSON.stringify(NaN) is `null`, which strict servers reject.
      expect(axios.post.mock.calls[0][1].temperature).toBe(0.7);
    });
  });

  describe('request timeout bound', () => {
    it('never passes an overflowing timeout to axios', async () => {
      // sendChatCompletion takes a raw `config`, bypassing
      // sanitizeCustomAIConfig — that is the path the request-time clamp
      // exists for. Without it the oversized delay reaches setTimeout/axios,
      // which clamp it to 1 ms and abort the request immediately.
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'llama3.2',
          temperature: 0.7,
          timeoutMs: 3000000000,
        },
      });

      expect(axios.post).toHaveBeenCalledTimes(1);
      const axiosOptions = axios.post.mock.calls[0][2] || {};
      expect(axiosOptions.timeout).toBe(MAX_TIMEOUT_MS);
      // Guard the premise: the raw value really would overflow.
      expect(3000000000).toBeGreaterThan(MAX_TIMEOUT_MS);
    });
  });

  describe('local-first request headers', () => {
    it('does not send attribution headers that break local CORS preflight', async () => {
      // Live finding (cycle 189): Ollama's preflight rejects `x-title`
      // (not in Access-Control-Allow-Headers), so the browser build could not
      // talk to a local OpenAI-compatible server at all. HTTP-Referer/X-Title
      // are OpenRouter attribution extras, optional and useless locally.
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'llama3.2',
          temperature: 0.7,
        },
      });

      const headers = axios.post.mock.calls[0][2].headers;
      expect(headers['X-Title']).toBeUndefined();
      expect(headers['HTTP-Referer']).toBeUndefined();
      // The essential header is still sent.
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('buildSystemPrompt', () => {
    it('uses the shared prompt without a role, and the role prompt with one', () => {
      const base = buildSystemPrompt({});
      expect(base).toContain('GDevelop AI Assistant');
      expect(base).not.toContain('the developer of a small game studio');

      const developer = buildSystemPrompt({ role: 'developer' });
      expect(developer).toContain('the developer of a small game studio');
      expect(developer).toContain('GDevelop AI Assistant');
    });

    it('falls back to the shared prompt for an unrecognized persisted role', () => {
      // `role` is read back from a persisted AiRequest and is not validated;
      // an unknown id must not throw while the turn's prompt is built.
      let prompt;
      expect(() => {
        prompt = buildSystemPrompt({ role: 'legacy-role' });
      }).not.toThrow();
      expect(prompt).toContain('GDevelop AI Assistant');
      expect(prompt).not.toContain('the developer of a small game studio');
    });

    it('appends the project structure, extensions and spawn context when given', () => {
      const prompt = buildSystemPrompt({
        gameProjectJson: '{"objects":[]}',
        projectSpecificExtensionsSummaryJson: '{"ext":1}',
        spawnContextNote: 'GDD note',
      });
      expect(prompt).toContain('Current Project Structure:');
      expect(prompt).toContain('{"objects":[]}');
      expect(prompt).toContain('Installed Project Extensions:');
      expect(prompt).toContain('GDD note');
    });
  });

  describe('getEffectiveConfigForRequest', () => {
    it('returns the global config, then the per-chat override, then back', () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });
      expect(getEffectiveConfigForRequest('local-ai-x').model).toBe(
        'qwen2.5-coder'
      );

      customSetAiRequestModelOverride('local-ai-x', 'deepseek-chat');
      expect(getEffectiveConfigForRequest('local-ai-x').model).toBe(
        'deepseek-chat'
      );
      // Another chat is unaffected.
      expect(getEffectiveConfigForRequest('local-ai-y').model).toBe(
        'qwen2.5-coder'
      );

      customSetAiRequestModelOverride('local-ai-x', '');
      expect(getEffectiveConfigForRequest('local-ai-x').model).toBe(
        'qwen2.5-coder'
      );
    });
  });

  describe('provider telemetry logging', () => {
    it('formats routing/proxy telemetry headers into one line', () => {
      expect(
        formatProviderTelemetry({
          'x-omniroute-model': 'deepseek-v4.1-flash',
          'x-omniroute-latency-ms': '3361',
          'x-omniroute-tokens-in': '8856',
          'x-omniroute-tokens-out': '90',
          'x-omniroute-cache': 'MISS',
        })
      ).toBe(
        'model=deepseek-v4.1-flash latencyMs=3361 tokens=8856in/90out cache=MISS'
      );
    });

    it('returns null when no telemetry headers are present', () => {
      expect(formatProviderTelemetry(undefined)).toBeNull();
      expect(formatProviderTelemetry(null)).toBeNull();
      expect(formatProviderTelemetry({})).toBeNull();
      expect(
        formatProviderTelemetry({ 'content-type': 'application/json' })
      ).toBeNull();
    });

    it('logs per-turn telemetry to the dev console when the provider sends it', async () => {
      const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      try {
        axios.post.mockResolvedValueOnce({
          status: 200,
          headers: {
            'x-omniroute-model': 'deepseek-v4.1-flash',
            'x-omniroute-latency-ms': '3361',
            'x-omniroute-tokens-in': '8856',
            'x-omniroute-tokens-out': '90',
          },
          data: {
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
          },
        });

        await sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: {
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'llama3.2',
            temperature: 0.7,
          },
        });

        expect(debugSpy).toHaveBeenCalledTimes(1);
        expect(debugSpy.mock.calls[0][0]).toContain('[BYOK]');
        expect(debugSpy.mock.calls[0][0]).toContain('latencyMs=3361');
        expect(debugSpy.mock.calls[0][0]).toContain('tokens=8856in/90out');
      } finally {
        debugSpy.mockRestore();
      }
    });

    it('stays quiet when the provider sends no telemetry headers', async () => {
      const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      try {
        axios.post.mockResolvedValueOnce({
          status: 200,
          data: {
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
          },
        });

        await sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: {
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'llama3.2',
            temperature: 0.7,
          },
        });

        expect(debugSpy).not.toHaveBeenCalled();
      } finally {
        debugSpy.mockRestore();
      }
    });

    it("clears a request's telemetry when it is deleted", async () => {
      // Every other per-request registry is cleared on delete; telemetry was
      // missed, so a deleted chat left its entry behind forever.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        headers: { 'x-omniroute-latency-ms': '55' },
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'telemetry cleanup',
        mode: 'chat',
      });
      expect(customGetAiRequestProviderTelemetry(created.id)).toEqual(
        expect.objectContaining({ latencyMs: 55 })
      );

      customDeleteAiRequest(created.id);
      expect(customGetAiRequestProviderTelemetry(created.id)).toBeNull();
    });

    it('parses telemetry into numbers and stores it per request', async () => {
      // The auditing data layer: the console line existed but nothing was
      // inspectable from React state. parseProviderTelemetry is stored against
      // the chat so a dashboard can read it.
      expect(
        parseProviderTelemetry({
          'x-omniroute-model': 'deepseek-v4.1-flash',
          'x-omniroute-latency-ms': '3361',
          'x-omniroute-tokens-in': '8856',
          'x-omniroute-tokens-out': '90',
          'x-omniroute-cache': 'MISS',
        })
      ).toEqual({
        model: 'deepseek-v4.1-flash',
        latencyMs: 3361,
        tokensIn: 8856,
        tokensOut: 90,
        cache: 'MISS',
      });
      expect(parseProviderTelemetry({})).toBeNull();
      // A non-numeric latency is dropped, not stored as NaN.
      expect(
        parseProviderTelemetry({ 'x-omniroute-latency-ms': 'soon' })
      ).toBeNull();

      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        headers: {
          'x-omniroute-model': 'llama3.2',
          'x-omniroute-latency-ms': '120',
          'x-omniroute-tokens-in': '30',
          'x-omniroute-tokens-out': '7',
        },
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const created = await customCreateAiRequest({
        userRequest: 'telemetry probe',
        mode: 'chat',
      });
      const stored = customGetAiRequestProviderTelemetry(created.id);
      expect(stored && stored.model).toBe('llama3.2');
      expect(stored && stored.latencyMs).toBe(120);
      expect(stored && stored.tokensIn).toBe(30);
      expect(typeof stored.at).toBe('string');
    });

    it('reads headers exposed through .get (fetch Headers are index-opaque)', () => {
      // fetch Headers expose nothing by index and AxiosHeaders.get is
      // case-insensitive while index access is not: reading `headers[name]`
      // saw no telemetry on either in production-shaped responses. The fake
      // below is index-opaque like a real fetch Headers (only .get reads).
      const store = {
        'x-omniroute-model': 'qwen2.5-coder',
        'x-omniroute-latency-ms': '812',
      };
      const headers = {
        get: (name: string): ?string => store[name.toLowerCase()] || null,
      };
      expect(formatProviderTelemetry(headers)).toBe(
        'model=qwen2.5-coder latencyMs=812'
      );
    });

    it('logs per-turn telemetry for streamed turns too', async () => {
      // The streaming path never logged: a session with streaming on (the
      // local-model default) emitted no per-turn observability at all.
      const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      const encoder = new TextEncoder();
      const body =
        'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) +
        '\n';
      const reader = {
        read: (() => {
          let done = false;
          return async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: encoder.encode(body) };
          };
        })(),
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        // Index-opaque like a real fetch Headers: only .get reads.
        headers: {
          get: (name: string): ?string =>
            ({
              'content-type': 'text/event-stream',
              'x-omniroute-latency-ms': '812',
              'x-omniroute-tokens-in': '120',
              'x-omniroute-tokens-out': '3',
            }[name.toLowerCase()] || null),
        },
        body: { getReader: () => reader },
      });
      try {
        await sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: {
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'qwen2.5-coder',
            temperature: 0.7,
            streaming: true,
          },
        });

        expect(debugSpy).toHaveBeenCalledTimes(1);
        expect(debugSpy.mock.calls[0][0]).toContain('[BYOK]');
        expect(debugSpy.mock.calls[0][0]).toContain('latencyMs=812');
        expect(debugSpy.mock.calls[0][0]).toContain('tokens=120in/3out');
      } finally {
        debugSpy.mockRestore();
      }
    });
  });

  describe('backend-only tools are withheld from local turns', () => {
    it('drops backend-resolved tools while keeping the rest', () => {
      const tools = withoutBackendOnlyTools(GDEVELOP_OPENAI_TOOLS);
      const names = tools.map(tool => tool.function.name);
      expect(names).not.toContain('get_game_starter_summary');
      // Everything else is still offered: the filter removes one entry.
      expect(names).toHaveLength(GDEVELOP_OPENAI_TOOLS.length - 1);
      expect(names).toContain('create_scene');
    });

    it('retries the first turn at a smaller budget on overflow', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message:
                "this model's maximum context length is 4096 tokens, however you requested 8000 tokens (the input is too large)",
            },
          },
        },
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const hugeProject = JSON.stringify({
        scenes: Array.from({ length: 800 }, (_, i) => ({
          name: 'Scene' + i,
          events: Array.from({ length: 20 }, () => ({ code: 'y'.repeat(150) })),
        })),
      });
      const created = await customCreateAiRequest({
        userRequest: 'start',
        gameProjectJson: hugeProject,
        mode: 'agent',
      });
      expect(created.status).not.toBe('error');
      expect(axios.post).toHaveBeenCalledTimes(2);
      const first = estimateMessagesTokens(
        axios.post.mock.calls[0][1].messages
      );
      const second = estimateMessagesTokens(
        axios.post.mock.calls[1][1].messages
      );
      expect(second).toBeLessThan(first);
    });

    it('records a sub-agent turn against the parent AND the child', async () => {
      // Cost is billed to the parent chat (the UI meter) and also to the
      // sub-agent's own id, so per-agent usage is auditable.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const child = await customCreateSubAgentAiRequest({
        parentAiRequestId: 'local-ai-parent-x',
        roleId: 'developer',
        userRequest: 'build it',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        spawnContextNote: null,
      });
      expect(customGetAiRequestTokenTotal(child.id)).toBeGreaterThan(0);
      expect(customGetAiRequestTokenTotal('local-ai-parent-x')).toBeGreaterThan(
        0
      );
    });

    it('retries a sub-agent turn at a smaller budget on overflow', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message:
                "this model's maximum context length is 4096 tokens, however you requested 8000 tokens (the input is too large)",
            },
          },
        },
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const hugeProject = JSON.stringify({
        scenes: Array.from({ length: 800 }, (_, i) => ({
          name: 'Scene' + i,
          events: Array.from({ length: 20 }, () => ({ code: 'y'.repeat(150) })),
        })),
      });
      const child = await customCreateSubAgentAiRequest({
        parentAiRequestId: 'local-ai-parent',
        roleId: 'developer',
        userRequest: 'build it',
        gameProjectJson: hugeProject,
        projectSpecificExtensionsSummaryJson: null,
        spawnContextNote: null,
      });
      expect(child.id).toBeTruthy();
      expect(axios.post).toHaveBeenCalledTimes(2);
      const first = estimateMessagesTokens(
        axios.post.mock.calls[0][1].messages
      );
      const second = estimateMessagesTokens(
        axios.post.mock.calls[1][1].messages
      );
      expect(second).toBeLessThan(first);
    });

    it('retries once when the endpoint is unreachable', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'seed',
        mode: 'chat',
      });
      axios.post.mockClear();

      // $FlowFixMe reject once with a transport error (an Error, as axios
      // rejects, so its code survives the client's non-Error normalization).
      const refused = new Error('connect ECONNREFUSED 127.0.0.1:11434');
      // $FlowFixMe
      refused.code = 'ECONNREFUSED';
      axios.post.mockRejectedValueOnce(refused);
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const result = await customAddMessageToAiRequest({
        aiRequestId: created.id,
        userMessage: 'next',
      });
      expect(result.status).not.toBe('error');
      expect(axios.post).toHaveBeenCalledTimes(2);

      // The predicate: transport-level only.
      expect(isNetworkLevelError({ code: 'ECONNREFUSED' })).toBe(true);
      expect(isNetworkLevelError({ message: 'Network Error' })).toBe(true);
      expect(isNetworkLevelError({ response: { status: 500 } })).toBe(false);
      expect(isNetworkLevelError(null)).toBe(false);
      expect(isNetworkLevelError({ message: 'shuffle failure' })).toBe(false);
    });

    it('retries a transient provider 503 and succeeds', async () => {
      // feedback-loop Run 6: a 503 ("endpoint unavailable") killed a developer
      // sub-agent's turn outright. A transient server error must be retried.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: { status: 503, data: { error: { message: 'unavailable' } } },
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const result = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });
      expect(result.status).not.toBe('error');
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('does not retry a real client error (400)', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockRejectedValue({
        response: { status: 400, data: { error: { message: 'bad request' } } },
      });
      const result = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });
      expect(result.status).toBe('error');
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('classifies which provider errors are retryable', () => {
      const providerError = (status: number) => {
        const error = new Error('provider');
        // $FlowFixMe: the client attaches the status for exactly this.
        (error: any).providerStatus = status;
        return error;
      };
      expect(getProviderErrorStatus(providerError(503))).toBe(503);
      expect(getProviderErrorStatus(new Error('x'))).toBeNull();
      expect(isRetryableProviderError(providerError(429))).toBe(true);
      expect(isRetryableProviderError(providerError(408))).toBe(true);
      expect(isRetryableProviderError(providerError(502))).toBe(true);
      expect(isRetryableProviderError(providerError(503))).toBe(true);
      expect(isRetryableProviderError(providerError(504))).toBe(true);
      // 500 is a genuine server error and is left to the caller (see the
      // existing "no 500 retry" behaviour), as are 4xx client errors.
      expect(isRetryableProviderError(providerError(500))).toBe(false);
      expect(isRetryableProviderError(providerError(400))).toBe(false);
      expect(isRetryableProviderError(providerError(401))).toBe(false);
      expect(isRetryableProviderError(new Error('network'))).toBe(false);
    });

    it('retries once with a smaller prompt when the window overflows', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // Seed a long history: old messages are what a tighter trim can drop.
      // The newest message is protected, so it must not be the overflow
      // source.
      const messages = [];
      for (let i = 0; i < 80; i++) {
        messages.push({
          type: 'message',
          status: 'completed',
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [
            i % 2 === 0
              ? {
                  type: 'user_request',
                  status: 'completed',
                  text: `turn ${i} ` + 'x'.repeat(200),
                }
              : {
                  type: 'output_text',
                  status: 'completed',
                  text: 'ok ' + 'y'.repeat(200),
                  annotations: [],
                },
          ],
          messageId: `m-${i}`,
        });
      }
      customUpdateAiRequest(
        ({
          id: 'local-ai-overflow',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          userId: LOCAL_BYOK_USER_ID,
          status: 'ready',
          error: null,
          output: messages,
        }: any)
      );

      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message:
                "this model's maximum context length is 4096 tokens, however you requested 9000 tokens (the input is too large)",
            },
          },
        },
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const result = await customAddMessageToAiRequest({
        aiRequestId: 'local-ai-overflow',
        userMessage: 'next',
      });

      expect(result.status).not.toBe('error');
      expect(axios.post).toHaveBeenCalledTimes(2);
      const first = estimateMessagesTokens(
        axios.post.mock.calls[0][1].messages
      );
      const second = estimateMessagesTokens(
        axios.post.mock.calls[1][1].messages
      );
      expect(second).toBeLessThan(first);
      expect(second).toBeLessThanOrEqual(2048 + 64);
    });

    it('does not retry a non-overflow provider error', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 500,
          data: { error: { message: 'internal shuffle failure' } },
        },
      });
      const result = await customAddMessageToAiRequest({
        aiRequestId: 'local-ai-no-retry',
        userMessage: 'next',
      });
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('error');
      expect(
        isContextOverflowError({
          response: { data: { error: { message: 'maximum context length' } } },
        })
      ).toBe(true);
      expect(
        isContextOverflowError({
          response: { data: { error: { message: 'nope' } } },
        })
      ).toBe(false);
      expect(isContextOverflowError(null)).toBe(false);
    });

    it('does not offer backend-only tools on later local turns or sub-agents', async () => {
      // The create path had a test (cycle 169) but the continue and sub-agent
      // paths were only covered by the pure filter - a regression that dropped
      // the filter there would silently re-offer the always-failing tool.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });
      axios.post.mockClear();
      await customAddMessageToAiRequest({
        aiRequestId: created.id,
        userMessage: 'next',
      });
      const continueTools = axios.post.mock.calls[0][1].tools.map(
        (tool: any) => tool.function.name
      );
      expect(continueTools).not.toContain('get_game_starter_summary');
      expect(continueTools).toContain('create_scene');

      axios.post.mockClear();
      await customCreateSubAgentAiRequest({
        parentAiRequestId: created.id,
        roleId: 'developer',
        userRequest: 'build it',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        spawnContextNote: null,
      });
      const subAgentTools = axios.post.mock.calls[0][1].tools.map(
        (tool: any) => tool.function.name
      );
      expect(subAgentTools).not.toContain('get_game_starter_summary');
    });

    it('restricts a top-level orchestrator request to the manager role', async () => {
      // feedback-loop Run 5: the top-level orchestrator got no role prompt and
      // every tool, so the "manager" built the scene itself instead of
      // delegating. It must run with the manager prompt and tool subset.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'build the city',
        mode: 'orchestrator',
      });
      const createTools = axios.post.mock.calls[0][1].tools.map(
        (tool: any) => tool.function.name
      );
      expect(createTools).toContain('create_or_update_plan');
      expect(createTools).toContain('spawn_agent');
      expect(createTools).not.toContain('create_scene');
      expect(createTools).not.toContain('create_or_replace_object');
      const createSystemPrompt = axios.post.mock.calls[0][1].messages.find(
        (message: any) => message.role === 'system'
      ).content;
      expect(createSystemPrompt).toContain('studio lead');

      axios.post.mockClear();
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      await customAddMessageToAiRequest({
        aiRequestId: created.id,
        userMessage: 'go',
      });
      const continueTools = axios.post.mock.calls[0][1].tools.map(
        (tool: any) => tool.function.name
      );
      expect(continueTools).toContain('spawn_agent');
      expect(continueTools).not.toContain('create_scene');
    });

    it('names only declared tools in the backend-only allowlist', () => {
      // This is an ALLOWLIST: a typo here silently stops filtering the tool
      // (or filters nothing), so every member must be a declared registry name.
      const declared = new Set(
        GDEVELOP_OPENAI_TOOLS.map(tool => tool.function.name)
      );
      expect(BACKEND_ONLY_TOOL_NAMES).toContain('get_game_starter_summary');
      const unknown = BACKEND_ONLY_TOOL_NAMES.filter(
        name => !declared.has(name)
      );
      expect(unknown).toEqual([]);
    });

    it('does not offer get_game_starter_summary on a local create', async () => {
      // Its local launchFunction unconditionally fails ("handled on the
      // backend"), so offering it burns a turn and its tokens for nothing.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        },
      });

      await customCreateAiRequest({
        userRequest: 'study a starter',
        mode: 'chat',
      });

      const sentTools = axios.post.mock.calls[0][1].tools.map(
        (tool: any) => tool.function.name
      );
      expect(sentTools).not.toContain('get_game_starter_summary');
      expect(sentTools).toContain('create_scene');
    });
  });

  describe('create path context budget', () => {
    it('sends a budgeted system prompt when the project structure alone exceeds the model budget', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      const hugeProject = JSON.stringify({
        scenes: Array.from({ length: 800 }, (_, i) => ({
          name: 'Scene' + i,
          events: Array.from({ length: 20 }, (_, j) => ({
            type: 'Event' + j,
            code: 'y'.repeat(150),
          })),
        })),
      });
      expect(estimateTokens(hugeProject)).toBeGreaterThan(4096);

      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const created = await customCreateAiRequest({
        userRequest: 'start',
        gameProjectJson: hugeProject,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
      });
      expect(created.status).toBe('ready');

      expect(axios.post).toHaveBeenCalledTimes(1);
      const body = axios.post.mock.calls[0][1];
      const systemMessage = (body.messages || []).find(
        m => m.role === 'system'
      );
      expect(systemMessage).toBeTruthy();
      expect(systemMessage.content).toContain('You are GDevelop AI Assistant');
      expect(systemMessage.content).toContain(
        'truncated to fit the model context window'
      );
      // llama3.2 budget = 4096; leave exchange reserve inside compaction.
      expect(estimateMessagesTokens(body.messages)).toBeLessThanOrEqual(4096);
      // The structure was compacted: surface that to the chat UI.
      expect(customGetAiRequestSystemCompacted(created.id)).toBe(true);
    });
  });

  describe('system structure compaction surfacing', () => {
    it('leaves the flag false when the system prompt already fits the budget', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
      });
      expect(created.status).toBe('ready');
      expect(customGetAiRequestSystemCompacted(created.id)).toBe(false);

      const body = axios.post.mock.calls[0][1];
      const systemMessage = (body.messages || []).find(
        m => m.role === 'system'
      );
      expect(systemMessage.content).not.toContain(
        'truncated to fit the model context window'
      );
    });

    it('records compaction against the request and clears on reset and delete', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      const hugeProject = JSON.stringify({
        scenes: Array.from({ length: 800 }, (_, i) => ({
          name: 'Scene' + i,
          events: Array.from({ length: 20 }, (_, j) => ({
            type: 'Event' + j,
            code: 'y'.repeat(150),
          })),
        })),
      });
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start',
        gameProjectJson: hugeProject,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
      });
      expect(customGetAiRequestSystemCompacted(created.id)).toBe(true);

      customDeleteAiRequest(created.id);
      expect(customGetAiRequestSystemCompacted(created.id)).toBe(false);

      // Recreate with a compact system and confirm reset still clears.
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const small = await customCreateAiRequest({
        userRequest: 'start',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
      });
      expect(customGetAiRequestSystemCompacted(small.id)).toBe(false);
      _resetCustomAiClientForTesting();
      expect(customGetAiRequestSystemCompacted(small.id)).toBe(false);
    });

    it('flags system compaction on a later addMessage turn when the structure grows', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
      });
      expect(customGetAiRequestSystemCompacted(created.id)).toBe(false);

      // History-trim path does not change the system prompt → flag stays false.
      const bigRequest = 'x'.repeat(100000);
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'done' } }],
        },
      });
      await customAddMessageToAiRequest({
        aiRequestId: created.id,
        userMessage: bigRequest,
      });
      expect(customGetAiRequestContextTrimCount(created.id)).toBeGreaterThan(0);
      expect(customGetAiRequestSystemCompacted(created.id)).toBe(false);
    });
  });

  describe('context trim count surfacing', () => {
    it('records trims against the parent chat and resets on reset', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'orchestrate',
      });

      // Build enough history that trimming has something to drop: a huge
      // user turn (~25k estimated tokens) answered by the model.
      const bigRequest = 'x'.repeat(100000);
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'done' } }],
        },
      });
      await customAddMessageToAiRequest({
        aiRequestId: created.id,
        userMessage: bigRequest,
      });

      // Now the next turn replays that huge history: it must be trimmed.
      axios.post.mockImplementationOnce(
        (url, body, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new Error('canceled'))
            );
          })
      );
      const pending = customAddMessageToAiRequest({
        aiRequestId: created.id,
        userMessage: 'continue',
      });
      await new Promise(r => setTimeout(r, 50));
      customSuspendAiRequest(created.id);
      // The chat-turn path absorbs a user-initiated stop: it resolves with
      // the suspended request instead of rejecting.
      const stopped = await pending;
      expect(stopped.status).toBe('suspended');

      expect(customGetAiRequestContextTrimCount(created.id)).toBeGreaterThan(0);
      expect(customGetAiRequestTokenTotal(created.id)).toBeGreaterThan(0);
      _resetCustomAiClientForTesting();
      expect(customGetAiRequestContextTrimCount(created.id)).toBe(0);
      expect(customGetAiRequestTokenTotal(created.id)).toBe(0);
    });
  });

  describe('cancelable local create', () => {
    const waitFor = condition => {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          if (condition()) return resolve();
          if (Date.now() - started > 2000)
            return reject(new Error('Condition not met in time'));
          setTimeout(check, 10);
        };
        check();
      });
    };

    it('aborts a hung create and returns status suspended with no error', async () => {
      axios.post.mockImplementationOnce(
        (url, body, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new Error('canceled'))
            );
          })
      );
      const pending = customCreateAiRequest({
        userRequest: 'hang forever',
      });
      await waitFor(() => axios.post.mock.calls.length >= 1);
      expect(customHasPendingCreateAiRequest()).toBe(true);

      customAbortPendingCreateAiRequests();
      const result = await pending;
      expect(result.status).toBe('suspended');
      expect(result.error).toBe(null);
      expect(customHasPendingCreateAiRequest()).toBe(false);
    });

    it('cancels on entry when Stop is pressed before create registers', async () => {
      // No in-flight create: Stop arms the next create to cancel on entry.
      customAbortPendingCreateAiRequests();
      expect(customHasPendingCreateAiRequest()).toBe(true);

      const cancelled = await customCreateAiRequest({
        userRequest: 'never sent',
      });
      expect(cancelled.status).toBe('suspended');
      expect(cancelled.error).toBe(null);
      expect(axios.post).not.toHaveBeenCalled();
      expect(customHasPendingCreateAiRequest()).toBe(false);
    });

    it('abort with no pending is a no-op for an already-finished create', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({ userRequest: 'quick' });
      expect(created.status).toBe('ready');
      expect(customHasPendingCreateAiRequest()).toBe(false);
      // Arms the early-cancel flag only (no live create to abort).
      customAbortPendingCreateAiRequests();
      expect(customHasPendingCreateAiRequest()).toBe(true);
      _resetCustomAiClientForTesting();
      expect(customHasPendingCreateAiRequest()).toBe(false);
    });
  });

  describe('local-server error hints', () => {
    const minimalConfig = {
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      temperature: 0.7,
    };

    it('hints at VRAM pressure on out-of-memory 500s', async () => {
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 500,
          data: {
            error: {
              message: 'model requires more system memory than is available',
            },
          },
        },
      });

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: minimalConfig,
        })
      ).rejects.toThrow(/GPU\/VRAM/);
    });

    it('hints at context overflow, not VRAM, when the message says both', async () => {
      // Local servers phrase context overflow with words the VRAM pattern also
      // matches ("too large"). The context hint must win, or the user is told
      // to shrink their quantization/VRAM for what is actually a full window.
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: {
              message:
                "this model's maximum context length is 4096 tokens, however you requested 5000 tokens (you requested 5000; the input is too large)",
            },
          },
        },
      });

      const err = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: minimalConfig,
      }).catch(e => e);
      expect(err.message).toMatch(/context window/);
      expect(err.message).not.toMatch(/GPU\/VRAM/);
    });

    it('hints at context overflow for a bare length-exceeded message', async () => {
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            error: { message: 'the input length exceeds the context length' },
          },
        },
      });

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: minimalConfig,
        })
      ).rejects.toThrow(/context window/);
    });

    it('hints at server reachability on connection refused', async () => {
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:11434',
      });

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: minimalConfig,
        })
      ).rejects.toThrow(/make sure the local AI server is running/);
    });

    it('hints at rate limiting on a 429', async () => {
      // The objective names 429 explicitly: the message must stay an AI
      // Provider Error but add what to do about it.
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 429,
          data: { error: { message: 'Too Many Requests' } },
        },
      });

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: minimalConfig,
        })
      ).rejects.toThrow(
        /^AI Provider Error \(429\): Too Many Requests .*rate/i
      );
    });

    it('hints at a temporary provider outage on 502/503', async () => {
      for (const status of [502, 503]) {
        // $FlowFixMe
        axios.post.mockRejectedValueOnce({
          response: {
            status,
            data: { error: { message: 'upstream unavailable' } },
          },
        });
        await expect(
          sendChatCompletion({
            messages: [{ role: 'user', content: 'hi' }],
            config: minimalConfig,
          })
        ).rejects.toThrow(/temporarily unavailable|bad gateway/i);
      }
    });

    it('leaves unmatched provider errors untouched', async () => {
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 500,
          data: { error: { message: 'internal shuffle failure' } },
        },
      });

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: minimalConfig,
        })
      ).rejects.toThrow(
        /^AI Provider Error \(500\): internal shuffle failure$/
      );
    });
  });

  describe('SSE streaming', () => {
    const streamConfig = {
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      temperature: 0.7,
      streaming: true,
    };
    const sseBody = [
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { role: 'assistant', content: 'Hel' } }],
        }) +
        '\n',
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }) +
        '\n',
      'data: ' +
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'c1',
                    function: { name: 'create_', arguments: '{"scene_name' },
                  },
                ],
              },
            },
          ],
        }) +
        '\n',
      'data: ' +
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '":"Menu"}' } },
                ],
              },
            },
          ],
        }) +
        '\n',
      'data: ' +
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        }) +
        '\n',
      'data: [DONE]\n',
    ].join('');
    const mockStreamResponse = body => {
      const encoder = new TextEncoder();
      // Node's jest env has no ReadableStream global: a minimal reader mock.
      const reader = {
        read: (() => {
          let done = false;
          return async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: encoder.encode(body) };
          };
        })(),
      };
      return { ok: true, status: 200, body: { getReader: () => reader } };
    };
    beforeEach(() => {
      _resetForStreamTests();
    });

    it('does not corrupt arguments when a chunk sends them as an object', async () => {
      // Streaming fragments are strings by spec, but a proxy may send a whole
      // object on one chunk; the old `arguments || ''` kept the object and a
      // later string fragment then concatenated as '[object Object]...'.
      const sse =
        'data: ' +
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'c1',
                    function: {
                      name: 'create_scene',
                      arguments: { scene_name: 'Town' },
                    },
                  },
                ],
              },
            },
          ],
        }) +
        '\n' +
        'data: ' +
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        }) +
        '\n' +
        'data: [DONE]\n';
      global.fetch = jest.fn().mockResolvedValue(mockStreamResponse(sse));

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.tool_calls).toHaveLength(1);
      const args = message.tool_calls[0].function.arguments;
      expect(args).not.toContain('[object Object]');
      expect(JSON.parse(args)).toEqual({ scene_name: 'Town' });
    });

    it('reports reasoning as streaming progress before any answer token', async () => {
      // Live finding (Ollama, deepseek-v4.1-flash): a reasoning model streams
      // many `delta.reasoning` chunks before the first `delta.content`, so the
      // partial-content signal stayed empty and the chat's cold-start hint
      // claimed it was still waiting for the first token while bytes arrived.
      const sse =
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { reasoning: 'Let me think' } }],
        }) +
        '\n' +
        'data: ' +
        JSON.stringify({ choices: [{ delta: { reasoning: ' about it' } }] }) +
        '\n' +
        'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'Done' } }] }) +
        '\n' +
        'data: [DONE]\n';
      global.fetch = jest.fn().mockResolvedValue(mockStreamResponse(sse));
      const deltas = [];

      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
        onStreamDelta: partial => deltas.push(partial),
      });

      // The first progress report is non-empty (the reasoning), not ''.
      expect(deltas[0]).toBeTruthy();
      expect(deltas[0]).toContain('Let me think');
      // Once the answer arrives it takes over.
      expect(deltas[deltas.length - 1]).toBe('Done');
    });

    it('assembles content and tool calls from SSE chunks', async () => {
      global.fetch = jest.fn().mockResolvedValue(mockStreamResponse(sseBody));

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.content).toBe('Hello');
      expect(message.tool_calls).toHaveLength(1);
      expect(message.tool_calls[0].function.name).toBe('create_');
      expect(message.tool_calls[0].function.arguments).toBe(
        '{"scene_name":"Menu"}'
      );
      const fetchArgs = global.fetch.mock.calls[0];
      expect(JSON.parse(fetchArgs[1].body).stream).toBe(true);
    });

    it('does not merge a second tool call that omits index', async () => {
      const sse = [
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: 'a',
                      function: { name: 'one', arguments: '{"x":1}' },
                    },
                  ],
                },
              },
            ],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: 'b',
                      function: { name: 'two', arguments: '{"y":2}' },
                    },
                  ],
                },
              },
            ],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          }) +
          '\n',
        'data: [DONE]\n',
      ].join('');
      global.fetch = jest.fn().mockResolvedValue(mockStreamResponse(sse));

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.tool_calls).toHaveLength(2);
      expect(message.tool_calls[0].function.name).toBe('one');
      expect(message.tool_calls[1].function.name).toBe('two');
      expect(message.tool_calls[0].id).toBe('a');
      expect(message.tool_calls[1].id).toBe('b');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('continues argument-only fragments without index on the open call', async () => {
      const sse = [
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { id: 'c1', function: { name: 'cre', arguments: '' } },
                  ],
                },
              },
            ],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [{ function: { name: 'ate_x' } }],
                },
              },
            ],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [{ function: { arguments: '({"a":1})' } }],
                },
              },
            ],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          }) +
          '\n',
        'data: [DONE]\n',
      ].join('');
      global.fetch = jest.fn().mockResolvedValue(mockStreamResponse(sse));

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.tool_calls).toHaveLength(1);
      expect(message.tool_calls[0].function.name).toBe('create_x');
      expect(message.tool_calls[0].function.arguments).toBe('({"a":1})');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('skips malformed chunks and empty streams fail loudly', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          mockStreamResponse(
            'data: {broken json\n' +
              'data: {"choices":[{"delta":{"content":"ok"}}]}\n' +
              'data: [DONE]\n'
          )
        );
      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });
      expect(message.content).toBe('ok');

      // An empty stream falls back to the non-streaming request (by design):
      global.fetch = jest.fn().mockResolvedValue(mockStreamResponse(''));
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'recovered' } }],
        },
      });
      const recovered = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });
      expect(recovered.content).toBe('recovered');
    });

    it('falls back to a non-streaming request when streaming fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        Object.assign(new TypeError('fetch failed'), {
          isStreamUnsupported: false,
        })
      );
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'fallback' } }],
        },
      });

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });
      expect(message.content).toBe('fallback');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('does not retry non-streaming after a user abort mid-stream', async () => {
      const controller = new AbortController();
      // Stream fails because the user aborted mid-request.
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('AI request was aborted.'));
      const pending = sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
        signal: controller.signal,
      });
      controller.abort();

      await expect(pending).rejects.toThrow(/aborted/);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('recovers when the connection drops after partial content', async () => {
      const encoder = new TextEncoder();
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return {
                  done: false,
                  value: encoder.encode(
                    'data: ' +
                      JSON.stringify({
                        choices: [{ delta: { content: 'partial ' } }],
                      }) +
                      '\n'
                  ),
                };
              }
              // Second read: connection split mid-stream.
              throw new TypeError('network error');
            },
          }),
        },
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            { message: { role: 'assistant', content: 'recovered full' } },
          ],
        },
      });

      const deltas = [];
      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
        onStreamDelta: partial => deltas.push(partial),
      });

      expect(deltas).toContain('partial ');
      expect(message.content).toBe('recovered full');
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('does not start a second non-streaming request after a stream timeout', async () => {
      // fetch aborts with AbortError (as when the stream timeout controller fires).
      global.fetch = jest.fn().mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          })
      );

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: { ...streamConfig, timeoutMs: 5 },
        })
      ).rejects.toThrow(/timed out or was aborted after 5 ms/);
      // Critical: no silent second wait of timeoutMs on the non-streaming path.
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('aborts a stalled stream and never retries it non-streaming', async () => {
      // A server that accepts the request but never sends a byte (Ollama model
      // load stall / VRAM swap / silently dropped connection). The reader
      // rejects when the watchdog aborts, exactly like a real fetch body.
      global.fetch = (jest.fn(): any).mockImplementation((url, options) => ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                  const err = new Error('The operation was aborted.');
                  err.name = 'AbortError';
                  reject(err);
                });
              }),
          }),
        },
      }));

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: { ...streamConfig, timeoutMs: 20 },
        })
      ).rejects.toThrow(/stream stalled: no data received for 20 ms/);
      // Retrying non-streaming would hang another full timeout on the same
      // unresponsive server.
      // $FlowFixMe[method-unbinding] jest matcher on a typed axios instance.
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('does not kill a slow stream that keeps producing chunks past the timeout', async () => {
      const encoder = new TextEncoder();
      const chunk = (content: string) =>
        'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n';
      // Each chunk is delivered after ~0.53 * timeoutMs, so the total response
      // (4 gaps) is more than twice the timeout while no single gap reaches
      // it. The watchdog must measure idleness between chunks, not wall-clock
      // response duration (the pre-fix code had no deadline at all after the
      // headers arrived).
      const sleepOrAbort = (ms: number, signal: any) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, ms);
          if (!signal) return;
          const onAbort = () => {
            clearTimeout(timer);
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
      let readCount = 0;
      global.fetch = (jest.fn(): any).mockImplementation((url, options) => ({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(chunk('a')) };
              }
              if (readCount <= 4) {
                await sleepOrAbort(80, options.signal);
                return {
                  done: false,
                  value: encoder.encode(chunk(String(readCount))),
                };
              }
              if (readCount === 5) {
                return {
                  done: false,
                  value: encoder.encode(
                    'data: ' +
                      JSON.stringify({
                        choices: [{ delta: {}, finish_reason: 'stop' }],
                      }) +
                      '\n' +
                      'data: [DONE]\n'
                  ),
                };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      }));

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: { ...streamConfig, timeoutMs: 150 },
      });

      expect(message.content).toBe('a234');
      // $FlowFixMe[method-unbinding] jest matcher on a typed axios instance.
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('processes a final data line that has no trailing newline', async () => {
      const encoder = new TextEncoder();
      // One complete SSE line WITHOUT a trailing newline (connection close).
      const payload =
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'tail' }, finish_reason: 'stop' }],
        });
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(payload) };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      });

      const deltas = [];
      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
        onStreamDelta: partial => deltas.push(partial),
      });

      expect(message.content).toBe('tail');
      expect(deltas).toContain('tail');
      // No fallback: the leftover line was enough to complete the stream.
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('does not lose a partial line that arrives only on the final read before done', async () => {
      const encoder = new TextEncoder();
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                // First read delivers complete lines with newlines.
                return {
                  done: false,
                  value: encoder.encode(
                    'data: ' +
                      JSON.stringify({
                        choices: [{ delta: { content: 'ab' } }],
                      }) +
                      '\n\n'
                  ),
                };
              }
              // Second read: final chunk without trailing newline, then done on next call.
              if (readCount === 2) {
                return {
                  done: false,
                  value: encoder.encode(
                    'data: ' +
                      JSON.stringify({
                        choices: [
                          { delta: { content: 'cd' }, finish_reason: 'stop' },
                        ],
                      })
                  ),
                };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      });

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.content).toBe('abcd');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('uses a JSON body when the server ignores stream:true', async () => {
      // A proxy that ignores `stream: true` answers with an ordinary
      // completion. Reading it as SSE finds no data: lines, so the turn looked
      // empty and was retried without streaming — a second full wait for an
      // answer that had already arrived.
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: name =>
            name.toLowerCase() === 'content-type'
              ? 'application/json; charset=utf-8'
              : null,
        },
        text: async () =>
          JSON.stringify({
            choices: [
              { message: { role: 'assistant', content: 'direct json' } },
            ],
          }),
      });

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.content).toBe('direct json');
      // No retry: the body already held the answer.
      // $FlowFixMe[method-unbinding] jest matcher on a typed axios instance.
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('still reads a real event stream', async () => {
      // Guard the detection itself: a correct SSE response must keep taking
      // the streaming path even though it now inspects the content type.
      const encoder = new TextEncoder();
      const sse =
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'via sse' }, finish_reason: 'stop' }],
        }) +
        '\n';
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: name =>
            name.toLowerCase() === 'content-type' ? 'text/event-stream' : null,
        },
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(sse) };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      });

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.content).toBe('via sse');
    });

    it('falls back to a non-streaming request when the body is neither SSE nor JSON', async () => {
      // A proxy error page (HTML) is a stream failure like any other: the
      // stream path reports it and the normal single non-streaming retry
      // still runs, which is what recovers the turn when only streaming is
      // broken.
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: name =>
            name.toLowerCase() === 'content-type' ? 'text/html' : null,
        },
        text: async () => '<html>proxy error</html>',
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'recovered' } }],
        },
      });

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.content).toBe('recovered');
      // $FlowFixMe[method-unbinding] jest matcher on a typed axios instance.
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('blames the output budget, not the network, when reasoning was truncated', async () => {
      const encoder = new TextEncoder();
      const sse = [
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { reasoning_content: 'thinking...' } }],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'length' }],
          }) +
          '\n',
        'data: [DONE]\n',
      ].join('');
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(sse) };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      });

      // Capture the message once: the fetch mock yields a single stream.
      let thrownMessage = '';
      try {
        await sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: streamConfig,
        });
      } catch (error) {
        thrownMessage = error.message;
      }
      expect(thrownMessage).toMatch(/output tokens/);
      // The misleading network diagnosis must be gone.
      expect(thrownMessage).not.toMatch(/dropped mid-stream/);
      // And no non-streaming retry: the same budget applies there, so the
      // user must not wait a second full timeout for an identical failure.
      // $FlowFixMe[method-unbinding] jest matcher on a typed axios instance.
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('carries streamed reasoning_content into the assembled message', async () => {
      // Reasoning models (DeepSeek-R1, qwq, Ollama reasoning builds) stream
      // their chain of thought on `reasoning_content`. The non-streaming path
      // reads that field in parseAssistantMessage; the stream must produce the
      // same shape or streaming silently drops the thinking.
      const encoder = new TextEncoder();
      const sse = [
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { reasoning_content: 'Let me think. ' } }],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { reasoning_content: 'Use a sprite.' } }],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({
            choices: [{ delta: { content: 'Here is the answer.' } }],
          }) +
          '\n',
        'data: ' +
          JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
          '\n',
        'data: [DONE]\n',
      ].join('');
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(sse) };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      });

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.content).toBe('Here is the answer.');
      expect(message.reasoning_content).toBe('Let me think. Use a sprite.');
    });

    it('omits reasoning_content when the model streams none', async () => {
      const encoder = new TextEncoder();
      const sse =
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'plain' }, finish_reason: 'stop' }],
        }) +
        '\n';
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(sse) };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      });

      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: streamConfig,
      });

      expect(message.content).toBe('plain');
      expect(message.reasoning_content).toBeUndefined();
    });
  });

  describe('per-request model override', () => {
    it('sends the overridden model for the request turns', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start a chat',
      });

      customSetAiRequestModelOverride(created.id, 'deepseek-chat');
      expect(customGetAiRequestModelOverride(created.id)).toBe('deepseek-chat');

      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      await customAddMessageToAiRequest({
        aiRequestId: created.id,
        userMessage: 'continue',
      });

      const requestPayload = axios.post.mock.calls[1][1];
      expect(requestPayload.model).toBe('deepseek-chat');

      // Empty string clears the override: back to the global model.
      customSetAiRequestModelOverride(created.id, '');
      expect(customGetAiRequestModelOverride(created.id)).toBe('');
    });

    it('sub-agents inherit the parent chat model override', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const parent = await customCreateAiRequest({
        userRequest: 'orchestrate',
      });
      customSetAiRequestModelOverride(parent.id, 'llama3.2');

      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      await customCreateSubAgentAiRequest({
        parentAiRequestId: parent.id,
        roleId: 'developer',
        userRequest: 'do the work',
      });

      const requestPayload = axios.post.mock.calls[1][1];
      expect(requestPayload.model).toBe('llama3.2');
    });

    it('keeps the global model when no override is set', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start a chat',
      });
      expect(customGetAiRequestModelOverride(created.id)).toBe('');
      const requestPayload = axios.post.mock.calls[0][1];
      expect(requestPayload.model).toBe('qwen2.5-coder');
    });

    it('sends the overridden model for next-step suggestions', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start a chat',
      });
      customSetAiRequestModelOverride(created.id, 'deepseek-chat');

      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  explanationMessage: 'Next:',
                  suggestions: [{ title: 'Go', suggestedMessage: 'Do it' }],
                }),
              },
            },
          ],
        },
      });
      await customGetAiRequestSuggestions(created.id);

      const requestPayload = axios.post.mock.calls[1][1];
      expect(requestPayload.model).toBe('deepseek-chat');
    });

    it('sends the overridden model for related event generation', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'chat before generate',
      });
      customSetAiRequestModelOverride(created.id, 'llama3.2');

      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n[{"type":"add_events","events":[{"type":"BuiltinCommonInstructions::Standard","conditions":[],"actions":[]}]}]\n```',
              },
            },
          ],
        },
      });
      await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Move player',
        eventBatches: null,
        extensionNamesList: '',
        objectsList: 'Player',
        existingEventsAsText: '',
        aiRequestId: created.id,
      });

      const requestPayload = axios.post.mock.calls[1][1];
      expect(requestPayload.model).toBe('llama3.2');
      customSetAiRequestModelOverride(created.id, '');
    });
  });

  describe('per-chat model choice survives a reload', () => {
    const memoryStorage = {};
    const fakeStorage = {
      getItem: key => (key in memoryStorage ? memoryStorage[key] : null),
      setItem: (key, value) => {
        memoryStorage[key] = String(value);
      },
      removeItem: key => {
        delete memoryStorage[key];
      },
    };
    beforeEach(() => {
      Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]);
      global.localStorage = fakeStorage;
      _resetCustomAiClientForTesting();
    });
    afterEach(() => {
      delete global.localStorage;
    });

    it('reloads the override that was set in a previous session', () => {
      // The override lives outside the AiRequest record, so a reload used to
      // revert the chat to the global model — often a different, sometimes
      // unavailable model, in a BYOK setup.
      customSetAiRequestModelOverride('local-ai-1', 'deepseek-r1:14b');
      expect(
        JSON.parse(memoryStorage['gd-custom-ai-model-overrides'])['local-ai-1']
      ).toBe('deepseek-r1:14b');

      // Simulate a fresh session: drop in-memory state, then re-read.
      _resetCustomAiClientForTesting();
      expect(customGetAiRequestModelOverride('local-ai-1')).toBe('');
      loadLocalAiRequests();
      loadLocalAiRequestModelOverridesForTesting();
      expect(customGetAiRequestModelOverride('local-ai-1')).toBe(
        'deepseek-r1:14b'
      );
    });

    it('clears the stored override when the model is reset to empty', () => {
      customSetAiRequestModelOverride('local-ai-2', 'qwen2.5-coder');
      customSetAiRequestModelOverride('local-ai-2', '');
      const persisted = JSON.parse(
        memoryStorage['gd-custom-ai-model-overrides']
      );
      expect(persisted['local-ai-2']).toBeUndefined();
    });

    it('ignores a corrupt override payload without throwing', () => {
      memoryStorage['gd-custom-ai-model-overrides'] = '{not json';
      expect(() => loadLocalAiRequestModelOverridesForTesting()).not.toThrow();
      expect(customGetAiRequestModelOverride('local-ai-3')).toBe('');
      // A non-string value must not become a model name.
      memoryStorage['gd-custom-ai-model-overrides'] = JSON.stringify({
        'local-ai-4': 42,
        'local-ai-5': '   ',
        'local-ai-6': 'ok',
      });
      loadLocalAiRequestModelOverridesForTesting();
      expect(customGetAiRequestModelOverride('local-ai-4')).toBe('');
      expect(customGetAiRequestModelOverride('local-ai-5')).toBe('');
      expect(customGetAiRequestModelOverride('local-ai-6')).toBe('ok');
    });
  });

  describe('per-agent token totals survive a reload', () => {
    const memoryStorage = {};
    const fakeStorage = {
      getItem: key => (key in memoryStorage ? memoryStorage[key] : null),
      setItem: (key, value) => {
        memoryStorage[key] = String(value);
      },
      removeItem: key => {
        delete memoryStorage[key];
      },
    };
    beforeEach(() => {
      Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]);
      global.localStorage = fakeStorage;
      _resetCustomAiClientForTesting();
    });
    afterEach(() => {
      delete global.localStorage;
    });

    it('persists a sub-agent total and reloads it in a fresh session', () => {
      // Sub-agent meters were in-memory only, so the per-agent audit dashboard
      // lost every figure (children included) on the next page load.
      recordLocalAiRequestTokenUsageForTesting('sub-1', 100, 50);
      expect(
        JSON.parse(memoryStorage['gd-custom-ai-token-totals'])['sub-1']
      ).toBe(150);

      // Simulate a fresh session: drop in-memory state, then re-read.
      _resetCustomAiClientForTesting();
      expect(customGetAiRequestTokenTotal('sub-1')).toBe(0);
      loadLocalAiRequestTokenTotalsForTesting();
      expect(customGetAiRequestTokenTotal('sub-1')).toBe(150);
    });

    it('accumulates across turns before persisting', () => {
      recordLocalAiRequestTokenUsageForTesting('sub-2', 10, 5);
      recordLocalAiRequestTokenUsageForTesting('sub-2', 20, 15);
      expect(customGetAiRequestTokenTotal('sub-2')).toBe(50);
      expect(
        JSON.parse(memoryStorage['gd-custom-ai-token-totals'])['sub-2']
      ).toBe(50);
    });

    it('ignores a corrupt payload and non-finite / negative values', () => {
      memoryStorage['gd-custom-ai-token-totals'] = '{not json';
      expect(() => loadLocalAiRequestTokenTotalsForTesting()).not.toThrow();
      expect(customGetAiRequestTokenTotal('local-ai-x')).toBe(0);

      memoryStorage['gd-custom-ai-token-totals'] = JSON.stringify({
        'local-ai-neg': -5,
        'local-ai-str': '42',
        'local-ai-null': null,
        'local-ai-bool': true,
        'local-ai-ok': 42,
      });
      loadLocalAiRequestTokenTotalsForTesting();
      expect(customGetAiRequestTokenTotal('local-ai-neg')).toBe(0);
      expect(customGetAiRequestTokenTotal('local-ai-str')).toBe(0);
      expect(customGetAiRequestTokenTotal('local-ai-null')).toBe(0);
      expect(customGetAiRequestTokenTotal('local-ai-bool')).toBe(0);
      expect(customGetAiRequestTokenTotal('local-ai-ok')).toBe(42);
    });

    it('caps the stored map so it cannot grow without bound', () => {
      for (let i = 0; i < 520; i++) {
        recordLocalAiRequestTokenUsageForTesting(`local-ai-${i}`, 1, 0);
      }
      const persisted = JSON.parse(memoryStorage['gd-custom-ai-token-totals']);
      expect(Object.keys(persisted).length).toBe(500);
      // The oldest entries are the ones dropped.
      expect(persisted['local-ai-0']).toBeUndefined();
      expect(persisted['local-ai-519']).toBe(1);
    });
  });

  describe('sub-agent requests survive a reload', () => {
    const memoryStorage = {};
    const fakeStorage = {
      getItem: key => (key in memoryStorage ? memoryStorage[key] : null),
      setItem: (key, value) => {
        memoryStorage[key] = String(value);
      },
      removeItem: key => {
        delete memoryStorage[key];
      },
    };
    beforeEach(() => {
      Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]);
      global.localStorage = fakeStorage;
      _resetCustomAiClientForTesting();
    });
    afterEach(() => {
      delete global.localStorage;
    });

    const makeChild = async (parentId, roleId) => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      return customCreateSubAgentAiRequest({
        parentAiRequestId: parentId,
        roleId,
        userRequest: 'do it',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        spawnContextNote: null,
      });
    };

    it('persists a child in its own store, not the parent chat list', async () => {
      const child = await makeChild('local-ai-parent-1', 'developer');
      const childStore = JSON.parse(
        memoryStorage['gd-custom-ai-subagent-requests'] || '{}'
      );
      expect(Object.keys(childStore)).toContain(child.id);
      const parentStore = JSON.parse(
        memoryStorage['gd-custom-ai-requests'] || '{}'
      );
      expect(Object.keys(parentStore)).not.toContain(child.id);
    });

    it('reloads the child in a fresh session', async () => {
      const child = await makeChild('local-ai-parent-2', 'tester');
      _resetCustomAiClientForTesting();
      // Gone from memory: the fallback carries no parent link.
      expect(customGetAiRequest(child.id).parentAiRequestId).toBeUndefined();
      loadLocalAiRequests();
      loadLocalAiSubAgentRequestsForTesting();
      const reloaded = customGetAiRequest(child.id);
      expect(reloaded.parentAiRequestId).toBe('local-ai-parent-2');
      expect(reloaded.studioRoleId).toBe('tester');
    });

    it('ignores a corrupt child store payload without throwing', () => {
      memoryStorage['gd-custom-ai-subagent-requests'] = '{not json';
      expect(() => loadLocalAiSubAgentRequestsForTesting()).not.toThrow();
      // An entry without a parent link is not a child and is dropped.
      memoryStorage['gd-custom-ai-subagent-requests'] = JSON.stringify({
        'local-ai-orphan': { id: 'local-ai-orphan', status: 'ready' },
      });
      loadLocalAiSubAgentRequestsForTesting();
      expect(
        customGetAiRequest('local-ai-orphan').parentAiRequestId
      ).toBeUndefined();
    });
  });

  describe('legacy persisted chats render after upgrading', () => {
    const memoryStorage = {};
    const fakeStorage = {
      getItem: key => (key in memoryStorage ? memoryStorage[key] : null),
      setItem: (key, value) => {
        memoryStorage[key] = String(value);
      },
      removeItem: key => {
        delete memoryStorage[key];
      },
    };
    beforeEach(() => {
      Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]);
      global.localStorage = fakeStorage;
      _resetCustomAiClientForTesting();
    });
    afterEach(() => {
      delete global.localStorage;
    });

    it('replaces a non-array stored output with an empty array on load', () => {
      // The loader validates only id/status, so a truthy non-array `output`
      // reaches every consumer — a spread or `.map` over it throws and fails the
      // whole turn. normalizePersistedMessages is the one choke point.
      fakeStorage.setItem(
        'gd-custom-ai-requests',
        JSON.stringify({
          'local-ai-bad-output': {
            id: 'local-ai-bad-output',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            userId: LOCAL_BYOK_USER_ID,
            status: 'ready',
            error: null,
            output: { not: 'an array' },
          },
        })
      );
      _resetCustomAiClientForTesting();
      const loaded = loadLocalAiRequests();

      expect(loaded['local-ai-bad-output'].output).toEqual([]);
    });

    it("rewrites a stored 'text' entry to output_text on load", () => {
      // Chats persisted before the parser emitted output_text carry 'text',
      // which no renderer handles — the answer would be invisible on reload.
      fakeStorage.setItem(
        'gd-custom-ai-requests',
        JSON.stringify({
          'local-ai-old': {
            id: 'local-ai-old',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            userId: LOCAL_BYOK_USER_ID,
            status: 'ready',
            error: null,
            output: [
              {
                type: 'message',
                role: 'assistant',
                status: 'completed',
                messageId: 'm1',
                content: [
                  { type: 'text', status: 'completed', text: 'Old answer.' },
                ],
              },
            ],
          },
        })
      );

      const loaded = loadLocalAiRequests();
      const entry = loaded['local-ai-old'].output[0].content[0];
      expect(entry.type).toBe('output_text');
      expect(entry.text).toBe('Old answer.');
      expect(entry.annotations).toEqual([]);
    });

    it('leaves an already-correct entry untouched by identity', () => {
      const message = {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        messageId: 'm2',
        content: [
          {
            type: 'output_text',
            status: 'completed',
            text: 'Fine.',
            annotations: [],
          },
        ],
      };
      fakeStorage.setItem(
        'gd-custom-ai-requests',
        JSON.stringify({
          'local-ai-ok': {
            id: 'local-ai-ok',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            userId: LOCAL_BYOK_USER_ID,
            status: 'ready',
            error: null,
            output: [message],
          },
        })
      );

      const loaded = loadLocalAiRequests();
      expect(loaded['local-ai-ok'].output[0]).toEqual(message);
    });
  });

  describe('persisted request pruning keeps the most recent chats', () => {
    const memoryStorage = {};
    const fakeStorage = {
      getItem: key => (key in memoryStorage ? memoryStorage[key] : null),
      setItem: (key, value) => {
        memoryStorage[key] = String(value);
      },
      removeItem: key => {
        delete memoryStorage[key];
      },
    };
    beforeEach(() => {
      Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]);
      global.localStorage = fakeStorage;
      _resetCustomAiClientForTesting();
    });
    afterEach(() => {
      delete global.localStorage;
    });

    const makeRequest = (id, updatedAt) => ({
      id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt,
      userId: LOCAL_BYOK_USER_ID,
      status: 'ready',
      error: null,
      output: [],
    });

    it('does not let sub-agent children evict real chats from persistence', () => {
      // Children are internal (excluded from history) but were persisted,
      // consuming the 20-slot recency budget: after a multi-agent run the
      // newest real chats could vanish on reload.
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      const nowSpy = jest.spyOn(Date, 'now');
      // 20 real chats, oldest first.
      for (let i = 0; i < 20; i++) {
        nowSpy.mockReturnValue(base + i * 1000);
        customUpdateAiRequest(
          makeRequest(
            `local-ai-real-${i}`,
            new Date(base + i * 1000).toISOString()
          )
        );
      }
      // 5 sub-agent children, newer than every real chat.
      for (let i = 0; i < 5; i++) {
        nowSpy.mockReturnValue(base + 100000 + i * 1000);
        customUpdateAiRequest(
          ({
            ...makeRequest(
              `local-ai-child-${i}`,
              new Date(base + 100000 + i * 1000).toISOString()
            ),
            parentAiRequestId: 'local-ai-real-19',
          }: any)
        );
      }
      // Read what was actually PERSISTED: loadLocalAiRequests merges storage
      // into the in-memory cache (which still holds the children), so it would
      // mask the bug.
      const persistedIds = Object.keys(
        JSON.parse(memoryStorage['gd-custom-ai-requests'] || '{}')
      );
      expect(
        persistedIds.filter(id => id.startsWith('local-ai-child-'))
      ).toEqual([]);
      expect(
        persistedIds.filter(id => id.startsWith('local-ai-real-'))
      ).toHaveLength(20);
      nowSpy.mockRestore();
    });

    it('drops the least recently updated chat, not the most recently created', () => {
      // Object key order is insertion order, so re-assigning an older chat
      // after a new turn does not move it. Pruning by key order would drop a
      // newer conversation while keeping the stale one that was just continued.
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      const nowSpy = jest.spyOn(Date, 'now');
      // Seed 20 chats, oldest first (id-0 oldest).
      for (let i = 0; i < 20; i++) {
        nowSpy.mockReturnValue(base + i * 1000);
        customUpdateAiRequest(
          makeRequest(`local-ai-${i}`, new Date(base + i * 1000).toISOString())
        );
      }
      expect(Object.keys(loadLocalAiRequests())).toHaveLength(20);

      // Continue the OLDEST chat: it becomes the most recently updated.
      const newest = base + 20 * 1000;
      nowSpy.mockReturnValue(newest);
      customUpdateAiRequest(
        makeRequest('local-ai-0', new Date(newest).toISOString())
      );
      // Add one more so the cache exceeds the cap and pruning runs.
      nowSpy.mockReturnValue(newest + 1000);
      customUpdateAiRequest(
        makeRequest('local-ai-20', new Date(newest + 1000).toISOString())
      );

      saveLocalAiRequests();
      const persisted = JSON.parse(
        memoryStorage['gd-custom-ai-requests'] || '{}'
      );
      const ids = Object.keys(persisted);
      expect(ids).toHaveLength(20);
      // The just-continued old chat and the brand-new one are kept.
      expect(ids).toContain('local-ai-0');
      expect(ids).toContain('local-ai-20');
      // The stalest one was dropped instead.
      expect(ids).not.toContain('local-ai-1');
      nowSpy.mockRestore();
    });
  });

  describe('persisted config sanitization', () => {
    // The suite runs in the Node jest environment: no localStorage.
    const memoryStorage = {};
    const fakeStorage = {
      getItem: key => (key in memoryStorage ? memoryStorage[key] : null),
      setItem: (key, value) => {
        memoryStorage[key] = String(value);
      },
      removeItem: key => {
        delete memoryStorage[key];
      },
    };
    beforeEach(() => {
      Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]);
      global.localStorage = fakeStorage;
    });
    afterEach(() => {
      delete global.localStorage;
    });

    it('falls back to defaults when localStorage holds a corrupt config', () => {
      fakeStorage.setItem('gd-custom-ai-config', '{not json');
      _resetCustomAiClientForTesting();
      const config = getCustomEndpointConfig();
      expect(config.baseUrl).toBe('http://localhost:11434/v1');
      expect(config.temperature).toBe(0.7);
      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });

    it('coerces mistyped fields and clamps temperature on load', () => {
      fakeStorage.setItem(
        'gd-custom-ai-config',
        JSON.stringify({
          enabled: 'yes',
          baseUrl: 1234,
          model: null,
          temperature: 42,
          timeoutMs: 'fast',
          maxTokens: -3,
          customHeaders: ['nope'],
        })
      );
      _resetCustomAiClientForTesting();
      const config = getCustomEndpointConfig();
      expect(config.enabled).toBe(false);
      expect(config.baseUrl).toBe('');
      expect(config.model).toBe('');
      // Out-of-range temperature is clamped into [0, 1] like the dialog does.
      expect(config.temperature).toBe(1);
      expect(config.timeoutMs).toBeUndefined();
      expect(config.maxTokens).toBeUndefined();

      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });

    it('clamps an oversized timeout on load so setTimeout cannot overflow', () => {
      // setTimeout (and axios, which wraps it) stores its delay in a 32-bit
      // signed integer; beyond that the runtime clamps it to 1 ms, which
      // aborted every request almost immediately with a "timed out" message.
      fakeStorage.setItem(
        'gd-custom-ai-config',
        JSON.stringify({
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen2.5-coder',
          timeoutMs: 3000000000,
        })
      );
      _resetCustomAiClientForTesting();
      const config = getCustomEndpointConfig();
      expect(config.timeoutMs).toBe(MAX_TIMEOUT_MS);
      // The bound must be below the overflow threshold for this to mean anything.
      expect(MAX_TIMEOUT_MS).toBeLessThan(3000000000);
      expect(config.customHeaders).toBeUndefined();
      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });

    it('keeps well-typed persisted values through sanitization', () => {
      fakeStorage.setItem(
        'gd-custom-ai-config',
        JSON.stringify({
          enabled: true,
          baseUrl: 'http://localhost:1234/v1',
          model: 'mistral-7b',
          temperature: 0.9,
          timeoutMs: 300000,
          maxTokens: 2048,
          customHeaders: { 'X-Custom': 'value' },
        })
      );
      _resetCustomAiClientForTesting();
      const config = getCustomEndpointConfig();
      expect(config.enabled).toBe(true);
      expect(config.baseUrl).toBe('http://localhost:1234/v1');
      expect(config.model).toBe('mistral-7b');
      expect(config.temperature).toBe(0.9);
      expect(config.timeoutMs).toBe(300000);
      expect(config.maxTokens).toBe(2048);
      expect(config.customHeaders).toEqual({ 'X-Custom': 'value' });
      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });

    it('sanitizes mistyped updates so the live cache cannot be poisoned', () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5-coder',
        temperature: 0.5,
      });
      // $FlowFixMe deliberately mistyped updates
      setCustomEndpointConfig({
        enabled: 'yes',
        baseUrl: 1234,
        model: null,
        temperature: 42,
        timeoutMs: 'fast',
        maxTokens: -3,
        customHeaders: ['nope'],
        streaming: 'on',
      });
      const config = getCustomEndpointConfig();
      expect(config.enabled).toBe(false);
      expect(config.baseUrl).toBe('');
      expect(config.model).toBe('');
      expect(config.temperature).toBe(1);
      expect(config.timeoutMs).toBeUndefined();
      expect(config.maxTokens).toBeUndefined();
      expect(config.customHeaders).toBeUndefined();
      expect(config.streaming).toBe(false);
      // The sanitized shape is what a later get() returns without re-reading
      // localStorage (short-circuit on cache).
      expect(getCustomEndpointConfig()).toEqual(config);
      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });

    it('keeps a valid apiKey through set sanitization', () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'https://api.openrouter.ai/api/v1',
        apiKey: 'sk-live-key',
        model: 'deepseek/deepseek-chat',
        temperature: 0.3,
      });
      const config = getCustomEndpointConfig();
      expect(config.apiKey).toBe('sk-live-key');
      expect(config.enabled).toBe(true);
      // Persisted payload must not contain the cleartext key.
      const persisted = JSON.parse(
        memoryStorage['gd-custom-ai-config'] || 'null'
      );
      expect(persisted).toBeTruthy();
      expect(persisted.apiKey).toBeUndefined();
      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });

    it('falls back to defaults when localStorage holds a JSON null / scalar', () => {
      fakeStorage.setItem('gd-custom-ai-config', 'null');
      _resetCustomAiClientForTesting();
      let config = getCustomEndpointConfig();
      expect(config.baseUrl).toBe(DEFAULT_CUSTOM_AI_CONFIG.baseUrl);
      expect(config.enabled).toBe(false);

      fakeStorage.setItem('gd-custom-ai-config', '42');
      _resetCustomAiClientForTesting();
      config = getCustomEndpointConfig();
      expect(config.baseUrl).toBe(DEFAULT_CUSTOM_AI_CONFIG.baseUrl);

      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });

    it('ignores non-object request-cache JSON and keeps valid entries', () => {
      fakeStorage.setItem('gd-custom-ai-requests', 'not-an-object');
      _resetCustomAiClientForTesting();
      expect(() => loadLocalAiRequests()).not.toThrow();
      expect(Object.keys(loadLocalAiRequests())).toHaveLength(0);

      fakeStorage.setItem('gd-custom-ai-requests', JSON.stringify([1, 2, 3]));
      _resetCustomAiClientForTesting();
      loadLocalAiRequests();
      expect(Object.keys(loadLocalAiRequests())).toHaveLength(0);

      fakeStorage.setItem(
        'gd-custom-ai-requests',
        JSON.stringify({
          'local-ai-good': {
            id: 'local-ai-good',
            status: 'ready',
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-01T00:00:00.000Z',
            userId: LOCAL_BYOK_USER_ID,
            error: null,
            output: [],
          },
          'local-ai-bad': null,
          'local-ai-also-bad': { notId: true },
          scalar: 7,
          arr: [],
        })
      );
      _resetCustomAiClientForTesting();
      const loaded = loadLocalAiRequests();
      expect(Object.keys(loaded)).toEqual(['local-ai-good']);
      // List path must not throw on the filtered cache.
      expect(() => customGetAiRequests()).not.toThrow();
      expect(customGetAiRequests().aiRequests.map(r => r.id)).toEqual([
        'local-ai-good',
      ]);

      fakeStorage.removeItem('gd-custom-ai-requests');
      _resetCustomAiClientForTesting();
    });

    it('does not throw when localStorage.setItem rejects on request save', async () => {
      const consoleWarn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        },
      });
      const created = await customCreateAiRequest({
        userRequest: 'quota test',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });
      expect(created.id).toMatch(/^local-ai-/);

      // Swap in a storage that always throws (quota exceeded / SecurityError).
      const throwingStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => {},
      };
      global.localStorage = throwingStorage;
      expect(() => saveLocalAiRequests()).not.toThrow();
      expect(() => customDeleteAiRequest(created.id)).not.toThrow();
      expect(consoleWarn).toHaveBeenCalled();
      consoleWarn.mockRestore();
      delete global.localStorage;
      _resetCustomAiClientForTesting();
    });
    it('strips custom headers with CR/LF or hop-by-hop names on load', () => {
      fakeStorage.setItem(
        'gd-custom-ai-config',
        JSON.stringify({
          baseUrl: 'http://localhost:11434/v1',
          customHeaders: {
            'X-Ok': 'yes',
            'X-Evil': 'value\r\nX-Injected: 1',
            'Content-Type': 'text/plain',
            Host: 'evil.example',
            'Transfer-Encoding': 'chunked',
            'Bad Name': 'x',
          },
        })
      );
      _resetCustomAiClientForTesting();
      const config = getCustomEndpointConfig();
      expect(config.customHeaders).toEqual({ 'X-Ok': 'yes' });
      fakeStorage.removeItem('gd-custom-ai-config');
      _resetCustomAiClientForTesting();
    });
  });

  describe('sendChatCompletion cancellation', () => {
    const minimalConfig = {
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      temperature: 0.7,
    };

    it('passes the caller AbortSignal directly to axios', async () => {
      const controller = new AbortController();
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: minimalConfig,
        signal: controller.signal,
      });

      const postOptions = axios.post.mock.calls[0][2];
      expect(postOptions.signal).toBe(controller.signal);
      // The legacy CancelToken bridge must be gone.
      expect(postOptions.cancelToken).toBeUndefined();
    });

    it('does not let custom headers replace Content-Type on the request', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        },
      });
      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'qwen2.5-coder',
          temperature: 0.7,
          customHeaders: {
            'Content-Type': 'text/plain',
            'X-Keep': '1',
            'X-Bad': 'a\nb',
            Host: 'evil.example',
          },
        },
      });
      const headers = axios.post.mock.calls[0][2].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Keep']).toBe('1');
      expect(headers['X-Bad']).toBeUndefined();
      expect(headers.Host).toBeUndefined();
    });

    it('uses a configurable timeout when provided, else the 120s default', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: { ...minimalConfig, timeoutMs: 300000 },
      });
      expect(axios.post.mock.calls[0][2].timeout).toBe(300000);

      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: { ...minimalConfig, timeoutMs: -5 },
      });
      expect(axios.post.mock.calls[1][2].timeout).toBe(120000);
    });

    it('appends a hint to a 401 when no API key is configured', async () => {
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key' } },
        },
      });

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: minimalConfig, // apiKey: ''
        })
      ).rejects.toThrow(/AI Provider Error \(401\).*No API key is configured/);

      // With a key configured, the raw provider error is passed through.
      // $FlowFixMe
      axios.post.mockRejectedValueOnce({
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key' } },
        },
      });
      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: { ...minimalConfig, apiKey: 'sk-test' },
        })
      ).rejects.toThrow(/^AI Provider Error \(401\): Invalid API key$/);
    });

    it('rejects with an abort message when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      // $FlowFixMe
      axios.post.mockRejectedValueOnce(new Error('canceled'));

      await expect(
        sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: minimalConfig,
          signal: controller.signal,
        })
      ).rejects.toThrow('AI request was aborted.');
    });

    it('rejects with an abort message when aborted mid-request', async () => {
      const controller = new AbortController();
      // $FlowFixMe
      axios.post.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            controller.signal.addEventListener('abort', () =>
              reject(new Error('canceled'))
            );
          })
      );

      const pending = sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: minimalConfig,
        signal: controller.signal,
      });
      controller.abort();

      await expect(pending).rejects.toThrow('AI request was aborted.');
    });
  });

  describe('suspend-time turn cancellation', () => {
    const waitFor = condition => {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
          if (condition()) return resolve();
          if (++attempts > 100) return reject(new Error('timeout'));
          setTimeout(check, 10);
        };
        check();
      });
    };

    it('aborts the in-flight model call when a request is suspended', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const created = await customCreateAiRequest({
        userRequest: 'build a scene',
      });
      const aiRequestId = created.id;

      // Suspend while the "model" answer is in flight: the turn's post hangs
      // until the signal aborts.
      axios.post.mockImplementationOnce(
        (url, body, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new Error('canceled'))
            );
          })
      );
      const pending = customAddMessageToAiRequest({
        aiRequestId,
        userMessage: 'continue',
      });
      await waitFor(() => axios.post.mock.calls.length > 1);

      const signal = axios.post.mock.calls[1][2].signal;
      expect(signal.aborted).toBe(false);

      customSuspendAiRequest(aiRequestId);
      expect(signal.aborted).toBe(true);

      // The stopped turn resolves without throwing and without an error.
      const result = await pending;
      expect(result.status).toBe('suspended');
      expect(result.error).toBe(null);
    });

    it('a parent suspend cancels an in-flight sub-agent model call', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const parent = await customCreateAiRequest({
        userRequest: 'orchestrate',
      });

      // The sub-agent turn's post hangs until its signal aborts.
      axios.post.mockImplementationOnce(
        (url, body, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new Error('canceled'))
            );
          })
      );
      const subAgentPending = customCreateSubAgentAiRequest({
        parentAiRequestId: parent.id,
        roleId: 'developer',
        userRequest: 'do the work',
      });
      await waitFor(() => axios.post.mock.calls.length > 1);

      const subAgentSignal = axios.post.mock.calls[1][2].signal;
      customSuspendAiRequest(parent.id);
      expect(subAgentSignal.aborted).toBe(true);
      await expect(subAgentPending).rejects.toThrow('AI request was aborted.');
    });
  });

  describe('Request Store & Lifecycle Methods', () => {
    it('creates, retrieves, and updates local AI requests', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I have processed your request.',
              },
            },
          ],
        },
      });

      const aiRequest = await customCreateAiRequest({
        userRequest: 'Hello test AI',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      expect(aiRequest.id).toMatch(/^local-ai-/);
      expect(aiRequest.status).toBe('ready');
      expect(aiRequest.output.length).toBeGreaterThanOrEqual(2); // user + assistant

      const fetched = await customGetAiRequest(aiRequest.id);
      expect(fetched.id).toBe(aiRequest.id);

      const all = await customGetAiRequests();
      expect(all.aiRequests.some(r => r.id === aiRequest.id)).toBe(true);

      const statuses = await customGetAiRequestStatuses([aiRequest.id]);
      expect(statuses).toEqual([
        { id: aiRequest.id, status: 'ready', userId: LOCAL_BYOK_USER_ID },
      ]);
    });

    it('suspends an active AI request', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Working...' } }],
        },
      });

      const aiRequest = await customCreateAiRequest({
        userRequest: 'Test suspend',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      const suspended = await customSuspendAiRequest(aiRequest.id);
      expect(suspended.status).toBe('suspended');
    });

    it('forks an AI request up to a message id', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Fork me' } }],
        },
      });

      const aiRequest = await customCreateAiRequest({
        userRequest: 'Original thread',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      const forked = await customForkAiRequest(aiRequest.id);
      expect(forked.id).not.toBe(aiRequest.id);
      expect(forked.output.length).toBe(aiRequest.output.length);
    });

    it('keeps a concurrent in-place rewrite of a pre-existing message (plan flip)', async () => {
      // The studio flips a plan task to `done` via a gated write while the
      // parent's next model turn is running. The turn's output is a snapshot
      // from turn start, so keeping its copy silently clobbered the flip
      // (same messageId, so the cache-only merge could not recover it).
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      const planFor = status =>
        JSON.stringify({
          success: true,
          plan: {
            tasks: [{ id: 'design', title: 'D', description: 'd', status }],
          },
        });
      customUpdateAiRequest(
        ({
          id: 'local-ai-flip',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          userId: LOCAL_BYOK_USER_ID,
          status: 'ready',
          error: null,
          output: [
            {
              type: 'function_call_output',
              call_id: 'call_plan',
              messageId: 'msg-plan',
              output: planFor('pending'),
            },
          ],
        }: any)
      );

      // $FlowFixMe the model call performs the concurrent flip, then answers.
      axios.post.mockImplementationOnce(async () => {
        const current = customGetAiRequest('local-ai-flip');
        customUpdateAiRequest(
          ({
            ...current,
            output: (current.output || []).map(m =>
              m && m.messageId === 'msg-plan'
                ? { ...m, output: planFor('done') }
                : m
            ),
          }: any)
        );
        return {
          status: 200,
          data: {
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
          },
        };
      });

      const result = await customAddMessageToAiRequest({
        aiRequestId: 'local-ai-flip',
        userMessage: 'next',
      });
      const planMessage = (result.output || []).find(
        m => m && m.messageId === 'msg-plan'
      );
      expect(JSON.parse(planMessage.output).plan.tasks[0].status).toBe('done');
      // And the turn's own answer is present.
      expect(
        (result.output || []).some(
          m =>
            m &&
            m.role === 'assistant' &&
            m.messageId &&
            m.messageId !== 'msg-plan'
        )
      ).toBe(true);
    });

    it('survives a hole when a concurrent write lands during a failed turn', async () => {
      // The failure path compares each cache-only message against `output`
      // (which carries the persisted hole). When every cache message is
      // already in `existing`, the `existingIds` check short-circuits and the
      // buggy `.some` never runs - so the write must land DURING the turn,
      // making the cache message absent from the `existing` snapshot taken at
      // entry. That is exactly a suggestion/plan write racing a model answer.
      const userMessage = {
        type: 'message',
        status: 'completed',
        role: 'user',
        content: [{ type: 'user_request', status: 'completed', text: 'hi' }],
        messageId: 'm-1',
      };
      customUpdateAiRequest(
        ({
          id: 'local-ai-race',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          userId: LOCAL_BYOK_USER_ID,
          status: 'ready',
          error: null,
          output: [null, userMessage],
        }: any)
      );

      // $FlowFixMe
      axios.post.mockImplementationOnce(async () => {
        customUpdateAiRequest(
          ({
            ...customGetAiRequest('local-ai-race'),
            output: [
              null,
              userMessage,
              {
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'suggestion write' }],
                messageId: 'm-2',
              },
            ],
          }: any)
        );
        // A rejection with no reason: not a literal, so eslint's
        // no-throw-literal does not require a suppression.
        const noReason: any = undefined;
        throw noReason;
      });

      const result = await customAddMessageToAiRequest({
        aiRequestId: 'local-ai-race',
        userMessage: 'next',
      });
      expect(result.status).toBe('error');
      // The concurrent message survived the failed turn.
      expect(
        result.output.some(message => message && message.messageId === 'm-2')
      ).toBe(true);
    });

    it('adds a turn when the persisted output has a null hole', async () => {
      // `output` starts as a copy of the persisted array, and the merge reads
      // `message.messageId` over it - a hole crashed the whole turn on both
      // the success (turnIds) and failure (existingIds) paths.
      const seed = (output: Array<any>) => {
        customUpdateAiRequest(
          ({
            id: 'local-ai-hole-turn',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            userId: LOCAL_BYOK_USER_ID,
            status: 'ready',
            error: null,
            output,
          }: any)
        );
      };
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        },
      });
      seed([
        null,
        {
          type: 'message',
          status: 'completed',
          role: 'user',
          content: [{ type: 'user_request', status: 'completed', text: 'hi' }],
          messageId: 'm-1',
        },
      ]);

      const result = await customAddMessageToAiRequest({
        aiRequestId: 'local-ai-hole-turn',
        userMessage: 'next',
      });
      expect(result.status).not.toBe('error');

      // And the failure path: the model rejects, the handler still returns.
      // The function-call outputs are network-supplied and may carry a hole.
      // $FlowFixMe
      axios.post.mockRejectedValueOnce(undefined);
      await expect(
        customAddMessageToAiRequest({
          aiRequestId: 'local-ai-hole-turn',
          functionCallOutputs: ([null, { call_id: 'c1', output: '{}' }]: any),
        })
      ).resolves.toBeTruthy();
    });

    it('actually slices at the given message id (and tolerates a null hole)', async () => {
      // The branch this test name promises was never exercised: the sibling
      // test passes no id, so findIndex-with-an-id (and the null hole a
      // persisted output can carry) was untested - a null entry threw
      // 'Cannot read properties of null (reading messageId)' on fork.
      const makeMessage = id => ({
        type: 'message',
        status: 'completed',
        role: 'user',
        content: [{ type: 'user_request', status: 'completed', text: id }],
        messageId: id,
      });
      customUpdateAiRequest(
        ({
          id: 'local-ai-fork-src',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          userId: LOCAL_BYOK_USER_ID,
          status: 'ready',
          error: null,
          output: [makeMessage('m1'), null, makeMessage('m3')],
        }: any)
      );

      const forked = customForkAiRequest('local-ai-fork-src', 'm3');
      expect(forked.output).toHaveLength(3);

      const sliced = customForkAiRequest('local-ai-fork-src', 'm1');
      expect(sliced.output).toHaveLength(1);
      expect(sliced.output[0].messageId).toBe('m1');
    });

    it('clears the source error and copies the model override on fork', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Errored parent',
      });
      customSetAiRequestModelOverride(aiRequest.id, 'deepseek-chat');
      customUpdateAiRequest({
        ...customGetAiRequest(aiRequest.id),
        status: 'error',
        error: { code: 'server_error', message: 'boom' },
      });

      const forked = customForkAiRequest(aiRequest.id);
      expect(forked.id).not.toBe(aiRequest.id);
      expect(forked.status).toBe('ready');
      expect(forked.error).toBeNull();
      expect(customGetAiRequestModelOverride(forked.id)).toBe('deepseek-chat');
      expect(customGetAiRequestModelOverride(aiRequest.id)).toBe(
        'deepseek-chat'
      );
    });

    it('patches title and archived attributes on a local request', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Patch me' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Patch target',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      const renamed = customPatchAiRequestAttributes(aiRequest.id, {
        title: 'My chat',
      });
      expect(renamed.title).toBe('My chat');
      expect(renamed.archivedAt).toBeUndefined();
      expect(customGetAiRequest(aiRequest.id).title).toBe('My chat');

      const archived = customPatchAiRequestAttributes(aiRequest.id, {
        archived: true,
      });
      expect(archived.archivedAt).toBeTruthy();
      expect(customGetAiRequest(aiRequest.id).archivedAt).toBeTruthy();

      const restored = customPatchAiRequestAttributes(aiRequest.id, {
        archived: false,
      });
      expect(restored.archivedAt).toBeNull();
    });

    it('returns a fallback when patching an unknown local request', () => {
      const fallback = customPatchAiRequestAttributes('local-ai-missing', {
        title: 'Nope',
      });
      expect(fallback.id).toBe('local-ai-missing');
      expect(fallback.title).toBeUndefined();
    });

    it('deletes a local request and drops its per-request registries', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Delete me' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Delete target',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });
      customSetAiRequestModelOverride(aiRequest.id, 'llama3');
      expect(
        customGetAiRequests().aiRequests.some(r => r.id === aiRequest.id)
      ).toBe(true);

      customDeleteAiRequest(aiRequest.id);

      expect(
        customGetAiRequests().aiRequests.some(r => r.id === aiRequest.id)
      ).toBe(false);
      expect(customGetAiRequestModelOverride(aiRequest.id)).toBe('');
      // Missing id still safe.
      expect(() => customDeleteAiRequest('local-ai-missing')).not.toThrow();
    });

    it('persists a failed first turn as status error (does not throw)', async () => {
      axios.post.mockRejectedValueOnce(new Error('ollama down'));

      const failed = await customCreateAiRequest({
        userRequest: 'First message while offline',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      expect(failed.id).toMatch(/^local-ai-/);
      expect(failed.status).toBe('error');
      expect(failed.error && failed.error.message).toMatch(/ollama down/);
      const last = (failed.output || [])[(failed.output || []).length - 1];
      expect(last.role).toBe('user');
      expect(JSON.stringify(last.content)).toContain(
        'First message while offline'
      );
      expect(customGetAiRequest(failed.id).status).toBe('error');
      // Cached so Retry can continue the turn.
      expect(
        customGetAiRequests().aiRequests.some(r => r.id === failed.id)
      ).toBe(true);
      // A failed first turn never reaches the model response, so it must not
      // invent response tokens.
      expect(customGetAiRequestTokenTotal(failed.id)).toBe(0);
    });

    it('records first-turn token usage on a successful create', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            { message: { role: 'assistant', content: 'First reply tokens' } },
          ],
        },
      });
      const created = await customCreateAiRequest({
        userRequest: 'Count my first turn tokens',
      });
      expect(created.status).toBe('ready');
      expect(customGetAiRequestTokenTotal(created.id)).toBeGreaterThan(0);
    });

    it('continues the first turn after a failed create', async () => {
      axios.post.mockRejectedValueOnce(new Error('cold start'));
      const failed = await customCreateAiRequest({
        userRequest: 'Seed then recover',
      });
      expect(failed.status).toBe('error');

      axios.post.mockClear();
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'ready now' } }],
        },
      });
      const retried = await customRetryAiRequest(failed.id);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(retried.status).toBe('ready');
      expect(retried.error).toBeNull();
      expect(retried.retriesInARowCount).toBe(1);
      const last = (retried.output || [])[(retried.output || []).length - 1];
      expect(last.role).toBe('assistant');
      // $FlowFixMe
      expect(JSON.stringify(last.content)).toContain('ready now');
    });

    it('retries a failed local request by re-invoking the model turn', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Retry target',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      // Force a terminal error like the local loop would.
      customUpdateAiRequest({
        ...customGetAiRequest(aiRequest.id),
        status: 'error',
        error: { code: 'server_error', message: 'boom' },
      });
      const outputBeforeRetry = (customGetAiRequest(aiRequest.id).output || [])
        .length;

      // Continue turn (no new user message) must hit the model once.
      axios.post.mockClear();
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            { message: { role: 'assistant', content: 'Fail then retry' } },
          ],
        },
      });

      const retried = await customRetryAiRequest(aiRequest.id);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(retried.status).toBe('ready');
      expect(retried.error).toBeNull();
      expect(retried.retriesInARowCount).toBe(1);
      expect(retried.retriedAfterMessagesCount).toBe(outputBeforeRetry);
      expect((retried.output || []).length).toBe(outputBeforeRetry + 1);
      const lastMessage = (retried.output || [])[
        (retried.output || []).length - 1
      ];
      // $FlowFixMe
      expect(lastMessage.role).toBe('assistant');
      expect(customGetAiRequest(aiRequest.id).status).toBe('ready');

      // Retrying a non-errored request is a no-op (no second model call).
      axios.post.mockClear();
      const again = await customRetryAiRequest(aiRequest.id);
      expect(axios.post).not.toHaveBeenCalled();
      expect(again.retriesInARowCount).toBe(1);
    });

    it('keeps the request in error when the continue turn fails again', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Retry fail target',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });
      customUpdateAiRequest({
        ...customGetAiRequest(aiRequest.id),
        status: 'error',
        error: { code: 'server_error', message: 'boom' },
      });

      axios.post.mockClear();
      // $FlowFixMe
      axios.post.mockRejectedValueOnce(new Error('endpoint down'));

      const retried = await customRetryAiRequest(aiRequest.id);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(retried.status).toBe('error');
      expect(retried.error && retried.error.message).toMatch(/endpoint down/);
      expect(retried.retriesInARowCount).toBe(1);
      expect(customGetAiRequest(aiRequest.id).status).toBe('error');
    });

    it('flips status to error (does not throw) when a model turn fails', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Turn failure target',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });
      const outputBefore = (aiRequest.output || []).length;

      axios.post.mockClear();
      axios.post.mockRejectedValueOnce(new Error('endpoint down'));

      const failed = await customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: 'please continue',
      });

      expect(failed.status).toBe('error');
      expect(failed.error && failed.error.message).toMatch(/endpoint down/);
      // User message is persisted so Retry → continue has the transcript.
      const last = (failed.output || [])[(failed.output || []).length - 1];
      expect(last.role).toBe('user');
      expect(JSON.stringify(last.content)).toContain('please continue');
      expect((failed.output || []).length).toBe(outputBefore + 1);
      expect(customGetAiRequest(aiRequest.id).status).toBe('error');
      // Does not throw: container can updateAiRequest from the return value.
      await expect(
        customAddMessageToAiRequest({
          aiRequestId: aiRequest.id,
          userMessage: 'second try',
        }).then(async result => result)
      ).resolves.toBeTruthy();
    });

    it('offers continue-turn retry after a failed ordinary turn', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Retry after ordinary failure',
      });

      axios.post.mockClear();
      axios.post.mockRejectedValueOnce(new Error('connection reset'));
      const failed = await customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: 'hit the model',
      });
      expect(failed.status).toBe('error');

      // Retry continues the turn (no new user message) and succeeds.
      axios.post.mockClear();
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'recovered' } }],
        },
      });
      const retried = await customRetryAiRequest(aiRequest.id);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(retried.status).toBe('ready');
      expect(retried.error).toBeNull();
      expect(retried.retriesInARowCount).toBe(1);
      const last = (retried.output || [])[(retried.output || []).length - 1];
      expect(last.role).toBe('assistant');
      // $FlowFixMe
      expect(JSON.stringify(last.content)).toContain('recovered');
    });

    it('clears a prior terminal error on a later successful ordinary turn', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Stale error clear',
      });

      axios.post.mockClear();
      axios.post.mockRejectedValueOnce(new Error('endpoint down'));
      const failed = await customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: 'hit the model',
      });
      expect(failed.status).toBe('error');
      expect(failed.error && failed.error.message).toMatch(/endpoint down/);

      // A later ordinary send (not /action/retry) must drop the terminal
      // error: status-agnostic readers (e.g. buildSubAgentReport) must not
      // see a false failure after the chat recovered.
      axios.post.mockClear();
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'recovered' } }],
        },
      });
      const recovered = await customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: 'try again',
      });
      expect(recovered.status).toBe('ready');
      expect(recovered.error).toBeNull();
      expect(customGetAiRequest(aiRequest.id).error).toBeNull();
      expect(customGetAiRequest(aiRequest.id).status).toBe('ready');
    });

    it('persists function-call outputs on a failed mid-turn so continue can re-send them', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'FC mid-turn failure',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      axios.post.mockClear();
      axios.post.mockRejectedValueOnce(new Error('ollama dropped connection'));
      const failed = await customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        functionCallOutputs: [
          { type: 'function_call_output', call_id: 'call-1', output: '{}' },
        ],
      });

      expect(failed.status).toBe('error');
      // Containers must see the FC outputs still on the request so they do not
      // clearEditorFunctionCallResults on a failed send (Retry → continue path).
      const fco = (failed.output || []).filter(
        message => message.type === 'function_call_output'
      );
      expect(fco.length).toBeGreaterThanOrEqual(1);
      // $FlowFixMe
      expect(fco[fco.length - 1].call_id).toBe('call-1');
      expect(isFailedAiRequestStart(failed)).toBe(true);
      expect(customGetAiRequest(aiRequest.id).status).toBe('error');
    });

    it('returns a fallback when retrying an unknown local request', async () => {
      const fallback = await customRetryAiRequest('local-ai-missing');
      expect(fallback.id).toBe('local-ai-missing');
      expect(fallback.status).toBe('ready');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('returns top-level suggestions for an unknown local request', async () => {
      const suggestions = await customGetAiRequestSuggestions('local-ai-123');
      expect(suggestions.suggestions).toHaveLength(3);
      expect(suggestions.suggestions[0].suggestedMessage).toBeDefined();
      // Nothing to attach to — must not invent a cache entry.
      expect(
        customGetAiRequests().aiRequests.some(r => r.id === 'local-ai-123')
      ).toBe(false);
    });

    it('attaches model suggestions onto the last assistant message and returns that snapshot', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Seed for suggestions',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'agent',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  explanationMessage: 'Try this next:',
                  suggestions: [
                    { title: 'Jump', suggestedMessage: 'Add a jump action' },
                  ],
                }),
              },
            },
          ],
        },
      });

      const result = await customGetAiRequestSuggestions(aiRequest.id);

      // Return value must carry the updated output (callers merge it back).
      const lastFromResult = result.output[result.output.length - 1];
      expect(lastFromResult.suggestions).toBeTruthy();
      expect(lastFromResult.suggestions.suggestions[0].title).toBe('Jump');

      // Cache must match the return value so a subsequent merge cannot clobber.
      const cached = customGetAiRequest(aiRequest.id);
      const lastFromCache = cached.output[cached.output.length - 1];
      expect(lastFromCache.suggestions).toBeTruthy();
      expect(lastFromCache.suggestions.suggestions[0].title).toBe('Jump');
    });

    it('budgets the suggestion prompt to the model context window', async () => {
      // The suggestions call replayed the full history with no trim: on a
      // small local model the request went over-window, errored, and fell
      // back to defaults after burning the request.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Seed for suggestions',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'agent',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });
      await customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: 'Big context. '.repeat(1500),
      });

      axios.post.mockClear();
      // $FlowFixMe
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  explanationMessage: 'Try this next:',
                  suggestions: [
                    { title: 'Jump', suggestedMessage: 'Add a jump action' },
                  ],
                }),
              },
            },
          ],
        },
      });
      await customGetAiRequestSuggestions(aiRequest.id);

      const sentMessages = axios.post.mock.calls[0][1].messages;
      // llama3.2 input budget is 4096; the plain suggestions call sends no
      // tools, so the messages alone must fit it.
      expect(estimateMessagesTokens(sentMessages)).toBeLessThanOrEqual(4096);
    });

    it('attaches defaults when the persisted output has a null hole', async () => {
      // The loader only checks id/status and normalize passes holes through,
      // so output[0] can be null - and reading lastMsg.type then threw out
      // of both the try and the catch path, losing suggestions entirely.
      const memoryStorage = {};
      const fakeStorage = {
        getItem: key => (key in memoryStorage ? memoryStorage[key] : null),
        setItem: (key, value) => {
          memoryStorage[key] = String(value);
        },
        removeItem: key => {
          delete memoryStorage[key];
        },
      };
      global.localStorage = fakeStorage;
      try {
        _resetCustomAiClientForTesting();
        setCustomEndpointConfig({
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'llama3.2',
          temperature: 0.7,
        });
        fakeStorage.setItem(
          'gd-custom-ai-requests',
          JSON.stringify({
            'local-ai-hole': {
              id: 'local-ai-hole',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              userId: LOCAL_BYOK_USER_ID,
              status: 'ready',
              error: null,
              output: [null],
            },
          })
        );
        expect(loadLocalAiRequests()['local-ai-hole']).toBeTruthy();
        // $FlowFixMe
        axios.post.mockResolvedValue({
          status: 200,
          data: {
            choices: [{ message: { role: 'assistant', content: 'ok' } }],
          },
        });

        const result = await customGetAiRequestSuggestions('local-ai-hole');
        expect(result.suggestions).toHaveLength(3);
      } finally {
        delete global.localStorage;
        _resetCustomAiClientForTesting();
      }
    });

    it('returns null from sanitizeAiRequestSuggestions for wrong-shape payloads', () => {
      expect(sanitizeAiRequestSuggestions(null)).toBe(null);
      expect(sanitizeAiRequestSuggestions('nope')).toBe(null);
      expect(
        sanitizeAiRequestSuggestions({ suggestions: 'not-an-array' })
      ).toBe(null);
      expect(sanitizeAiRequestSuggestions({ suggestions: [] })).toBe(null);
      expect(
        sanitizeAiRequestSuggestions({
          suggestions: [{ title: 'Only title' }],
        })
      ).toBe(null);
      expect(
        sanitizeAiRequestSuggestions({
          explanationMessage: 'Next:',
          suggestions: [{ title: 'T', suggestedMessage: 42 }],
        })
      ).toBe(null);
    });

    it('passes through well-formed suggestions from sanitizeAiRequestSuggestions', () => {
      const result = sanitizeAiRequestSuggestions({
        explanationMessage: ' Try this:  ',
        suggestions: [
          { title: ' Jump ', suggestedMessage: 'Add a jump action' },
        ],
      });
      expect(result).not.toBe(null);
      if (!result) return;
      expect(result.explanationMessage).toBe('Try this:');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].title).toBe('Jump');
      expect(result.suggestions[0].suggestedMessage).toBe('Add a jump action');
    });

    it('falls back to default suggestions when the model returns wrong-shape JSON', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Seed for wrong-shape suggestions',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'agent',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  explanationMessage: 'Try this next:',
                  suggestions: 'not-an-array',
                }),
              },
            },
          ],
        },
      });

      const result = await customGetAiRequestSuggestions(aiRequest.id);
      expect(result.suggestions).toHaveLength(3);
      const lastFromResult = result.output[result.output.length - 1];
      expect(lastFromResult.suggestions).toBeTruthy();
      expect(Array.isArray(lastFromResult.suggestions.suggestions)).toBe(true);
      expect(lastFromResult.suggestions.suggestions).toHaveLength(3);

      const cached = customGetAiRequest(aiRequest.id);
      const lastFromCache = cached.output[cached.output.length - 1];
      expect(lastFromCache.suggestions).toBeTruthy();
      expect(lastFromCache.suggestions.suggestions).toHaveLength(3);
    });

    it('falls back to default suggestions on the last message when the model returns malformed JSON', async () => {
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Seed reply' } }],
        },
      });
      const aiRequest = await customCreateAiRequest({
        userRequest: 'Seed for fallback suggestions',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'agent',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });

      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'not-json{{{' } }],
        },
      });

      const result = await customGetAiRequestSuggestions(aiRequest.id);
      expect(result.suggestions).toHaveLength(3);
      const lastFromResult = result.output[result.output.length - 1];
      expect(lastFromResult.suggestions).toBeTruthy();
      expect(lastFromResult.suggestions.suggestions).toHaveLength(3);

      const cached = customGetAiRequest(aiRequest.id);
      const lastFromCache = cached.output[cached.output.length - 1];
      expect(lastFromCache.suggestions).toBeTruthy();
    });

    it('generates event changes with customCreateAiGeneratedEvent', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n[{"type":"add_events","events":[{"type":"BuiltinCommonInstructions::Standard","conditions":[],"actions":[]}]}]\n```',
              },
            },
          ],
        },
      });

      const result = await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Move player right when key pressed',
        eventBatches: null,
        extensionNamesList: '',
        objectsList: 'Player',
        existingEventsAsText: '',
      });

      expect(result.creationSucceeded).toBe(true);
      if (result.creationSucceeded) {
        expect(result.aiGeneratedEvent.changes.length).toBeGreaterThan(0);
      }
    });

    it('compacts oversized existing events to the model context budget', async () => {
      // A big scene's event text alone can exceed a small local model's
      // window: sent verbatim, the request fails over-window and the whole
      // generation is lost. The existing events are compacted to fit.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.2',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  operationName: 'insert',
                  generatedEvents: '[]',
                }),
              },
            },
          ],
        },
      });

      const result = await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Move player right when key pressed',
        eventBatches: null,
        extensionNamesList: '',
        objectsList: 'Player',
        existingEventsAsText: 'Condition: key pressed. Action: move.\n'.repeat(
          3000
        ),
      });

      expect(result.creationSucceeded).toBe(true);
      const sentContent = axios.post.mock.calls[0][1].messages[1].content;
      // llama3.2 input budget is 4096 tokens for the whole prompt.
      expect(
        estimateMessagesTokens([{ role: 'user', content: sentContent }])
      ).toBeLessThanOrEqual(4096);
      expect(sentContent).toContain('truncated to fit the model');
    });

    it('sends normal-size existing events untouched', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  operationName: 'insert',
                  generatedEvents: '[]',
                }),
              },
            },
          ],
        },
      });

      await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Move player right when key pressed',
        eventBatches: null,
        extensionNamesList: '',
        objectsList: 'Player',
        existingEventsAsText: 'Condition: key pressed.',
      });

      const sentContent = axios.post.mock.calls[0][1].messages[1].content;
      expect(sentContent).toContain('Condition: key pressed.');
      expect(sentContent).not.toContain('truncat');
    });

    it('coerces malformed array/object fields instead of passing them through', async () => {
      // The array-typed fields are model-authored, and the editor calls
      // `.join` on `diagnosticLines` and iterates `extensionNames`. A truthy
      // non-array (a string, a number) used to pass through `X || []` and threw
      // in the consumer, losing the whole generation result.
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  operationName: 'insert',
                  generatedEvents: '[]',
                  diagnosticLines: 'a single line, not an array',
                  extensionNames: 'ExtensionA',
                  undeclaredVariables: 42,
                  undeclaredObjectVariables: 'nope',
                  missingObjectBehaviors: ['an', 'array'],
                  missingResources: true,
                }),
              },
            },
          ],
        },
      });

      const result = await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Do something',
      });

      expect(result.creationSucceeded).toBe(true);
      if (result.creationSucceeded) {
        const [change]: any = result.aiGeneratedEvent.changes;
        expect(change.diagnosticLines).toEqual([]);
        expect(change.extensionNames).toEqual([]);
        expect(change.undeclaredVariables).toEqual([]);
        expect(change.undeclaredObjectVariables).toEqual({});
        expect(change.missingObjectBehaviors).toEqual({});
        expect(change.missingResources).toEqual([]);
        // The consumer's call must not throw.
        expect(() => change.diagnosticLines.join('\n')).not.toThrow();
      }
    });

    it('fails with a clear error when the model response is not JSON', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Sorry, I cannot help with that request.',
              },
            },
          ],
        },
      });

      const result = await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Move player right',
      });

      expect(result.creationSucceeded).toBe(false);
      if (!result.creationSucceeded) {
        expect(result.errorMessage).toContain('could not be parsed as JSON');
      }
    });

    it('fails when generatedEvents is not a JSON list of events', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n{"operationName":"insert","generatedEvents":"not-a-json-array"}\n```',
              },
            },
          ],
        },
      });

      const result = await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Move player right',
      });

      expect(result.creationSucceeded).toBe(false);
      if (!result.creationSucceeded) {
        expect(result.errorMessage).toContain('generatedEvents');
      }
    });

    it('accepts a generatedEvents JSON string array payload', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n{"operationName":"insert","generatedEvents":' +
                  JSON.stringify(
                    JSON.stringify([
                      { type: 'BuiltinCommonInstructions::Standard' },
                    ])
                  ) +
                  '}\n```',
              },
            },
          ],
        },
      });

      const result = await customCreateAiGeneratedEvent({
        sceneName: 'MainScene',
        eventsDescription: 'Move player right',
      });

      expect(result.creationSucceeded).toBe(true);
      if (result.creationSucceeded) {
        const change = result.aiGeneratedEvent.changes[0];
        expect(JSON.parse(change.generatedEvents)).toEqual([
          { type: 'BuiltinCommonInstructions::Standard' },
        ]);
      }
    });

    it('provides empty asset and resource search results in BYOK mode', async () => {
      const assetResult = await customCreateAssetSearch({
        searchTerms: 'coin',
        objectType: 'Sprite',
      });
      expect(assetResult.id).toMatch(/^local-asset-/);
      expect(assetResult.userId).toBe(LOCAL_BYOK_USER_ID);
      expect(assetResult.results).toEqual([]);

      const resourceResult = await customCreateResourceSearch({
        searchTerms: 'jump sound',
        resourceKind: 'audio',
      });
      expect(resourceResult.id).toMatch(/^local-resource-/);
      expect(resourceResult.userId).toBe(LOCAL_BYOK_USER_ID);
      expect(resourceResult.results).toEqual([]);
    });
  });

  describe('Concurrent local model turns', () => {
    /** A completion that answers after `delayMs` with a distinct message. */
    const answerAfter = (content: string, delayMs: number) => {
      axios.post.mockImplementationOnce(
        () =>
          new Promise(resolve =>
            setTimeout(
              () =>
                resolve({
                  status: 200,
                  data: {
                    choices: [{ message: { role: 'assistant', content } }],
                  },
                }),
              delayMs
            )
          )
      );
    };

    const createRequest = async (userRequest: string) => {
      answerAfter('ok', 0);
      return customCreateAiRequest({
        userRequest,
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'agent',
        aiConfiguration: { presetId: 'default' },
        gameId: null,
      });
    };

    it('serializes two concurrent turns on one request without losing a write', async () => {
      const aiRequest = await createRequest('Start');

      // The first turn is slow; the second starts while it is still answering.
      answerAfter('first answer', 20);
      const firstTurn = customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: '',
        functionCallOutputs: [
          { type: 'function_call_output', call_id: 'call-1', output: '{}' },
        ],
      });
      answerAfter('second answer', 0);
      const secondTurn = customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: '',
        functionCallOutputs: [
          { type: 'function_call_output', call_id: 'call-2', output: '{}' },
        ],
      });

      const [firstResult, secondResult] = await Promise.all([
        firstTurn,
        secondTurn,
      ]);

      const finalRequest = await customGetAiRequest(aiRequest.id);
      const assistantTexts = (finalRequest.output || [])
        .filter(
          message => message.type === 'message' && message.role === 'assistant'
        )
        .map(message => (message: any).text || '');

      // Both answers are present: the second turn did not overwrite the first.
      expect(assistantTexts).toContain('first answer');
      expect(assistantTexts).toContain('second answer');
      // Both tool results are present too.
      const outputCallIds = (finalRequest.output || [])
        .filter(message => message.type === 'function_call_output')
        .map(message => (message: any).call_id);
      expect(outputCallIds).toEqual(
        expect.arrayContaining(['call-1', 'call-2'])
      );
      // Each turn's own return value carries its own answer.
      expect(
        firstResult.output ? firstResult.output.length : 0
      ).toBeGreaterThan(0);
      expect(
        secondResult.output ? secondResult.output.length : 0
      ).toBeGreaterThan(0);
    });

    it('does not block concurrent turns on different requests', async () => {
      const firstRequest = await createRequest('One');
      const secondRequest = await createRequest('Two');

      answerAfter('slow answer', 20);
      const slowTurn = customAddMessageToAiRequest({
        aiRequestId: firstRequest.id,
        userMessage: '',
        functionCallOutputs: [],
      });
      answerAfter('fast answer', 0);
      const fastTurn = customAddMessageToAiRequest({
        aiRequestId: secondRequest.id,
        userMessage: '',
        functionCallOutputs: [],
      });

      // The fast one resolves while the slow one is still waiting.
      await fastTurn;
      await slowTurn;

      const first = await customGetAiRequest(firstRequest.id);
      const second = await customGetAiRequest(secondRequest.id);
      expect(JSON.stringify(first.output || '').includes('slow answer')).toBe(
        true
      );
      expect(JSON.stringify(second.output || '').includes('fast answer')).toBe(
        true
      );
    });

    it('keeps a suspension that lands during an in-flight turn', async () => {
      const aiRequest = await createRequest('Suspend me');

      answerAfter('answer after suspend', 20);
      const turn = customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: '',
        functionCallOutputs: [],
      });

      // Suspend while the model is answering.
      customSuspendAiRequest(aiRequest.id);
      await turn;

      const finalRequest = await customGetAiRequest(aiRequest.id);
      // The turn write-back must not resume a suspended request.
      expect(finalRequest.status).toBe('suspended');
      // The answer the model produced is still readable.
      expect(JSON.stringify(finalRequest.output || '')).toContain(
        'answer after suspend'
      );
    });

    it('resumes a stopped request when the user sends another message', async () => {
      const aiRequest = await createRequest('Stop then continue');
      customSuspendAiRequest(aiRequest.id);
      expect((await customGetAiRequest(aiRequest.id)).status).toBe('suspended');

      answerAfter('resumed answer', 0);
      const resumed = await customAddMessageToAiRequest({
        aiRequestId: aiRequest.id,
        userMessage: 'keep going',
        functionCallOutputs: [],
      });

      // The explicit send must clear the stop, or RequestWriteGate and
      // suggestions stay blocked forever behind "Stopped. Ready when you are."
      expect(resumed.status).toBe('ready');
      expect((await customGetAiRequest(aiRequest.id)).status).toBe('ready');
      expect(JSON.stringify(resumed.output || '')).toContain('resumed answer');
      expect(JSON.stringify(resumed.output || '')).toContain('keep going');
    });
  });

  describe('withLocalAiTurnLock', () => {
    it('serializes turns for the same request', async () => {
      const order = [];
      const first = withLocalAiTurnLock('lock-req-1', async () => {
        order.push('first-start');
        await new Promise(resolve => setTimeout(resolve, 20));
        order.push('first-end');
      });
      const second = withLocalAiTurnLock('lock-req-1', async () => {
        order.push('second');
      });
      await Promise.all([first, second]);
      // The second turn must not start until the first released the lock.
      expect(order).toEqual(['first-start', 'first-end', 'second']);
    });

    it('does not block a different request', async () => {
      const order = [];
      let releaseFirst;
      const first = withLocalAiTurnLock('lock-req-2', async () => {
        order.push('held-start');
        await new Promise(resolve => {
          releaseFirst = resolve;
        });
        order.push('held-end');
      });
      // Let the first acquire the lock before queueing the other request.
      await new Promise(resolve => setTimeout(resolve, 5));
      const other = withLocalAiTurnLock('lock-req-3', async () => {
        order.push('other');
      });
      await other;
      expect(order).toEqual(['held-start', 'other']);
      releaseFirst();
      await first;
      expect(order).toEqual(['held-start', 'other', 'held-end']);
    });

    it('releases the lock when the turn throws, so a queued turn still runs', async () => {
      // A turn queued WHILE the throwing one holds the lock is the case that
      // deadlocks if the failure path skips `release`: it waits on a tail that
      // never settles.
      const order = [];
      const failing = withLocalAiTurnLock('lock-req-4', async () => {
        order.push('failing');
        throw new Error('turn failed');
      }).catch(() => order.push('caught'));
      const queued = withLocalAiTurnLock('lock-req-4', async () => {
        order.push('queued');
      });

      const winner = await Promise.race([
        queued.then(() => 'queued-ran'),
        new Promise(resolve => setTimeout(() => resolve('timed-out'), 500)),
      ]);
      await failing;
      expect(winner).toBe('queued-ran');
      expect(order).toEqual(['failing', 'caught', 'queued']);
    });
  });

  describe('Studio sub-agent role enforcement', () => {
    /** Mock one assistant reply so a turn completes. */
    const mockAssistantReply = (content: string) => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content } }] },
      });
    };

    const spawnTester = async () => {
      mockAssistantReply('Spawned.');
      return customCreateSubAgentAiRequest({
        parentAiRequestId: 'local-ai-parent',
        roleId: 'tester',
        userRequest: 'Verify the grid.',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        spawnContextNote: null,
      });
    };

    const sentToolNames = (callIndex: number) => {
      // $FlowFixMe
      const body = axios.post.mock.calls[callIndex][1];
      return {
        names: (body.tools || []).map(tool => tool.function.name),
        systemPrompt: body.messages[0].content,
      };
    };

    it('offers a spawned sub-agent only its role tools and prompt', async () => {
      await spawnTester();
      const { names, systemPrompt } = sentToolNames(0);
      const testerToolNames = getToolsForRole(
        'tester',
        GDEVELOP_OPENAI_TOOLS
      ).map(tool => tool.function.name);
      expect(names.length).toBeGreaterThan(0);
      names.forEach(name => expect(testerToolNames).toContain(name));
      expect(systemPrompt).toContain('QA tester');
    });

    it('keeps the role tool subset and prompt on later turns', async () => {
      const child = await spawnTester();

      // A second turn - the critical regression: pre-fix this offered all the
      // tools and dropped the role prompt.
      mockAssistantReply('Done.');
      await customAddMessageToAiRequest({
        aiRequestId: child.id,
        userMessage: '',
        functionCallOutputs: [],
      });

      const { names, systemPrompt } = sentToolNames(1);
      const testerToolNames = getToolsForRole(
        'tester',
        GDEVELOP_OPENAI_TOOLS
      ).map(tool => tool.function.name);
      expect(names.length).toBeGreaterThan(0);
      names.forEach(name => expect(testerToolNames).toContain(name));
      expect(systemPrompt).toContain('QA tester');
    });

    it('fails closed to the read-only toolset for an unrecognized creation role', async () => {
      // getToolsForRole throws on an unknown id, which is deliberate: a role
      // that is meant to be read-only must not silently gain mutations. The
      // creation path fails closed to the read-only subset instead of throwing
      // or handing over every tool.
      mockAssistantReply('Spawned.');
      await customCreateSubAgentAiRequest({
        parentAiRequestId: 'local-ai-parent',
        roleId: 'not-a-role',
        userRequest: 'Do something.',
        gameProjectJson: null,
        projectSpecificExtensionsSummaryJson: null,
        spawnContextNote: null,
      });

      const { names, systemPrompt } = sentToolNames(0);
      expect(names.length).toBeGreaterThan(0);
      // The contract is the security property, not a specific list: nothing
      // offered may be a tool that mutates the project, and everything offered
      // is a declared read-only one.
      names.forEach(name => expect(MUTATING_TOOL_NAMES).not.toContain(name));
      names.forEach(name => expect(READ_ONLY_TOOL_NAMES).toContain(name));
      // No role prompt is invented for an unknown role.
      expect(systemPrompt).not.toContain('QA tester');
    });

    it('keeps a read-only toolset on later turns of a corrupted-role sub-agent', async () => {
      // A persisted sub-agent whose studioRoleId is stale (a role renamed or
      // removed) must not throw mid-turn, nor regain the mutating tools on its
      // next turn. Seed the local cache the way a reload would.
      global.localStorage = {
        getItem: key =>
          key === 'gd-custom-ai-requests'
            ? JSON.stringify({
                'local-ai-child': {
                  id: 'local-ai-child',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                  userId: LOCAL_BYOK_USER_ID,
                  status: 'ready',
                  mode: 'agent',
                  parentAiRequestId: 'local-ai-parent',
                  studioRoleId: 'legacy-role-that-no-longer-exists',
                  error: null,
                  output: [],
                },
              })
            : null,
        setItem: () => {},
        removeItem: () => {},
      };
      _resetCustomAiClientForTesting();
      loadLocalAiRequests();
      try {
        mockAssistantReply('Continued.');

        // Must not throw, and must not offer a mutating tool.
        await customAddMessageToAiRequest({
          aiRequestId: 'local-ai-child',
          userMessage: 'keep going',
          functionCallOutputs: [],
        });

        const { names } = sentToolNames(0);
        expect(names.length).toBeGreaterThan(0);
        names.forEach(name => expect(MUTATING_TOOL_NAMES).not.toContain(name));
        expect(names).not.toContain('create_scene');
        expect(names).not.toContain('run_script');
      } finally {
        delete global.localStorage;
      }
    });

    it('writes a mutated request through to the cache', async () => {
      const child = await spawnTester();
      const before = (child.output || []).length;
      const marker: any = {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            status: 'completed',
            text: 'marker',
            annotations: [],
          },
        ],
        messageId: 'msg-marker',
      };
      customUpdateAiRequest({
        ...child,
        output: [...(child.output || []), marker],
      });
      expect(customGetAiRequest(child.id).output.length).toBe(before + 1);
    });
  });

  describe('local answers use the type the chat renders', () => {
    it('emits output_text, not text, for the assistant answer', () => {
      // ChatMessages renders only `output_text` and `reasoning`, and
      // RenderItem's messageContent union admits only those two. The local
      // parser emitted `text`, which hit `return null` — the assistant's own
      // answer rendered as nothing at all in a BYOK chat.
      const message = parseAssistantMessage({
        role: 'assistant',
        content: 'Here is the answer.',
      });
      expect(message.content).toHaveLength(1);
      expect(message.content[0].type).toBe('output_text');
      expect(message.content[0].text).toBe('Here is the answer.');
      // The union the renderer uses does not include 'text' at all.
      expect(message.content.some(item => item.type === 'text')).toBe(false);
    });

    it('keeps the plain-text top-level field as well', () => {
      // FinalizeSubAgents falls back to message.text, so it must stay.
      const message = parseAssistantMessage({
        role: 'assistant',
        content: 'Report body.',
      });
      expect(message.text).toBe('Report body.');
    });
  });

  describe('reasoning is emitted as rendered content', () => {
    it('puts the reasoning entry before the answer text', () => {
      // The chat renders content in order and the chat UI's `reasoning`
      // branch was unreachable: parseAssistantMessage extracted `thinking`
      // into a top-level field no component read, so a reasoning model's chain
      // of thought was discarded.
      const message = parseAssistantMessage({
        role: 'assistant',
        content: 'Here is the answer.',
        reasoning_content: 'Let me plan the scene.',
      });
      expect(message.content).toHaveLength(2);
      expect(message.content[0]).toEqual({
        type: 'reasoning',
        status: 'completed',
        summary: { text: 'Let me plan the scene.', type: 'summary_text' },
      });
      expect(message.content[1]).toEqual({
        // 'output_text' is what ChatMessages renders and what RenderItem
        // admits; 'text' was handled by no branch, so the answer vanished.
        type: 'output_text',
        status: 'completed',
        text: 'Here is the answer.',
        annotations: [],
      });
    });

    it('reads a think block as reasoning content too', () => {
      // Build the tag from char codes: the file's own fixtures do, so the
      // literal angle bracket cannot be lost in transit.
      const open = String.fromCharCode(60) + 'think>';
      const close = String.fromCharCode(60) + '/think>';
      const message = parseAssistantMessage({
        role: 'assistant',
        content: open + 'Working it out.' + close + 'Result.',
      });
      expect(message.content[0].type).toBe('reasoning');
      expect(message.content[0].summary.text).toBe('Working it out.');
      expect(message.content[1]).toEqual({
        type: 'output_text',
        status: 'completed',
        text: 'Result.',
        annotations: [],
      });
    });

    it('emits no reasoning entry for a plain answer', () => {
      const message = parseAssistantMessage({
        role: 'assistant',
        content: 'Just an answer.',
      });
      expect(
        message.content.filter(item => item.type === 'reasoning')
      ).toHaveLength(0);
      expect(message.content).toHaveLength(1);
    });

    it('still emits a reasoning entry when the answer is empty', () => {
      // A reasoner that stopped after thinking: the thinking is the turn's
      // only visible content, so it must not be dropped.
      const message = parseAssistantMessage({
        role: 'assistant',
        content: '',
        reasoning_content: 'Only thinking here.',
      });
      expect(message.content).toHaveLength(1);
      expect(message.content[0].type).toBe('reasoning');
    });
  });

  describe('the embedded-JSON fallback tool list', () => {
    it('names only tools the registry actually declares', () => {
      // Regression: three entries were `describe_*` names that the registry
      // does not declare (it calls them read_events_source,
      // inspect_scene_properties_layers_effects, inspect_variables), so a
      // model that emitted one of those calls as a JSON block got no tool
      // executed at all. Every entry must match a declared name exactly.
      const declared = new Set(
        GDEVELOP_OPENAI_TOOLS.map(tool => tool.function.name)
      );
      const missing = [...SIDE_EFFECT_FREE_TOOLS].filter(
        name => !declared.has(name)
      );
      expect(missing).toEqual([]);
    });

    it('lists no tool that mutates the project', () => {
      // The fallback is for calls the model wrote as text, so it must never
      // reach a mutating tool.
      for (const name of SIDE_EFFECT_FREE_TOOLS) {
        expect(
          name.startsWith('inspect_') ||
            name.startsWith('read_') ||
            name.startsWith('search_') ||
            name === 'describe_instances' ||
            name === 'get_game_starter_summary'
        ).toBe(true);
      }
    });
  });

  describe('the connection test requires a real answer', () => {
    it('does not report success when the model answered with no text', async () => {
      // A completion with no text (reasoning-only model, or a bare body)
      // proves nothing about the endpoint; calling it a successful connection
      // sends the user off with a broken setup.
      // $FlowFixMe
      axios.get.mockRejectedValueOnce(new Error('404'));
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: '' } }] },
      });

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('no text');
    });

    it('reports success with the model text when it answers', async () => {
      // $FlowFixMe
      axios.get.mockRejectedValueOnce(new Error('404'));
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'OK' } }] },
      });

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('OK');
    });

    it('returns a failure object when the probe rejects with no reason', async () => {
      // $FlowFixMe
      axios.get.mockRejectedValueOnce(new Error('404'));
      // $FlowFixMe
      axios.post.mockRejectedValueOnce(undefined);

      const result = await testConnection({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });

      expect(result.success).toBe(false);
      // The friendly fallback, not the raw TypeError the unguarded catch
      // produced ("Cannot read properties of undefined (reading 'response')").
      expect(result.message).toContain('Connection failed');
      expect(result.message).toContain('AI request failed');
    });
  });

  describe('a streamed error chunk', () => {
    it("fails the turn with the server's own reason", async () => {
      // A server can explain a mid-stream failure in an error chunk. Ignoring
      // it left only the generic "connection may have been dropped" message
      // for a failure the server had already described.
      const encoder = new TextEncoder();
      const sse =
        'data: ' +
        JSON.stringify({ error: { message: 'model unloaded from memory' } }) +
        '\n' +
        'data: [DONE]\n';
      let readCount = 0;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(sse) };
              }
              return { done: true, value: undefined };
            },
          }),
        },
      });

      let thrownMessage = '';
      try {
        await sendChatCompletion({
          messages: [{ role: 'user', content: 'hi' }],
          config: {
            enabled: true,
            baseUrl: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'qwen2.5-coder',
            temperature: 0.7,
            streaming: true,
          },
        });
      } catch (error) {
        thrownMessage = error.message;
      }

      expect(thrownMessage).toContain('model unloaded from memory');
      expect(thrownMessage).not.toContain('dropped mid-stream');
    });
  });

  describe('a 200 response carrying an error body', () => {
    it('fails the turn instead of recording an empty answer', async () => {
      // Some servers report model failures with HTTP 200 and an error body.
      // Returning it as a message made the turn look successful: the parser
      // found no content, so an empty assistant reply was stored and the user
      // got neither an error nor a retry.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { error: { message: 'model is loading, try again' } },
      });

      const created = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });

      // The turn is an error, with the server's own message, not a blank reply.
      expect(created.status).toBe('error');
      expect(created.error && created.error.message).toContain(
        'model is loading, try again'
      );
      const assistantMessages = (created.output || []).filter(
        message => message.role === 'assistant'
      );
      expect(assistantMessages).toHaveLength(0);
    });

    it('still accepts a normal completion body', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });
      expect(created.status).toBe('ready');
    });
  });

  describe('context occupancy is the latest prompt, not the running cost', () => {
    it('tracks the most recent prompt size while tokens total keeps growing', async () => {
      // The gauge reports how full the window is NOW, so it must read the last
      // prompt's size. The cost meter is cumulative — dividing it by a
      // per-request budget would inflate every turn and describe nothing.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const created = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });
      const firstPrompt = customGetAiRequestContextTokens(created.id);
      const firstTotal = customGetAiRequestTokenTotal(created.id);
      expect(firstPrompt).toBeGreaterThan(0);

      await customAddMessageToAiRequest({
        aiRequestId: created.id,
        // Long enough to dominate any constant-term shift between turns
        // (e.g. the offered toolset shrinking by one entry): the test pins
        // that occupancy follows conversation size.
        userMessage:
          'a second, much longer user message to grow the prompt. ' +
          'Filler text so the growth dwarfs constant shifts. '.repeat(30),
      });

      const secondPrompt = customGetAiRequestContextTokens(created.id);
      const secondTotal = customGetAiRequestTokenTotal(created.id);

      // Occupancy grows with the conversation...
      expect(secondPrompt).toBeGreaterThan(firstPrompt);
      // ...and remains distinct from the cumulative cost meter, which carries
      // every turn's prompt and answer. Using the total as the numerator would
      // make the gauge climb forever.
      expect(secondTotal).toBeGreaterThan(secondPrompt);
      expect(secondTotal).toBeGreaterThan(firstTotal);
    });

    it('is zero for a request with no turns', () => {
      expect(customGetAiRequestContextTokens('local-ai-never-ran')).toBe(0);
    });

    it('counts the tool schema sent with the turn, not only the messages', async () => {
      // The tool schema (~6.5k tokens) rides every request: a messages-only
      // numerator understated occupancy ~2x on small windows, so the gauge
      // stayed quiet while the trimmer silently compacted.
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
      });
      // $FlowFixMe
      axios.post.mockResolvedValue({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const created = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });
      expect(
        customGetAiRequestContextTokens(created.id)
      ).toBeGreaterThanOrEqual(estimateToolsTokens(GDEVELOP_OPENAI_TOOLS));
    });
  });

  describe('local cost meter counts reasoning output', () => {
    it('bills a streamed chain of thought, not only the answer', async () => {
      // Differential: run the same create twice, once with a reasoning delta
      // and once without. The prompt (a ~220-token system message) dominates
      // the absolute total, so only the *difference* proves reasoning is
      // billed — a flat threshold passed with and without the fix.
      const runCreate = async (withReasoning: boolean) => {
        const encoder = new TextEncoder();
        const reasoningText = 'Reasoning '.repeat(40); // ~100 tokens
        const lines = [];
        if (withReasoning) {
          lines.push(
            'data: ' +
              JSON.stringify({
                choices: [{ delta: { reasoning_content: reasoningText } }],
              }) +
              '\n'
          );
        }
        lines.push(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: 'Done.' } }] }) +
            '\n',
          'data: ' +
            JSON.stringify({
              choices: [{ delta: {}, finish_reason: 'stop' }],
            }) +
            '\n',
          'data: [DONE]\n'
        );
        const sse = lines.join('');
        let readCount = 0;
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: { get: () => 'text/event-stream' },
          body: {
            getReader: () => ({
              read: async () => {
                readCount += 1;
                if (readCount === 1) {
                  return { done: false, value: encoder.encode(sse) };
                }
                return { done: true, value: undefined };
              },
            }),
          },
        });
        const created = await customCreateAiRequest({
          userRequest: 'start',
          mode: 'chat',
        });
        return {
          total: customGetAiRequestTokenTotal(created.id),
          reasoningTokens: estimateTokens(reasoningText),
        };
      };

      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'deepseek-r1',
        temperature: 0.7,
        streaming: true,
      });

      const withReasoning = await runCreate(true);
      const without = await runCreate(false);

      // Identical prompt and answer: the only difference is the chain of
      // thought, which must be billed.
      expect(withReasoning.total - without.total).toBe(
        withReasoning.reasoningTokens
      );
    });

    it('still counts a plain answer with no reasoning', async () => {
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [
            { message: { role: 'assistant', content: 'x'.repeat(400) } },
          ],
        },
      });
      const created = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });
      expect(customGetAiRequestTokenTotal(created.id)).toBeGreaterThan(
        estimateTokens('x'.repeat(400))
      );
    });
  });

  describe('message estimate counts whole tool calls', () => {
    it('charges the tool name and call id, not only the arguments', () => {
      // A tool call costs more than its arguments: the model also receives the
      // name and id. Counting only arguments under-reported a 30-exchange
      // transcript by ~80%, so the prompt read as inside the budget while it
      // was over it.
      const message = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_abcdefghij',
            type: 'function',
            function: {
              name: 'change_scene_properties_layers_effects_groups',
              arguments: '{"a":1}',
            },
          },
        ],
      };
      const argumentsOnly = estimateTokens('{"a":1}');
      const estimate = estimateMessagesTokens([message]);
      expect(estimate).toBeGreaterThan(argumentsOnly);
      // The name alone is longer than the arguments here, so the difference is
      // substantial rather than a rounding detail.
      expect(estimate).toBe(
        estimateTokens('call_abcdefghij') +
          estimateTokens('change_scene_properties_layers_effects_groups') +
          argumentsOnly
      );
    });

    it('charges the call id echoed back on a tool reply', () => {
      const toolReply = {
        role: 'tool',
        tool_call_id: 'call_abcdefghij',
        content: '{"ok":true}',
      };
      expect(estimateMessagesTokens([toolReply])).toBe(
        estimateTokens('{"ok":true}') + estimateTokens('call_abcdefghij')
      );
    });

    it('counts a partial tool call and tolerates a null entry', () => {
      // $FlowFixMe deliberately malformed entries for the guards. A call with
      // only an id still costs that id; a null entry costs nothing and must
      // not throw.
      expect(
        estimateMessagesTokens([
          { role: 'assistant', content: null, tool_calls: [null] },
        ])
      ).toBe(0);
      expect(
        estimateMessagesTokens([
          { role: 'assistant', content: null, tool_calls: [{ id: 'c1' }] },
        ])
      ).toBe(estimateTokens('c1'));
    });
  });

  describe('output allowance in the context budget', () => {
    const base = {
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      temperature: 0.7,
    };

    it('reserves half the window when no maxTokens is set', () => {
      // qwen -> 32768 window; the conservative default still holds half back.
      expect(getTokenBudget({ ...base, model: 'qwen2.5-coder' })).toBe(16384);
      expect(getTokenBudget({ ...base, model: 'llama3.2' })).toBe(4096);
    });

    it('reserves exactly maxTokens when the user capped the reply', () => {
      // A 512-token cap must not hold back 16384 tokens of a 32768 window.
      expect(
        getTokenBudget({ ...base, model: 'qwen2.5-coder', maxTokens: 512 })
      ).toBe(32768 - 512);
      expect(
        getTokenBudget({ ...base, model: 'llama3.2', maxTokens: 256 })
      ).toBe(8192 - 256);
    });

    it('never reserves more than half the window, however large maxTokens is', () => {
      // A cap beyond the window must not drive the input budget to zero (or
      // negative): the history would lose its system prompt entirely.
      expect(
        getTokenBudget({ ...base, model: 'llama3.2', maxTokens: 999999 })
      ).toBe(4096);
      expect(
        getTokenBudget({ ...base, model: 'qwen2.5-coder', maxTokens: 32768 })
      ).toBe(16384);
    });

    it('ignores a non-positive or non-numeric maxTokens', () => {
      expect(getTokenBudget({ ...base, model: 'llama3.2', maxTokens: 0 })).toBe(
        4096
      );
      expect(
        getTokenBudget({ ...base, model: 'llama3.2', maxTokens: -10 })
      ).toBe(4096);
      // $FlowFixMe deliberately malformed config for the guard.
      expect(
        getTokenBudget({ ...base, model: 'llama3.2', maxTokens: 'lots' })
      ).toBe(4096);
    });

    it('keeps a project structure the default half-window reserve would compact', async () => {
      // Size the structure to sit between the two budgets: it exceeds the
      // default reserve (16384 - tools) but fits the widened one
      // (32768 - 512 - tools). Pre-fix this always reported compaction.
      const qwen = { ...base, model: 'qwen2.5-coder' };
      const widened = { ...qwen, maxTokens: 512 };
      const structure = JSON.stringify({
        scenes: Array.from({ length: 90 }, (_, i) => ({
          name: 'Scene' + i,
          events: Array.from({ length: 8 }, (_, j) => ({
            type: 'Event' + j,
            code: 'x'.repeat(70),
          })),
        })),
      });
      const structureTokens = estimateTokens(structure);
      expect(structureTokens).toBeGreaterThan(
        getMessageBudget(qwen, GDEVELOP_OPENAI_TOOLS)
      );
      expect(structureTokens).toBeLessThan(
        getMessageBudget(widened, GDEVELOP_OPENAI_TOOLS)
      );

      setCustomEndpointConfig(widened);
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      const created = await customCreateAiRequest({
        userRequest: 'start',
        gameProjectJson: structure,
        projectSpecificExtensionsSummaryJson: null,
        mode: 'chat',
      });

      expect(axios.post.mock.calls[0][1].max_tokens).toBe(512);
      // The structure survived intact: the freed context was actually used.
      expect(customGetAiRequestSystemCompacted(created.id)).toBe(false);
    });
  });

  describe('history trimming decrements by real token cost', () => {
    it('does not over-drop history when a CJK message is compacted', () => {
      // Regression: compacting a message decremented the running estimate by
      // removedChars/4. A CJK message costs a full token per character (4800
      // chars ~ 4800 tokens), so after one compaction the loop's running
      // estimate still read 3734 while the real total was 528 — far above the
      // budget it had actually reached, so it kept dropping older history that
      // no longer needed to go.
      const cjkBody = '创建精灵对象并设置生命值'.repeat(400); // 4800 chars
      const messages = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: cjkBody },
        { role: 'user', content: 'old-1' },
        { role: 'user', content: 'old-2' },
        { role: 'user', content: 'newest-a' },
        { role: 'user', content: 'newest-b' },
      ];
      // Sits between the true post-compaction total (~528) and the pre-fix
      // inflated one (~3734): only the correct decrement stops here.
      const budget = 2131;

      const trimmed = trimMessagesToBudget(messages, budget);

      // Both old messages survive, because compacting the CJK message alone
      // brought the prompt under budget once its real cost was charged.
      expect(trimmed.some(m => m.content === 'old-1')).toBe(true);
      expect(trimmed.some(m => m.content === 'old-2')).toBe(true);
      expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(budget);
    });

    it('keeps only a bounded head of a compacted message', () => {
      // The newest exchange is protected, so the compacted message must sit
      // earlier in the list for the head-slicing path to run at all.
      const messages = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'x'.repeat(20000) },
        { role: 'user', content: 'middle' },
        { role: 'user', content: 'newest' },
      ];
      const trimmed = trimMessagesToBudget(messages, 200);
      const assistant = trimmed.find(m => m.role === 'assistant');
      expect(assistant.content).toContain('trimmed:');
      // The kept head is a token budget (~125 tokens), not a 500-char slice.
      expect(estimateTokens(assistant.content)).toBeLessThan(300);
    });
  });

  describe('history trimming tolerates a hole in the message list', () => {
    it('trims a list containing a null entry without throwing', () => {
      // estimateMessagesTokens and the isProtected guard both already skip a
      // null message; the keep/drop loop dereferenced it unguarded, so the
      // same input crashed the trim the rest of the function tolerated.
      const messages = [
        { role: 'system', content: 'sys' },
        null,
        { role: 'assistant', content: 'x'.repeat(9000) },
        { role: 'user', content: 'middle' },
        { role: 'user', content: 'newest' },
      ];
      // $FlowFixMe deliberately malformed list for the guard.
      const trimmed = trimMessagesToBudget(messages, 300);
      expect(Array.isArray(trimmed)).toBe(true);
      expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(300);
      // The newest exchange is still there.
      expect(trimmed.some(m => m && m.content === 'newest')).toBe(true);
    });

    it('does not crash when the null follows a dropped tool_calls assistant', () => {
      // The guard at the top is `message && message.role === 'system'`, and the
      // null-skip in estimateMessagesTokens, but the dropToolOutputs branch
      // dereferenced message.role directly. Reaching it needs the drop to have
      // started on an earlier assistant, which is why a plain hole mid-list
      // did not reproduce it.
      const messages = [
        { role: 'system', content: 'sys' },
        {
          role: 'assistant',
          content: 'calling a tool',
          tool_calls: [{ id: 'c1', function: { name: 'f', arguments: '{}' } }],
        },
        null,
        { role: 'user', content: 'newest-a' },
        { role: 'user', content: 'newest-b' },
      ];
      // $FlowFixMe deliberately malformed list for the guard.
      expect(() => trimMessagesToBudget(messages, 5)).not.toThrow();
    });
  });

  describe('compaction honours the budget in non-Latin scripts', () => {
    it('caps a CJK system prompt at its token budget, not 4x it', () => {
      // Regression: estimateTokens counted CJK as one token per character (so
      // ~4x the old flat rate) while the truncation still converted the token
      // budget back to characters with a flat * 4 — a "capped" Chinese prompt
      // came out four times over the budget it was capped for.
      const budget = 400;
      const cjk = '创建精灵对象并设置生命值'.repeat(200); // far over budget
      const messages = [
        { role: 'system', content: 'Current Project Structure:\n' + cjk },
        { role: 'user', content: 'hi' },
      ];

      const compacted = compactSystemMessageToBudget(messages, budget);
      const system = compacted.find(m => m.role === 'system');
      expect(system).toBeTruthy();
      expect(estimateTokens(system.content)).toBeLessThanOrEqual(
        budget -
          256 +
          estimateTokens(
            '\n[... project structure truncated to fit the model context window ...]\n'
          ) +
          1
      );
      // The truncation note must actually have been applied.
      expect(system.content).toContain('truncated to fit the model context');
    });

    it('still compacts ASCII to its budget after the script-aware change', () => {
      const budget = 400;
      const ascii = 'x'.repeat(8000);
      const messages = [
        { role: 'system', content: 'Current Project Structure:\n' + ascii },
        { role: 'user', content: 'hi' },
      ];
      const compacted = compactSystemMessageToBudget(messages, budget);
      const system = compacted.find(m => m.role === 'system');
      expect(system.content).toContain('truncated to fit the model context');
      expect(estimateTokens(system.content)).toBeLessThanOrEqual(budget);
    });

    it('leaves a prompt that fits the budget untouched', () => {
      const messages = [
        { role: 'system', content: 'short system prompt' },
        { role: 'user', content: 'hi' },
      ];
      expect(compactSystemMessageToBudget(messages, 400)).toBe(messages);
    });
  });

  describe('tool schema counts against the context budget', () => {
    const llamaConfig = {
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      // llama family -> 8192 window -> 4096-token budget before tools.
      model: 'llama3.2',
      temperature: 0.7,
    };

    it('estimates the built-in toolset in the thousands of tokens', () => {
      const toolsTokens = estimateToolsTokens(GDEVELOP_OPENAI_TOOLS);
      expect(toolsTokens).toBeGreaterThan(4096);
    });

    it('subtracts the tools from the messages budget', () => {
      // qwen -> 32768 window -> 16384 budget, comfortably above the schema, so
      // the subtraction is observable without hitting the floor.
      const qwenConfig = { ...llamaConfig, model: 'qwen2.5-coder' };
      expect(getTokenBudget(qwenConfig)).toBe(16384);
      expect(getMessageBudget(qwenConfig, GDEVELOP_OPENAI_TOOLS)).toBe(
        16384 - estimateToolsTokens(GDEVELOP_OPENAI_TOOLS)
      );
    });

    it('keeps a usable floor when the tools cannot fit the window', () => {
      // A llama window (4096 budget) is smaller than the tool schema. The
      // budget must not collapse to zero: that would strip the system prompt
      // and all history, which is worse than an oversized request the server
      // reports normally.
      expect(getMessageBudget(llamaConfig, GDEVELOP_OPENAI_TOOLS)).toBe(1024);
    });

    it('is unchanged when no tools are sent', () => {
      expect(getMessageBudget(llamaConfig, [])).toBe(
        getTokenBudget(llamaConfig)
      );
      expect(getMessageBudget(llamaConfig)).toBe(getTokenBudget(llamaConfig));
    });

    it('leaves room for the tools on a model that can hold them', async () => {
      setCustomEndpointConfig({ ...llamaConfig, model: 'qwen2.5-coder' });
      // $FlowFixMe
      axios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant', content: 'ok' } }] },
      });

      await customCreateAiRequest({ userRequest: 'start', mode: 'chat' });

      const body = axios.post.mock.calls[0][1];
      // Message estimate must respect the smaller budget AND the tools must
      // still be sent — budgeting must not strip them.
      expect(estimateMessagesTokens(body.messages)).toBeLessThanOrEqual(
        getMessageBudget({ ...llamaConfig, model: 'qwen2.5-coder' }, body.tools)
      );
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools.length).toBeGreaterThan(0);
    });
  });

  describe('the stream ends at [DONE]', () => {
    it('returns as soon as the server sends [DONE], without waiting for close', async () => {
      // Many OpenAI-compatible servers and proxies keep the socket open after
      // the terminator. Waiting for a close means a finished answer sits idle
      // until the watchdog aborts it, so the loop must stop on [DONE].
      const encoder = new TextEncoder();
      const body =
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: 'finished' }, finish_reason: 'stop' }],
        }) +
        '\n' +
        'data: [DONE]\n';
      let readCount = 0;
      // A read that never resolves models the held-open socket.
      const neverResolvingRead = () => new Promise(() => {});
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              if (readCount === 1) {
                return { done: false, value: encoder.encode(body) };
              }
              return neverResolvingRead();
            },
          }),
        },
      });

      // If the loop waited for close this promise would never settle.
      const message = await sendChatCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        config: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          apiKey: '',
          model: 'qwen2.5-coder',
          temperature: 0.7,
          streaming: true,
        },
      });

      expect(message.content).toBe('finished');
      // Exactly one chunk plus the terminator: no further read was needed.
      expect(readCount).toBe(1);
      // $FlowFixMe[method-unbinding] jest matcher on a typed axios instance.
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('partial content while the first turn streams', () => {
    // The chat's cold-start hint reads customGetAiRequestPartialContent to tell
    // "no bytes yet" apart from "already streaming". Only addMessage used to
    // publish it, so a first turn showed "waiting for the first token" while
    // its text was visibly arriving.
    // Two reads: the delta, then the terminator. Sampling at the top of the
    // second read observes the registry as the turn left it after processing
    // the delta, which is mid-turn — the `[DONE]` line then ends the loop.
    const deltaBody =
      'data: ' +
      JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }) +
      '\n';
    const doneBody = 'data: [DONE]\n';

    // Sampling hook that observes the registry from inside the turn. It runs
    // as a microtask queued after the chunk is handed to the reader, because
    // the `data: [DONE]` line now ends the read loop and there is no second
    // `read()` to hang the observation off.
    let samplePartialContent = () => null;

    const mockStreamResponse = () => {
      const encoder = new TextEncoder();
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: (() => {
              let readCount = 0;
              return async () => {
                readCount += 1;
                if (readCount === 1) {
                  return { done: false, value: encoder.encode(deltaBody) };
                }
                // Observing here catches the registry after the delta was
                // processed and before the turn settles.
                samplePartialContent();
                if (readCount === 2) {
                  return { done: false, value: encoder.encode(doneBody) };
                }
                return { done: true, value: undefined };
              };
            })(),
          }),
        },
      };
    };

    it('publishes partial content during a create turn and clears it after', async () => {
      setCustomEndpointConfig({
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.7,
        streaming: true,
      });

      // Freeze the id inputs so the in-flight request id is predictable.
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const expectedId = `local-ai-1700000000000-${(0.5)
        .toString(36)
        .substr(2, 7)}`;

      let seenDuringRequest = null;
      // The reader returns the delta first and is called again for the `done`
      // poll; sampling on that second read captures the registry as it stood
      // after onStreamDelta ran for the delta chunk.
      global.fetch = jest
        .fn()
        .mockImplementation(() => Promise.resolve(mockStreamResponse()));

      samplePartialContent = () => {
        seenDuringRequest = customGetAiRequestPartialContent(expectedId);
      };

      const created = await customCreateAiRequest({
        userRequest: 'start',
        mode: 'chat',
      });

      expect(created.id).toBe(expectedId);
      // The registry must have carried the streamed bytes mid-turn...
      expect(seenDuringRequest).toBe('Hel');
      // ...and must not leak into the next turn.
      expect(customGetAiRequestPartialContent(expectedId)).toBe('');

      nowSpy.mockRestore();
      randomSpy.mockRestore();
    });
  });
});
