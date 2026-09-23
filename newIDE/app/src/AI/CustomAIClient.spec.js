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
  customGetAiRequests,
  customGetAiRequestStatuses,
  customSuspendAiRequest,
  customForkAiRequest,
  customGetAiRequestSuggestions,
  customCreateAiGeneratedEvent,
  customCreateAssetSearch,
  customCreateResourceSearch,
  testConnection,
  sendChatCompletion,
  estimateTokens,
  getTokenBudget,
  estimateMessagesTokens,
  trimMessagesToBudget,
  validateToolCallArguments,
  customGetAiRequestContextTrimCount,
  customGetAiRequestTokenTotal,
  customSetAiRequestModelOverride,
  customGetAiRequestModelOverride,
  _resetCustomAiClientForTesting as _resetForStreamTests,
} from './CustomAIClient';

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
    it('estimates tokens at ~4 characters per token', () => {
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcde')).toBe(2);
      expect(estimateTokens('a'.repeat(400))).toBe(100);
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

    it('returns suggestions for an AI request', async () => {
      const suggestions = await customGetAiRequestSuggestions('local-ai-123');
      expect(suggestions.suggestions).toHaveLength(3);
      expect(suggestions.suggestions[0].suggestedMessage).toBeDefined();
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
});
