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
  GDEVELOP_OPENAI_TOOLS,
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
  customSetAiRequestModelOverride,
  customGetAiRequestModelOverride,
  loadLocalAiRequests,
  saveLocalAiRequests,
  _resetCustomAiClientForTesting as _resetForStreamTests,
} from './CustomAIClient';
import { isFailedAiRequestStart } from '../AiGeneration/AiRequestUtils';

import { getToolsForRole } from '../AiGeneration/Studio/Roles';

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

  describe('partial content while the first turn streams', () => {
    // The chat's cold-start hint reads customGetAiRequestPartialContent to tell
    // "no bytes yet" apart from "already streaming". Only addMessage used to
    // publish it, so a first turn showed "waiting for the first token" while
    // its text was visibly arriving.
    const streamBody = [
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }) +
        '\n',
      'data: [DONE]\n',
    ].join('');

    // Sampling hook invoked synchronously from the reader after the SDK has
    // processed the first chunk, so it observes the registry mid-turn.
    let samplePartialContent = () => null;

    const mockStreamResponse = () => {
      const encoder = new TextEncoder();
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: (() => {
              let done = false;
              return async () => {
                if (done) {
                  samplePartialContent();
                  return { done: true, value: undefined };
                }
                done = true;
                return { done: false, value: encoder.encode(streamBody) };
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
