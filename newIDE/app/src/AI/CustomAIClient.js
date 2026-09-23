// @flow

// nosonar: javascript:S2245 — Math.random() is used
// here only to generate non-cryptographic unique IDs
// (callId, reqId, messageId, etc.) and for UI variant
// selection. These values are not used as security tokens,
// session keys, or anything that requires unpredictability.

import axios from 'axios';
import { getStudioRole, getToolsForRole } from '../AiGeneration/Studio/Roles';
import {
  type AiRequest,
  type AiRequestMessage,
  type AiRequestFunctionCallOutput,
  type AiRequestUserMessage,
  type AiRequestSuggestions,
  type AiGeneratedEvent,
  type CreateAiGeneratedEventResult,
  type AssetSearch,
  type ResourceSearch,
  type GenerationStatus,
  type AiSettings,
} from '../Utils/GDevelopServices/Generation';

export const LOCAL_BYOK_USER_ID = 'local-byok-user';

export type CustomAIConfig = {|
  enabled: boolean,
  baseUrl: string,
  apiKey: string,
  model: string,
  temperature: number,
  maxTokens?: number,
  customHeaders?: { [string]: string },
  /** Per-request timeout in milliseconds. Defaults to 120000 (slow local
   * models on large contexts need more than axios' generic timeout message
   * suggests). */
  timeoutMs?: number,
  /** Stream responses via SSE when the endpoint supports it (reduces
   * time-to-first-token in agent loops). Falls back to a non-streaming
   * request automatically if the server rejects streaming. */
  streaming?: boolean,
|};

export const DEFAULT_CUSTOM_AI_CONFIG: CustomAIConfig = {
  enabled: false,
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'qwen2.5-coder',
  temperature: 0.7,
};

const LOCAL_STORAGE_CONFIG_KEY = 'gd-custom-ai-config';
const LOCAL_STORAGE_REQUESTS_KEY = 'gd-custom-ai-requests';
const MAX_LOCAL_SAVED_REQUESTS = 20;

/**
 * In-memory configuration cache.
 */
let cachedConfig: ?CustomAIConfig = null;

/**
 * Whether a user-configured header is safe to attach to an outgoing request.
 * Rejects CR/LF/NUL in the name or value (header injection) and hop-by-hop
 * headers that would break or redirect the JSON request if left to overrides.
 * Content-Type is also rejected here: custom headers are applied before the
 * Authorization/API key, but Content-Type must stay application/json.
 */
const isSafeRequestHeader = (name: string, value: string): boolean => {
  if (typeof name !== 'string' || typeof value !== 'string') return false;
  // RFC 7230 token (no colon/spaces/controls) — also blocks CR/LF injection.
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return false;
  // No CR/LF/NUL in values (header splitting).
  if (/[\r\n\0]/.test(value)) return false;
  const lower = name.toLowerCase();
  if (
    lower === 'content-type' ||
    lower === 'content-length' ||
    lower === 'host' ||
    lower === 'connection' ||
    lower === 'transfer-encoding' ||
    lower === 'keep-alive' ||
    lower === 'upgrade' ||
    lower === 'te' ||
    lower === 'trailer' ||
    lower === 'proxy-authorization' ||
    lower === 'proxy-connection'
  ) {
    return false;
  }
  return true;
};

/**
 * Coerce arbitrary JSON (localStorage) or a `$Shape` update into a
 * well-typed CustomAIConfig. Fail-closed on bad types so a corrupt entry
 * can never crash a model call, poison the live cache, or leak through the
 * header-building path.
 */
const sanitizeCustomAIConfig = (input: mixed): CustomAIConfig => {
  // JSON null / scalars / arrays are not configs — fall back wholesale so
  // baseUrl/model do not collapse to '' (which would fight the default host).
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...DEFAULT_CUSTOM_AI_CONFIG };
  }
  const parsed: { [string]: any } = (input: any);
  return {
    ...DEFAULT_CUSTOM_AI_CONFIG,
    enabled: parsed.enabled === true,
    baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
    apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    temperature:
      typeof parsed.temperature === 'number' &&
      Number.isFinite(parsed.temperature)
        ? Math.max(0, Math.min(1, parsed.temperature))
        : DEFAULT_CUSTOM_AI_CONFIG.temperature,
    timeoutMs:
      typeof parsed.timeoutMs === 'number' &&
      Number.isFinite(parsed.timeoutMs) &&
      parsed.timeoutMs > 0
        ? parsed.timeoutMs
        : undefined,
    streaming: parsed.streaming === true,
    maxTokens:
      typeof parsed.maxTokens === 'number' &&
      Number.isFinite(parsed.maxTokens) &&
      parsed.maxTokens > 0
        ? parsed.maxTokens
        : undefined,
    customHeaders:
      parsed.customHeaders &&
      typeof parsed.customHeaders === 'object' &&
      !Array.isArray(parsed.customHeaders)
        ? Object.fromEntries(
            // $FlowExpectedError[incompatible-type] Object.entries widens the value type.
            (Object.entries(parsed.customHeaders): Array<
              [string, string]
            >).filter(
              ([name, value]) =>
                typeof value === 'string' && isSafeRequestHeader(name, value)
            )
          )
        : undefined,
  };
};

/**
 * Load custom AI config from local storage or default.
 */
export const getCustomEndpointConfig = (): CustomAIConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const persisted = localStorage.getItem(LOCAL_STORAGE_CONFIG_KEY);
      if (persisted) {
        const parsed = JSON.parse(persisted);
        cachedConfig = sanitizeCustomAIConfig(parsed);
        return cachedConfig;
      }
    }
  } catch (err) {
    console.warn('Error reading custom AI config from localStorage:', err);
  }

  cachedConfig = { ...DEFAULT_CUSTOM_AI_CONFIG };
  return cachedConfig;
};

/**
 * Save custom AI config to local storage and update in-memory cache.
 * Sanitizes updates before caching so a mistyped field cannot poison the
 * live session (getCustomEndpointConfig short-circuits on the cache).
 * Excludes apiKey from cleartext localStorage while retaining it in memory.
 */
export const setCustomEndpointConfig = (
  updates: $Shape<CustomAIConfig>
): CustomAIConfig => {
  const current = getCustomEndpointConfig();
  const nextConfig: CustomAIConfig = sanitizeCustomAIConfig({
    ...current,
    ...updates,
  });
  cachedConfig = nextConfig;

  try {
    if (typeof localStorage !== 'undefined') {
      const { apiKey, ...persistableConfig } = nextConfig;
      localStorage.setItem(
        LOCAL_STORAGE_CONFIG_KEY,
        JSON.stringify(persistableConfig)
      );
    }
  } catch (err) {
    console.warn('Error saving custom AI config to localStorage:', err);
  }

  return nextConfig;
};

/**
 * Check if the custom AI endpoint is enabled.
 */
export const isCustomEndpointEnabled = (): boolean => {
  const config = getCustomEndpointConfig();
  return !!config.enabled;
};

/**
 * Normalize base URL ensuring protocol and removing trailing slashes.
 * Preserves the configured path exactly without automatically appending /v1.
 */
export const normalizeBaseUrl = (baseUrl: string): string => {
  let url = (baseUrl || '').trim();
  if (!url) {
    return 'http://localhost:11434/v1';
  }
  // Remove trailing slashes
  url = url.replace(/\/+$/, '');
  // If user entered a schemeless URL, default to http:// for loopback and https:// otherwise
  if (!/^https?:\/\//i.test(url)) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(url)) {
      url = `http://${url}`;
    } else {
      url = `https://${url}`;
    }
  }
  return url;
};

/**
 * Build the full endpoint URL for a given path.
 */
export const getEndpointUrl = (
  baseUrl: string,
  endpointPath: string
): string => {
  const normalized = normalizeBaseUrl(baseUrl);
  const cleanPath = endpointPath.startsWith('/')
    ? endpointPath
    : `/${endpointPath}`;

  return `${normalized}${cleanPath}`;
};

/**
 * In-memory cache for local AI requests.
 */
const localAiRequestsCache: { [id: string]: AiRequest } = {};

/**
 * In-flight turn cancellation: one AbortController per running model turn,
 * keyed by request id (sub-agents remember their parent so a parent Stop can
 * cancel them). `customSuspendAiRequest` aborts them; each turn releases its
 * entry when the model call settles.
 */
const localAiRequestAbortControllers: {
  [id: string]: {|
    controller: AbortController,
    parentAiRequestId: string | null,
  |},
} = {};

/**
 * Number of history messages trimmed to fit the context budget, per request:
 * the chat UI surfaces this so users understand why the agent may have
 * "forgotten" old exchanges.
 */
const localAiRequestTrimCounts: { [id: string]: number } = {};

export const customGetAiRequestContextTrimCount = (
  aiRequestId: string
): number => localAiRequestTrimCounts[aiRequestId] || 0;

/**
 * Whether the system project-structure prompt was compacted for this request.
 * History trims only drop conversation messages; system compaction silently
 * shortens the structure the model sees — surface that distinctly in the UI.
 */
const localAiRequestSystemCompacted: { [id: string]: boolean } = {};

export const customGetAiRequestSystemCompacted = (
  aiRequestId: string
): boolean => !!localAiRequestSystemCompacted[aiRequestId];

const noteSystemCompactedIfChanged = (
  aiRequestId: string,
  beforeMessages: Array<Object>,
  afterMessages: Array<Object>
): void => {
  let beforeContent = '';
  let afterContent = '';
  for (let i = 0; i < beforeMessages.length; i++) {
    const message = beforeMessages[i];
    if (message && message.role === 'system') {
      beforeContent = message.content;
      break;
    }
  }
  for (let i = 0; i < afterMessages.length; i++) {
    const message = afterMessages[i];
    if (message && message.role === 'system') {
      afterContent = message.content;
      break;
    }
  }
  if (
    typeof beforeContent === 'string' &&
    typeof afterContent === 'string' &&
    beforeContent !== afterContent
  ) {
    localAiRequestSystemCompacted[aiRequestId] = true;
  }
};

/**
 * Cumulative estimated tokens (prompt + response) consumed per request, for
 * the local/BYOK cost meter in the chat UI. Estimate only (chars/4) — never
 * a billing figure.
 */
const localAiRequestTokenTotals: { [id: string]: number } = {};

const addTokenUsage = (
  aiRequestId: string,
  promptTokens: number,
  responseTokens: number
): void => {
  localAiRequestTokenTotals[aiRequestId] =
    (localAiRequestTokenTotals[aiRequestId] || 0) +
    promptTokens +
    responseTokens;
};

export const customGetAiRequestTokenTotal = (aiRequestId: string): number =>
  localAiRequestTokenTotals[aiRequestId] || 0;

/**
 * Per-request model override: an empty string clears the override and falls
 * back to the globally configured model. Survives via the request-scoped
 * registries until the client state is reset.
 */
/**
 * Latest streamed partial content per in-flight request, for the progressive
 * "typing" display in the chat UI. Cleared when the turn settles.
 */
const localAiRequestPartialContent: { [id: string]: string } = {};

export const customGetAiRequestPartialContent = (aiRequestId: string): string =>
  localAiRequestPartialContent[aiRequestId] || '';

const localAiRequestModelOverrides: { [id: string]: string } = {};

export const customSetAiRequestModelOverride = (
  aiRequestId: string,
  model: string
): void => {
  const trimmedModel = (model || '').trim();
  if (trimmedModel) {
    localAiRequestModelOverrides[aiRequestId] = trimmedModel;
  } else {
    delete localAiRequestModelOverrides[aiRequestId];
  }
};

export const customGetAiRequestModelOverride = (aiRequestId: string): string =>
  localAiRequestModelOverrides[aiRequestId] || '';

/**
 * Effective endpoint config for one request: the global config with the
 * per-request model override applied (used for the request and its
 * sub-agents, so the whole chat stays on one model).
 */
export const getEffectiveConfigForRequest = (
  aiRequestId: string
): CustomAIConfig => {
  const config = getCustomEndpointConfig();
  const modelOverride = localAiRequestModelOverrides[aiRequestId];
  return modelOverride ? { ...config, model: modelOverride } : config;
};

const registerTurnAbortController = (
  aiRequestId: string,
  parentAiRequestId?: string | null
): AbortController => {
  const controller = new AbortController();
  localAiRequestAbortControllers[aiRequestId] = {
    controller,
    parentAiRequestId: parentAiRequestId || null,
  };
  return controller;
};

const releaseTurnAbortController = (aiRequestId: string): void => {
  delete localAiRequestAbortControllers[aiRequestId];
};

const abortTurnsForRequest = (aiRequestId: string): void => {
  const entry = localAiRequestAbortControllers[aiRequestId];
  if (entry) entry.controller.abort();
  for (const key of Object.keys(localAiRequestAbortControllers)) {
    const other = localAiRequestAbortControllers[key];
    if (other && other.parentAiRequestId === aiRequestId) {
      other.controller.abort();
    }
  }
};

/**
 * One in-flight model turn per request id.
 *
 * A turn reads `localAiRequestsCache[id]`, awaits a full model call, then writes
 * the whole updated request back. Once the studio spawns a sub-agent, a parent
 * and its child are both taking turns, so that read-to-write window is a real
 * lost-update race: without this lock the later write discards the earlier one's
 * appended message.
 *
 * Different request ids never block each other.
 */
const localAiTurnTails: { [aiRequestId: string]: Promise<void> } = {};

/**
 * Run `turn` with the exclusive turn lock for `aiRequestId`, releasing it when
 * the turn settles. The lock is a promise tail, so a queued turn only starts
 * after the previous one has released it, and different request ids never block
 * each other.
 */
export const withLocalAiTurnLock = async <T>(
  aiRequestId: string,
  turn: () => Promise<T>
): Promise<T> => {
  const tail = localAiTurnTails[aiRequestId] || Promise.resolve();
  let release: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const newTail = tail.then(() => held);
  localAiTurnTails[aiRequestId] = newTail;

  await tail;
  try {
    return await turn();
  } finally {
    release();
    // Drop the entry once nothing is queued behind this turn.
    if (localAiTurnTails[aiRequestId] === newTail) {
      delete localAiTurnTails[aiRequestId];
    }
  }
};

/**
 * Rough token estimate for prompt-budget purposes: ~4 characters per token.
 * Deliberately dependency-free and local-only — good enough to decide whether
 * the context window is in danger, not to bill anyone.
 */
export const estimateTokens = (text: ?string): number =>
  text && typeof text === 'string' ? Math.ceil(text.length / 4) : 0;

const DEFAULT_CONTEXT_WINDOW = 128000;
// Conservative context windows per model family (local models are small).
const FAMILY_CONTEXT_WINDOWS = {
  llama: 8192,
  mistral: 32768,
  qwen: 32768,
  gpt: 128000,
  claude: 128000,
  deepseek: 128000,
};

/**
 * Input-token budget for a request: half the model family's context window,
 * so output and tool definitions always have room.
 */
export const getTokenBudget = (config?: ?CustomAIConfig): number => {
  const model = String((config && config.model) || '').toLowerCase();
  const window = Object.keys(FAMILY_CONTEXT_WINDOWS).reduce(
    (found, family) =>
      found || (model.includes(family) ? FAMILY_CONTEXT_WINDOWS[family] : 0),
    0
  );
  return ((window || DEFAULT_CONTEXT_WINDOW) * 1) / 2;
};

/**
 * Estimate the prompt size of a full OpenAI-style message list.
 */
export const estimateMessagesTokens = (openAiMessages: Array<Object>): number =>
  openAiMessages.reduce((sum, message) => {
    if (!message) return sum;
    const content = message.content;
    const contentTokens =
      typeof content === 'string'
        ? estimateTokens(content)
        : estimateTokens(content ? JSON.stringify(content) : '');
    const toolCallTokens = (message.tool_calls || []).reduce(
      (toolSum, toolCall) =>
        toolSum +
        estimateTokens(
          toolCall && toolCall.function && toolCall.function.arguments
        ),
      0
    );
    return sum + contentTokens + toolCallTokens;
  }, 0);

const SYSTEM_STRUCTURE_MARKER = 'Current Project Structure:\n';
const SYSTEM_EXTENSIONS_MARKER = 'Installed Project Extensions:';
const SYSTEM_TRUNCATION_NOTE =
  '\n[... project structure truncated to fit the model context window ...]\n';

const hardCapSystemContent = (content: string, maxTokens: number): string => {
  const maxChars = Math.max(
    64,
    (maxTokens - estimateTokens(SYSTEM_TRUNCATION_NOTE)) * 4
  );
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + SYSTEM_TRUNCATION_NOTE;
};

/**
 * The system prompt embeds the full project structure JSON. History dropping
 * never touches `role: 'system'`, so a create/first turn on a small local
 * model (e.g. llama → 4096-token budget) can ship an oversized system message
 * alone. Truncate the structure section first (keep guidelines + extensions),
 * then hard-cap the whole prompt if still over. Returns the same array
 * reference when nothing needed compaction.
 */
export const compactSystemMessageToBudget = (
  openAiMessages: Array<Object>,
  budget: number
): Array<Object> => {
  let sysIndex = -1;
  for (let i = 0; i < openAiMessages.length; i++) {
    const message = openAiMessages[i];
    if (message && message.role === 'system') {
      sysIndex = i;
      break;
    }
  }
  if (sysIndex < 0) return openAiMessages;
  const systemMessage = openAiMessages[sysIndex];
  if (!systemMessage || typeof systemMessage.content !== 'string') {
    return openAiMessages;
  }

  // Leave room for the newest exchange so compaction cannot starve the
  // user message that triggered the turn.
  const RESERVE_FOR_EXCHANGE = 256;
  const maxSystemTokens = Math.max(128, budget - RESERVE_FOR_EXCHANGE);
  const content = systemMessage.content;
  if (estimateTokens(content) <= maxSystemTokens) return openAiMessages;

  const structureStart = content.indexOf(SYSTEM_STRUCTURE_MARKER);
  let nextContent: string;
  if (structureStart >= 0) {
    const bodyStart = structureStart + SYSTEM_STRUCTURE_MARKER.length;
    const extensionsStart = content.indexOf(
      SYSTEM_EXTENSIONS_MARKER,
      bodyStart
    );
    const bodyEnd = extensionsStart >= 0 ? extensionsStart : content.length;
    const prefix = content.slice(0, bodyStart);
    const body = content.slice(bodyStart, bodyEnd);
    const suffix = content.slice(bodyEnd);
    const overhead =
      estimateTokens(prefix) +
      estimateTokens(suffix) +
      estimateTokens(SYSTEM_TRUNCATION_NOTE);
    const allowedBodyTokens = Math.max(64, maxSystemTokens - overhead);
    const allowedBodyChars = allowedBodyTokens * 4;
    nextContent =
      body.length > allowedBodyChars
        ? prefix +
          body.slice(0, allowedBodyChars) +
          SYSTEM_TRUNCATION_NOTE +
          suffix
        : hardCapSystemContent(content, maxSystemTokens);
  } else {
    nextContent = hardCapSystemContent(content, maxSystemTokens);
  }
  if (estimateTokens(nextContent) > maxSystemTokens) {
    nextContent = hardCapSystemContent(nextContent, maxSystemTokens);
  }
  if (nextContent === content) return openAiMessages;

  const messages = openAiMessages.slice();
  messages[sysIndex] = { ...systemMessage, content: nextContent };
  return messages;
};

/**
 * Drop oldest non-system messages (after the system prompt) until the
 * estimated prompt fits the budget. Tool outputs follow their assistant
 * `tool_calls` message: dropping one drops its outputs too, so a server
 * never sees an orphan tool message. The last two messages are always kept.
 * An oversized system prompt (embedded project JSON) is compacted first —
 * history dropping never touches `role: 'system'`.
 */
export const trimMessagesToBudget = (
  openAiMessages: Array<Object>,
  budget: number
): Array<Object> => {
  let messages = compactSystemMessageToBudget(openAiMessages, budget);
  let estimate = estimateMessagesTokens(messages);
  if (estimate <= budget) return messages;

  // First pass: compact the biggest oversized message contents in place
  // rather than dropping them — tool outputs keep their pairing and the
  // model keeps knowing the tool ran. The newest exchange and the system
  // prompt are never touched.
  const COMPACT_THRESHOLD = 4000; // ~1000 tokens
  const KEPT_HEAD = 500; // ~125 tokens
  for (;;) {
    if (estimate <= budget) return messages;
    let largestIndex = -1;
    let largestSize = 0;
    for (let i = 1; i < messages.length - 2; i++) {
      const message = messages[i];
      if (!message || message.role === 'system') continue;
      if (typeof message.content !== 'string') continue;
      if (message.content.length <= COMPACT_THRESHOLD) continue;
      if (message.content.length > largestSize) {
        largestSize = message.content.length;
        largestIndex = i;
      }
    }
    if (largestIndex === -1) break;
    const message = messages[largestIndex];
    const removed = message.content.length - KEPT_HEAD;
    messages = messages.slice();
    messages[largestIndex] = {
      ...message,
      content:
        message.content.slice(0, KEPT_HEAD) +
        `\n[... trimmed: ${removed} characters removed to fit the model context window ...]`,
    };
    estimate -= Math.ceil(removed / 4);
  }
  const kept = [];
  let dropToolOutputs = false;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const isProtected =
      i === 0 ||
      i >= messages.length - 2 ||
      (message && message.role === 'system');
    if (isProtected) {
      kept.push(message);
      continue;
    }
    if (estimate > budget && !dropToolOutputs) {
      const toolCalls =
        message && message.role === 'assistant' && message.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        dropToolOutputs = true;
      }
      estimate -= estimateTokens(
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content || '')
      );
      continue;
    }
    if (dropToolOutputs) {
      if (message.role === 'tool') {
        // Output of a dropped tool_calls assistant: also dropped — its
        // tokens must still be accounted for, or the estimate stays
        // inflated and later messages are over-dropped.
        estimate -= estimateTokens(
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content || '')
        );
        continue;
      }
      dropToolOutputs = false;
    }
    kept.push(message);
  }
  return kept;
};

/** Reset CustomAIClient state (for testing). */
export const _resetCustomAiClientForTesting = () => {
  cachedConfig = null;
  for (const key of Object.keys(localAiRequestsCache)) {
    delete localAiRequestsCache[key];
  }
  for (const key of Object.keys(localAiRequestAbortControllers)) {
    delete localAiRequestAbortControllers[key];
  }
  for (const key of Object.keys(localAiRequestTrimCounts)) {
    delete localAiRequestTrimCounts[key];
  }
  for (const key of Object.keys(localAiRequestSystemCompacted)) {
    delete localAiRequestSystemCompacted[key];
  }
  for (const key of Object.keys(localAiRequestTokenTotals)) {
    delete localAiRequestTokenTotals[key];
  }
  for (const key of Object.keys(localAiRequestModelOverrides)) {
    delete localAiRequestModelOverrides[key];
  }
  for (const key of Object.keys(localAiRequestPartialContent)) {
    delete localAiRequestPartialContent[key];
  }
  for (const key of Object.keys(localAiTurnTails)) {
    delete localAiTurnTails[key];
  }
};

/**
 * Load local AI requests from local storage.
 * Only merges plain-object entries that look like an AiRequest — a corrupt
 * array/scalar JSON payload or a non-object value must not poison the cache
 * (Object.assign of `null`/scalars creates keys that crash list sorting and
 * status mapping on the next customGetAiRequests call).
 */
export const loadLocalAiRequests = (): { [id: string]: AiRequest } => {
  try {
    if (typeof localStorage !== 'undefined') {
      const persisted = localStorage.getItem(LOCAL_STORAGE_REQUESTS_KEY);
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const entries = Object.entries(parsed);
          for (let i = 0; i < entries.length; i++) {
            const key = entries[i][0];
            const value = entries[i][1];
            if (
              value &&
              typeof value === 'object' &&
              !Array.isArray(value) &&
              typeof value.id === 'string' &&
              typeof value.status === 'string'
            ) {
              localAiRequestsCache[key] = (value: any);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error loading local AI requests from localStorage:', err);
  }
  return localAiRequestsCache;
};

/**
 * Save local AI requests to local storage, retaining a bounded number of requests
 * and excluding full gameProjectJson to prevent storage quota exhaustion.
 * Quota/security errors are swallowed so a write failure never aborts the
 * in-memory create/update/delete path that called us.
 */
export const saveLocalAiRequests = () => {
  if (typeof localStorage === 'undefined') return;

  try {
    const keys = Object.keys(localAiRequestsCache);
    const recentKeys = keys.slice(-MAX_LOCAL_SAVED_REQUESTS);
    const persistableMap: { [id: string]: AiRequest } = {};

    for (const key of recentKeys) {
      const req = localAiRequestsCache[key];
      if (req) {
        const { gameProjectJson, ...persistableReq } = req;
        persistableMap[key] = (persistableReq: any);
      }
    }

    localStorage.setItem(
      LOCAL_STORAGE_REQUESTS_KEY,
      JSON.stringify(persistableMap)
    );
  } catch (err) {
    console.warn('Error saving local AI requests to localStorage:', err);
  }
};

// Initialize requests from localStorage
loadLocalAiRequests();

/**
 * OpenAI Tool definitions for GDevelop Editor Functions.
 */
export const GDEVELOP_OPENAI_TOOLS: Array<{|
  type: 'function',
  function: {|
    name: string,
    description: string,
    parameters: Object,
  |},
|}> = [
  {
    type: 'function',
    function: {
      name: 'create_scene',
      description:
        'Create a new scene in the GDevelop project with the given name.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the new scene to create.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_or_replace_object',
      description:
        'Create or replace an object in a scene (or global if scene_name is omitted).',
      parameters: {
        type: 'object',
        properties: {
          object_name: {
            type: 'string',
            description: 'Name of the object.',
          },
          object_type: {
            type: 'string',
            description:
              'Type of object (e.g. "Sprite", "TiledSpriteObject::TiledSprite", "TextObject::Text", "PanelSpriteObject::PanelSprite", "Tilemap::Tilemap", "Scene3D::Cube3D").',
          },
          scene_name: {
            type: 'string',
            description:
              'Name of the scene. If omitted or empty, creates a global object.',
          },
          description: {
            type: 'string',
            description: 'Optional description of the object purpose.',
          },
        },
        required: ['object_name', 'object_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_behavior',
      description: 'Add a behavior to an object in the project.',
      parameters: {
        type: 'object',
        properties: {
          object_name: {
            type: 'string',
            description: 'Name of the object to add behavior to.',
          },
          behavior_name: {
            type: 'string',
            description:
              'Unique name for this behavior instance on the object.',
          },
          behavior_type: {
            type: 'string',
            description:
              'Type of behavior (e.g. "PlatformBehavior::PlatformerObjectBehavior", "PlatformBehavior::PlatformBehavior", "TopDownMovementBehavior::TopDownMovementBehavior", "Physics2::Physics2Behavior", "DestroyOutsideBehavior::DestroyOutside", "SmoothCamera::SmoothCamera").',
          },
          scene_name: {
            type: 'string',
            description:
              'Name of the scene (if object is a scene object). Omit for global objects.',
          },
        },
        required: ['object_name', 'behavior_name', 'behavior_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'put_2d_instances',
      description:
        'Place one or more 2D instances of objects into a scene at specified coordinates.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
          instances: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                object_name: {
                  type: 'string',
                  description: 'Name of the object to instantiate.',
                },
                x: { type: 'number', description: 'X position in pixels.' },
                y: { type: 'number', description: 'Y position in pixels.' },
                layer_name: {
                  type: 'string',
                  description:
                    'Layer name (default empty string for base layer).',
                },
                angle: {
                  type: 'number',
                  description: 'Angle in degrees (default 0).',
                },
                z_order: { type: 'number', description: 'Z-order.' },
              },
              required: ['object_name', 'x', 'y'],
            },
            description: 'List of instances to place.',
          },
        },
        required: ['scene_name', 'instances'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_scene_events',
      description:
        'Generate or modify scene events in GDevelop based on natural language description.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene whose events are being modified.',
          },
          events_description: {
            type: 'string',
            description:
              'Detailed natural language description of the events logic to implement.',
          },
          objects_list: {
            type: 'string',
            description:
              'Comma-separated list of objects involved in these events.',
          },
          extension_names_list: {
            type: 'string',
            description:
              'Comma-separated list of extensions/behaviors used (e.g. "PlatformBehavior::PlatformerObjectBehavior, Keyboard, Scene").',
          },
        },
        required: ['scene_name', 'events_description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_script',
      description:
        'Execute a JavaScript script in the GDevelop editor to inspect or modify the project.',
      parameters: {
        type: 'object',
        properties: {
          script: {
            type: 'string',
            description:
              'JavaScript code to execute in the editor environment. Has access to exposed editor functions and project APIs.',
          },
        },
        required: ['script'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_events_source',
      description:
        'Read the current events of a scene in EventScript source format.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_instances',
      description: 'List all instances present in a scene.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
          filter_by_object_name: {
            type: 'string',
            description:
              'Optional comma-separated list of object names to filter by.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_object_properties_effects',
      description: 'Inspect properties and effects of an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          scene_name: {
            type: 'string',
            description: 'Scene name if scene object.',
          },
        },
        required: ['object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_behavior_properties',
      description: 'Inspect properties of a behavior attached to an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          behavior_name: {
            type: 'string',
            description: 'Name of the behavior instance.',
          },
          scene_name: {
            type: 'string',
            description: 'Scene name if scene object.',
          },
        },
        required: ['object_name', 'behavior_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_scene_properties_layers_effects',
      description: 'Inspect properties, layers, and effects of a scene.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: { type: 'string', description: 'Name of the scene.' },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_scene_properties_layers_effects_groups',
      description:
        'Change properties of a scene (such as backgroundColor, resolution, name, firstScene), layers, effects, or object groups.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
          changed_properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property_name: {
                  type: 'string',
                  description:
                    'Name of the scene property: "backgroundColor" (hex string like "#3498db" or "rgb(52, 152, 219)"), "gameResolutionWidth", "gameResolutionHeight", "name", "isFirstScene", "stopSoundsOnStartup", "gameOrientation", "gameScaleMode", "gameName".',
                },
                new_value: {
                  type: 'string',
                  description: 'The new value for the property as a string.',
                },
              },
              required: ['property_name', 'new_value'],
            },
            description: 'List of scene properties to update.',
          },
          changed_layers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                layer_name: { type: 'string' },
                new_layer_name: { type: 'string' },
                is_lighting_layer: { type: 'boolean' },
                is_follow_base_layer_camera: { type: 'boolean' },
                delete_this_layer: { type: 'boolean' },
              },
              required: ['layer_name'],
            },
            description: 'List of layers to modify, create or remove.',
          },
          delete_this_scene: {
            type: 'boolean',
            description: 'Set to true to delete this scene.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_object_properties_effects',
      description: 'Change properties and visual effects of an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          scene_name: {
            type: 'string',
            description: 'Name of the scene (omit for global object).',
          },
          changed_properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
          delete_this_object: { type: 'boolean' },
        },
        required: ['object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_behavior_property',
      description: 'Change a property of a behavior attached to an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          behavior_name: {
            type: 'string',
            description: 'Name of the behavior instance.',
          },
          property_name: {
            type: 'string',
            description: 'Name of the behavior property to modify.',
          },
          new_value: { type: 'string', description: 'New value as a string.' },
          scene_name: {
            type: 'string',
            description: 'Scene name if scene object.',
          },
          delete_this_behavior: {
            type: 'boolean',
            description: 'Set to true to remove this behavior.',
          },
        },
        required: [
          'object_name',
          'behavior_name',
          'property_name',
          'new_value',
        ],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_project_properties_resources',
      description:
        'Change global project settings such as window resolution, orientation, scale mode, or game name.',
      parameters: {
        type: 'object',
        properties: {
          changed_properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property_name: {
                  type: 'string',
                  description:
                    'Property name: "gameResolutionWidth", "gameResolutionHeight", "gameOrientation", "gameScaleMode", "gameName", "packageName", "version", "author", "loadingScreenBackgroundColor".',
                },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
            description: 'List of project properties to update.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_project_properties_resources',
      description: 'Inspect project global properties and resources list.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_or_edit_variable',
      description: 'Add or edit a variable at project, scene, or object level.',
      parameters: {
        type: 'object',
        properties: {
          variable_scope: {
            type: 'string',
            enum: ['global', 'scene', 'object', 'group', 'instance'],
            description: 'Scope of the variable ("global", "scene", "object").',
          },
          scope: {
            type: 'string',
            enum: ['global', 'scene', 'object', 'group', 'instance'],
            description: 'Alias for variable_scope.',
          },
          variable_name_or_path: {
            type: 'string',
            description:
              'Variable name or path (e.g. "Score" or "Player.Health").',
          },
          name: {
            type: 'string',
            description: 'Alias for variable_name_or_path.',
          },
          variable_type: {
            type: 'string',
            enum: ['number', 'string', 'boolean', 'structure', 'array'],
            description: 'Variable type.',
          },
          type: {
            type: 'string',
            enum: ['number', 'string', 'boolean', 'structure', 'array'],
            description: 'Alias for variable_type.',
          },
          value: { description: 'Initial or updated value for the variable.' },
          scene_name: {
            type: 'string',
            description: 'Scene name if scope is scene or object.',
          },
          object_name: {
            type: 'string',
            description: 'Object name if scope is object.',
          },
          delete_this_variable: {
            type: 'boolean',
            description: 'Set to true to delete this variable.',
          },
          variables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                variable_name_or_path: { type: 'string' },
                name: { type: 'string' },
                value: { type: 'string' },
                variable_type: { type: 'string' },
                type: { type: 'string' },
                delete_this_variable: { type: 'boolean' },
              },
            },
            description: 'Optional batch of variable operations.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'put_3d_instances',
      description:
        'Place 3D instances of objects into a scene at specified 3D coordinates.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: { type: 'string', description: 'Name of the scene.' },
          object_name: {
            type: 'string',
            description: 'Name of the 3D object.',
          },
          layer_name: {
            type: 'string',
            description: 'Layer name (default "").',
          },
          brush_kind: {
            type: 'string',
            enum: ['create', 'erase', 'modify'],
            description: 'Action to perform.',
          },
          brush_position: {
            type: 'string',
            description: 'Position "x, y, z" in 3D space.',
          },
          new_instances_count: {
            type: 'number',
            description: 'Number of instances to create (default 1).',
          },
        },
        required: ['scene_name', 'layer_name', 'brush_kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_variables',
      description: 'Inspect variables at global, scene, or object level.',
      parameters: {
        type: 'object',
        properties: {
          variable_scope: {
            type: 'string',
            enum: ['global', 'scene', 'object'],
            description: 'Scope of the variables to inspect.',
          },
          scene_name: {
            type: 'string',
            description: 'Name of the scene (if scope is scene or object).',
          },
          object_name: {
            type: 'string',
            description: 'Name of the object (if scope is object).',
          },
          variable_names_or_paths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of specific variable names or paths to inspect.',
          },
        },
        required: ['variable_scope'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_game_project_json',
      description: 'Read the complete or partial game project structure JSON.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'Optional section of project JSON to inspect.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_object_asset_store',
      description:
        'Search the GDevelop asset store for 2D/3D objects and sprite packs.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term (e.g. "player", "coin", "platform").',
          },
          category: { type: 'string', description: 'Optional asset category.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_resource_store',
      description:
        'Search the GDevelop resource store for audio sounds, music, and fonts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term (e.g. "jump", "laser", "music").',
          },
          resource_kind: {
            type: 'string',
            enum: ['audio', 'font', 'image'],
            description: 'Kind of resource to search.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_docs',
      description:
        'Search GDevelop documentation for functions, behaviors, and instructions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Documentation search query.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_full_docs',
      description:
        'Read full documentation for specific GDevelop extensions or features.',
      parameters: {
        type: 'object',
        properties: {
          extension_names: {
            type: 'string',
            description:
              'Comma-separated names of extensions to read docs for.',
          },
        },
        required: ['extension_names'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'initialize_project',
      description: 'Initialize a new project from a starter template.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            type: 'string',
            description: 'Name of the new project/game.',
          },
          game_name: { type: 'string', description: 'Alias for project_name.' },
          name: { type: 'string', description: 'Alias for project_name.' },
          template_slug: {
            type: 'string',
            description:
              'Slug of the starter template (e.g. "empty", "platformer", "top-down").',
          },
          also_read_existing_events: {
            type: 'boolean',
            description: 'Whether to read existing events from template.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_game_starter_summary',
      description:
        'Get a summary of an example starter template to study its structure.',
      parameters: {
        type: 'object',
        properties: {
          template_slug: {
            type: 'string',
            description: 'Slug of the starter template.',
          },
        },
        required: ['template_slug'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_or_update_plan',
      description: 'Create or update the step-by-step orchestrator plan.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Task ID (e.g. "task_1").' },
                title: { type: 'string', description: 'Short task title.' },
                description: { type: 'string', description: 'Task details.' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'done', 'voided'],
                  description: 'Task status.',
                },
                dependsOn: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of task IDs this task depends on.',
                },
              },
              required: ['id', 'title', 'description', 'status'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_gameplay_test',
      description:
        'Run or save a gameplay test in the project or an extension.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['project', 'extension'] },
              extension_name: { type: 'string' },
            },
            required: ['type'],
            description:
              'Test scope ({ type: "project" } or { type: "extension", extension_name: "..." }).',
          },
          test_name: { type: 'string', description: 'Name of the test.' },
          source: {
            type: 'string',
            description: 'Optional test JavaScript code.',
          },
          persist: {
            type: 'boolean',
            description: 'Whether to save the test (default true).',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds.',
          },
        },
        required: ['scope', 'test_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_gameplay_tests',
      description:
        'Change properties of or delete gameplay tests in the project.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['project', 'extension'] },
              extension_name: { type: 'string' },
            },
            required: ['type'],
          },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                test_name: { type: 'string' },
                delete_this_test: { type: 'boolean' },
                changed_properties: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      property_name: { type: 'string' },
                      new_value: { type: 'string' },
                    },
                    required: ['property_name', 'new_value'],
                  },
                },
              },
              required: ['test_name'],
            },
          },
        },
        required: ['scope', 'changes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_extension',
      description:
        'Create a new events-functions extension in the project. Optionally copy an existing one.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description:
              'Name of the extension to create. It is made unique automatically if taken.',
          },
          duplicated_extension_name: {
            type: 'string',
            description:
              'Name of an existing extension to copy into the new one. Omit to create an empty extension.',
          },
          full_name: {
            type: 'string',
            description: 'Human-readable title shown in the editor.',
          },
          short_description: {
            type: 'string',
            description: 'One-line description of the extension.',
          },
          description: {
            type: 'string',
            description: 'Full description of the extension.',
          },
          category: { type: 'string', description: 'Extension category.' },
          tags: {
            type: 'string',
            description: 'Comma-separated tags.',
          },
          author: { type: 'string', description: 'Extension author.' },
        },
        required: ['extension_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_extension_properties',
      description:
        'Change properties of an extension, its dependencies, or delete the extension.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Name of the extension to change.',
          },
          new_name: {
            type: 'string',
            description: 'New name for the extension, to rename it.',
          },
          delete_this_extension: {
            type: 'boolean',
            description: 'Set to true to delete the extension.',
          },
          delete_even_if_used: {
            type: 'boolean',
            description:
              'Allow deleting an extension that is still used. Only when delete_this_extension is true.',
          },
          changed_properties: {
            type: 'array',
            description: 'Properties to set on the extension.',
            items: {
              type: 'object',
              properties: {
                property_name: {
                  type: 'string',
                  description:
                    'One of: fullName, shortDescription, description, category, tags, version, author, helpPath, previewIconUrl, iconUrl, dimension.',
                },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
          changed_dependencies: {
            type: 'array',
            description: 'Dependencies to create, edit or delete.',
            items: {
              type: 'object',
              properties: {
                dependency_name: { type: 'string' },
                dependency_type: { type: 'string' },
                new_name: { type: 'string' },
                export_name: { type: 'string' },
                version: { type: 'string' },
                delete_this_dependency: { type: 'boolean' },
                extra_settings: {
                  type: 'object',
                  description: 'Dependency-specific settings, as strings.',
                },
              },
              required: ['dependency_name'],
            },
          },
        },
        required: ['extension_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_object',
      description:
        'Create a custom object (an events-based object) in an extension, optionally as a copy of an existing one.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension to create the custom object in.',
          },
          custom_object_name: {
            type: 'string',
            description: 'Name of the new custom object.',
          },
          duplicated_custom_object_name: {
            type: 'string',
            description: 'Existing custom object to copy.',
          },
          duplicated_from_extension_name: {
            type: 'string',
            description:
              'Extension holding the custom object to copy. Defaults to extension_name.',
          },
          area: {
            type: 'object',
            description:
              'Default area of the object, as numbers: minX, minY, minZ, maxX, maxY, maxZ.',
            properties: {
              minX: { type: 'number' },
              minY: { type: 'number' },
              minZ: { type: 'number' },
              maxX: { type: 'number' },
              maxY: { type: 'number' },
              maxZ: { type: 'number' },
            },
          },
        },
        required: ['extension_name', 'custom_object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_custom_object',
      description:
        'Change a custom object: rename, delete, change its settings, its variants or its properties.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension holding the custom object.',
          },
          custom_object_name: {
            type: 'string',
            description: 'Name of the custom object to change.',
          },
          new_name: { type: 'string', description: 'New name, to rename it.' },
          delete_this_custom_object: {
            type: 'boolean',
            description: 'Set to true to delete the custom object.',
          },
          delete_even_if_used: {
            type: 'boolean',
            description:
              'Allow deleting a custom object that is still used. Only when delete_this_custom_object is true.',
          },
          fit_area_to_children: {
            type: 'string',
            description:
              'Whether to fit the area to the children (true/false).',
          },
          changed_settings: {
            type: 'array',
            description: 'Settings to change on the custom object.',
            items: {
              type: 'object',
              properties: {
                setting_name: { type: 'string' },
                new_value: {
                  description:
                    'String, boolean or number depending on the setting.',
                },
              },
              required: ['setting_name', 'new_value'],
            },
          },
          changed_variants: {
            type: 'array',
            description: 'Variants to create or delete.',
            items: {
              type: 'object',
              properties: {
                variant_name: { type: 'string' },
                duplicated_from_variant_name: { type: 'string' },
                delete_this_variant: { type: 'boolean' },
              },
              required: ['variant_name'],
            },
          },
          changed_properties: {
            type: 'array',
            description: 'Properties to set on the custom object.',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
        },
        required: ['extension_name', 'custom_object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_behavior',
      description:
        'Create a custom behavior (an events-based behavior) in an extension.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension to create the behavior in.',
          },
          custom_behavior_name: {
            type: 'string',
            description: 'Name of the new custom behavior.',
          },
          duplicated_custom_behavior_name: {
            type: 'string',
            description: 'Existing custom behavior to copy.',
          },
          duplicated_from_extension_name: {
            type: 'string',
            description:
              'Extension holding the behavior to copy. Defaults to extension_name.',
          },
          full_name: {
            type: 'string',
            description: 'Human-readable title.',
          },
          description: { type: 'string' },
          object_type: {
            type: 'string',
            description:
              'Restrict the behavior to objects of this type. Omit for all objects.',
          },
        },
        required: ['extension_name', 'custom_behavior_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_custom_behavior',
      description:
        'Change a custom behavior: rename, delete, change its settings, its shared properties or its properties.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension holding the custom behavior.',
          },
          custom_behavior_name: {
            type: 'string',
            description: 'Name of the custom behavior to change.',
          },
          new_name: { type: 'string', description: 'New name, to rename it.' },
          delete_this_custom_behavior: {
            type: 'boolean',
            description: 'Set to true to delete the custom behavior.',
          },
          delete_even_if_used: {
            type: 'boolean',
            description:
              'Allow deleting a behavior that is still used. Only when delete_this_custom_behavior is true.',
          },
          changed_settings: {
            type: 'array',
            description: 'Settings to change on the custom behavior.',
            items: {
              type: 'object',
              properties: {
                setting_name: { type: 'string' },
                new_value: {
                  description:
                    'String, boolean or number depending on the setting.',
                },
              },
              required: ['setting_name', 'new_value'],
            },
          },
          changed_shared_properties: {
            type: 'array',
            description: 'Shared properties of the behavior to change.',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
          changed_properties: {
            type: 'array',
            description: 'Properties of the behavior to change.',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
        },
        required: ['extension_name', 'custom_behavior_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_function',
      description:
        'Create a function in an extension, a custom object or a custom behavior.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            description:
              'Where to create the function. type "extension" needs extension_name; "custom_object" needs extension_name and custom_object_name; "custom_behavior" needs extension_name and custom_behavior_name.',
            properties: {
              type: {
                type: 'string',
                enum: ['extension', 'custom_object', 'custom_behavior'],
              },
              extension_name: { type: 'string' },
              custom_object_name: { type: 'string' },
              custom_behavior_name: { type: 'string' },
            },
            required: ['type'],
          },
          function_name: {
            type: 'string',
            description: 'Name of the new function.',
          },
          duplicated_function_name: {
            type: 'string',
            description: 'Existing function to copy.',
          },
          function_type: {
            type: 'string',
            description:
              'Action, Condition, Expression, StringExpression or ActionWithOperator.',
          },
          getter_name: {
            type: 'string',
            description:
              'For ActionWithOperator: the getter function to build from.',
          },
          full_name: { type: 'string' },
          description: { type: 'string' },
          group: { type: 'string' },
          sentence: {
            type: 'string',
            description: 'Sentence shown in the events sheet.',
          },
          parameters: {
            type: 'array',
            description: 'Parameters to declare on the function.',
            items: { type: 'object' },
          },
        },
        required: ['scope', 'function_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_custom_function',
      description:
        'Change a function: rename, delete, change its settings or its parameters.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            description:
              'Where the function lives. type "extension" needs extension_name; "custom_object" needs extension_name and custom_object_name; "custom_behavior" needs extension_name and custom_behavior_name.',
            properties: {
              type: {
                type: 'string',
                enum: ['extension', 'custom_object', 'custom_behavior'],
              },
              extension_name: { type: 'string' },
              custom_object_name: { type: 'string' },
              custom_behavior_name: { type: 'string' },
            },
            required: ['type'],
          },
          function_name: {
            type: 'string',
            description: 'Name of the function to change.',
          },
          new_name: { type: 'string', description: 'New name, to rename it.' },
          delete_this_function: {
            type: 'boolean',
            description: 'Set to true to delete the function.',
          },
          changed_settings: {
            type: 'array',
            description: 'Settings to change on the function.',
            items: {
              type: 'object',
              properties: {
                setting_name: { type: 'string' },
                new_value: {
                  description:
                    'String, boolean or number depending on the setting.',
                },
              },
              required: ['setting_name', 'new_value'],
            },
          },
          changed_parameters: {
            type: 'array',
            description: 'Parameters to change on the function.',
            items: { type: 'object' },
          },
        },
        required: ['scope', 'function_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_extension',
      description:
        'Read the structure of an extension: its custom objects, custom behaviors, functions and variants.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Name of the extension to inspect.',
          },
          custom_object_name: {
            type: 'string',
            description: 'Restrict the output to this custom object.',
          },
          custom_behavior_name: {
            type: 'string',
            description: 'Restrict the output to this custom behavior.',
          },
          function_name: {
            type: 'string',
            description: 'Restrict the output to this function.',
          },
          variant_name: {
            type: 'string',
            description: 'Restrict the output to this variant.',
          },
        },
        required: ['extension_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_agent',
      description:
        'Delegate one task to a studio sub-agent, which works on it and reports back. Only the studio lead may call this. Sub-agents never delegate further.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            description:
              'Which specialist to use: "designer" writes the design document as GDD_ project variables; "developer" changes the project to implement a task; "tester" writes and runs a gameplay test and reports pass or fail.',
            enum: ['designer', 'developer', 'tester'],
          },
          short_title: {
            type: 'string',
            description:
              'A 2-5 word label shown in the chat for this sub-agent, e.g. "Build the town grid".',
          },
          task: {
            type: 'string',
            description:
              'The complete, self-contained instruction for the sub-agent. It cannot see this conversation, so state everything it needs: the scene, the objects, the expected result.',
          },
          context: {
            type: 'string',
            description:
              'Extra facts the sub-agent needs: relevant variable values, previous findings, constraints.',
          },
          related_task_id: {
            type: 'string',
            description:
              'The id of the create_or_update_plan task this agent works on. That task is marked done when the agent reports back.',
          },
        },
        required: ['role', 'short_title', 'task'],
      },
    },
  },
];

/**
 * Extract thinking / reasoning content from text or OpenAI reasoning fields.
 */
export const extractThinkingAndContent = (
  rawContent: ?string,
  reasoningContent: ?string
): {|
  thinking: string | null,
  cleanContent: string,
  content: string,
|} => {
  if (reasoningContent && reasoningContent.trim()) {
    const clean = (rawContent || '').trim();
    return {
      thinking: reasoningContent.trim(),
      cleanContent: clean,
      content: clean,
    };
  }

  if (!rawContent) {
    return { thinking: null, cleanContent: '', content: '' };
  }

  const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const cleanContent = rawContent
      .replace(/<think>[\s\S]*?<\/think>/i, '')
      .trim();
    return { thinking: thinking || null, cleanContent, content: cleanContent };
  }

  // Truncated reasoning models can emit an unclosed <think> tag
  // (e.g. generation cut off mid-thought): everything after the opening tag
  // is thinking, not content — otherwise it leaks into the chat and corrupts
  // tool-call JSON parsing.
  const unclosedIndex = rawContent.search(/<think>/i);
  if (
    unclosedIndex !== -1 &&
    rawContent.toLowerCase().indexOf('</think>') === -1
  ) {
    const cleanContent = rawContent.slice(0, unclosedIndex).trim();
    const thinking = rawContent.slice(unclosedIndex + '<think>'.length).trim();
    return { thinking: thinking || null, cleanContent, content: cleanContent };
  }

  const clean = rawContent.trim();
  return { thinking: null, cleanContent: clean, content: clean };
};

/**
 * Format GDevelop conversation messages into OpenAI standard format.
 */
export const transformGDevelopMessagesToOpenAi = (
  outputMessages: Array<any>,
  systemPromptOrGameProjectJson?: ?string,
  projectSpecificExtensionsSummaryJson?: ?string,
  mode?: string
): Array<{|
  role: 'system' | 'user' | 'assistant' | 'tool',
  content?: string | null,
  tool_calls?: Array<{|
    id: string,
    type: 'function',
    function: {|
      name: string,
      arguments: string,
    |},
  |}>,
  tool_call_id?: string,
|}> => {
  const openAiMessages = [];

  let effectiveSystemPrompt: ?string = null;
  if (systemPromptOrGameProjectJson) {
    if (
      systemPromptOrGameProjectJson.includes('You are GDevelop AI Assistant')
    ) {
      effectiveSystemPrompt = systemPromptOrGameProjectJson;
    } else {
      effectiveSystemPrompt = buildSystemPrompt({
        gameProjectJson: systemPromptOrGameProjectJson,
        projectSpecificExtensionsSummaryJson,
        mode: (mode: any),
      });
    }
  }

  if (effectiveSystemPrompt) {
    openAiMessages.push({
      role: 'system',
      content: effectiveSystemPrompt,
    });
  }

  for (const msg of outputMessages || []) {
    if (
      msg.role === 'user' ||
      msg.type === 'user' ||
      (msg.type === 'message' && msg.role === 'user')
    ) {
      const text =
        msg.text ||
        (typeof msg.content === 'string' ? msg.content : '') ||
        (Array.isArray(msg.content)
          ? msg.content
              .filter(item => item.type === 'user_request' || item.text)
              .map(item => item.text)
              .join('\n')
          : '');
      openAiMessages.push({
        role: 'user',
        content: text,
      });
    } else if (
      msg.role === 'assistant' ||
      msg.type === 'assistant' ||
      (msg.type === 'message' && msg.role === 'assistant')
    ) {
      const content = msg.text || '';
      const toolCalls = [];

      // Extract function calls
      if (Array.isArray(msg.functionCalls)) {
        for (const fc of msg.functionCalls) {
          toolCalls.push({
            id: fc.id || `call_${Date.now()}`,
            type: 'function',
            function: {
              name: fc.name,
              arguments:
                typeof fc.callArguments === 'string'
                  ? fc.callArguments
                  : JSON.stringify(fc.callArguments || {}),
            },
          });
        }
      }

      if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'function_call') {
            toolCalls.push({
              id:
                item.call_id || item.callId || item.id || `call_${Date.now()}`,
              type: 'function',
              function: {
                name: item.name,
                arguments:
                  typeof item.arguments === 'string'
                    ? item.arguments
                    : JSON.stringify(item.arguments || {}),
              },
            });
          }
        }
      }

      const assistantMsg: Object = {
        role: 'assistant',
        content: content || null,
      };
      if (toolCalls.length > 0) {
        // De-duplicate tool calls by ID
        const seenCallIds = new Set<string>();
        const uniqueToolCalls = [];
        for (const tc of toolCalls) {
          if (!seenCallIds.has(tc.id)) {
            seenCallIds.add(tc.id);
            uniqueToolCalls.push(tc);
          }
        }
        assistantMsg.tool_calls = uniqueToolCalls;
      }
      openAiMessages.push(assistantMsg);
    } else if (msg.type === 'function_call_output' || msg.role === 'tool') {
      if (Array.isArray(msg.functionCallOutputs)) {
        for (const fco of msg.functionCallOutputs) {
          openAiMessages.push({
            role: 'tool',
            tool_call_id: fco.callId || fco.call_id || fco.id,
            content:
              typeof fco.output === 'string'
                ? fco.output
                : JSON.stringify(fco.output || {}),
          });
        }
      } else {
        openAiMessages.push({
          role: 'tool',
          tool_call_id: msg.callId || msg.call_id || msg.id,
          content:
            typeof msg.output === 'string'
              ? msg.output
              : JSON.stringify(msg.output || {}),
        });
      }
    }
  }

  // Ensure consecutive tool outputs don't have duplicate tool_call_id
  const seenToolOutputIds = new Set<string>();
  return openAiMessages.filter(msg => {
    if (msg.role === 'tool' && msg.tool_call_id) {
      if (seenToolOutputIds.has(msg.tool_call_id)) {
        return false;
      }
      seenToolOutputIds.add(msg.tool_call_id);
    }
    return true;
  });
};

/**
 * Build the system prompt with project structure and guidelines.
 *
 * `role` and `spawnContextNote` are the studio's additions (see
 * `AiGeneration/Studio/`). Both are optional: with neither, the prompt is exactly
 * what the chat and the hosted-style agent turns have always used.
 */
export const buildSystemPrompt = ({
  gameProjectJson,
  projectSpecificExtensionsSummaryJson,
  mode,
  role,
  spawnContextNote,
}: {|
  gameProjectJson?: string | null,
  projectSpecificExtensionsSummaryJson?: string | null,
  mode?: 'chat' | 'agent' | 'orchestrator',
  role?: string | null,
  spawnContextNote?: string | null,
|}): string => {
  const rolePrompt = role ? getStudioRole((role: any)).systemPrompt : null;

  let prompt = rolePrompt
    ? `${rolePrompt}

You are working inside GDevelop, the game engine this project is built with. The tools you can call are restricted to the ones your role is granted: if you need something you cannot do, report it instead of trying another route.

`
    : '';

  prompt += `You are GDevelop AI Assistant, an expert game engine developer. You help users build games in GDevelop 5.

Guidelines:
1. Always use available tools/functions to inspect or modify the project.
2. When creating objects, use \`create_or_replace_object\`.
3. When adding behaviors, use \`add_behavior\`.
4. When placing instances in scenes, use \`put_2d_instances\` or \`put_3d_instances\`.
5. When changing scene properties (e.g. background color), use \`change_scene_properties_layers_effects_groups\`.
6. To modify scene events:
   Call add_scene_events.
7. If using run_script:
   You MUST sequentially await every function call with \`await\` (e.g. \`await change_scene_properties_layers_effects_groups({ scene_name: '...', changed_properties: [{ property_name: 'backgroundColor', new_value: '#123456' }] });\`). Never call editor functions concurrently or without \`await\`.

`;

  if (gameProjectJson) {
    prompt += `\nCurrent Project Structure:\n${gameProjectJson}\n`;
  }
  if (projectSpecificExtensionsSummaryJson) {
    prompt += `\nInstalled Project Extensions:\n${projectSpecificExtensionsSummaryJson}\n`;
  }
  if (spawnContextNote) {
    prompt += `\n${spawnContextNote}\n`;
  }

  return prompt;
};

/**
 * Actionable hints for the failure modes of local servers (Ollama, llama.cpp,
 * LM Studio) and BYOK providers, matched on the error payload/code. Local-first:
 * the hints point at the local machine or the endpoint config, never at a
 * GDevelop service.
 */
const LOCAL_SERVER_ERROR_HINTS = [
  {
    pattern: /out of memory|vram|more (system )?memory|memory required|cuda|insufficient memory|too large/i,
    hint:
      'The model likely does not fit in the available GPU/VRAM. Try a smaller quantization, reduce the context length, or close other GPU applications.',
  },
  {
    pattern: /model .*not found|no such model|unknown model|not loaded/i,
    hint:
      'The model may not be loaded on the server. Check the model identifier in the AI preferences, or pull/load the model first.',
  },
];

const getErrorHint = (error: any): string => {
  const haystacks: Array<string> = [];
  const data = error && error.response && error.response.data;
  if (data && data.error) {
    haystacks.push(
      typeof data.error === 'string'
        ? data.error
        : data.error.message || JSON.stringify(data.error)
    );
  }
  if (error && error.code) haystacks.push(String(error.code));
  if (error && error.message) haystacks.push(String(error.message));

  for (const { pattern, hint } of LOCAL_SERVER_ERROR_HINTS) {
    if (haystacks.some(haystack => pattern.test(haystack))) return ` (${hint})`;
  }
  if (
    error &&
    (error.code === 'ECONNREFUSED' ||
      /econnrefused|network error/i.test(String(error.message || '')))
  ) {
    return ' (The endpoint is not reachable: check the base URL and make sure the local AI server is running.)';
  }
  return '';
};

/**
 * Stream a chat completion via SSE (fetch + ReadableStream) and return the
 * same message shape as the non-streaming path. Skips malformed chunks; a
 * connection drop mid-stream surfaces as a stream error. Aborts on the
 * caller signal, on the configured timeout, or on server-side cancellation.
 */
const streamChatCompletion = async ({
  endpointUrl,
  headers,
  payload,
  signal,
  timeoutMs,
  onStreamDelta,
  apiKeyConfigured,
}: {|
  endpointUrl: string,
  headers: { [string]: string },
  payload: Object,
  signal?: ?AbortSignal,
  timeoutMs: number,
  onStreamDelta?: (partialContent: string) => void,
  apiKeyConfigured: boolean,
|}): Promise<Object> => {
  const combinedController = new AbortController();
  const abortFromCaller = () => combinedController.abort();
  if (signal) {
    if (signal.aborted) combinedController.abort();
    else signal.addEventListener('abort', abortFromCaller);
  }
  const timeoutId = setTimeout(() => combinedController.abort(), timeoutMs);

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, stream: true }),
      signal: combinedController.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `HTTP error ${response.status}`;
      try {
        const data = await response.json();
        errorMessage =
          (data && data.error && (data.error.message || data.error)) ||
          errorMessage;
      } catch (ignored) {
        // Non-JSON error body: keep the generic message.
      }
      const error = new Error(
        `AI Provider Error (${response.status}): ${errorMessage}`
      );
      // $FlowFixMe[prop-missing] attach status for hint resolution.
      error.response = {
        status: response.status,
        data: { error: { message: errorMessage } },
      };
      throw error;
    }
    if (!response.body) {
      throw new Error('The endpoint returned an empty stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls: { [index: number]: Object } = {};
    let finishReason = null;

    // Local proxies (and some Ollama builds) omit `index` on streamed tool_call
    // deltas. Naively defaulting to 0 merges every call into the first one.
    const resolveStreamToolCallIndex = (toolCall: Object): number => {
      if (typeof toolCall.index === 'number' && toolCall.index >= 0) {
        return toolCall.index;
      }
      const keys = Object.keys(toolCalls);
      const lastIndex = keys.length
        ? Math.max(...keys.map(key => Number(key)))
        : -1;
      if (toolCall.id) {
        for (const key of keys) {
          if (toolCalls[key].id === toolCall.id) return Number(key);
        }
        // New id without index: start the next slot, do not merge into 0.
        return lastIndex + 1;
      }
      // No index and no id: continue the open call (split name/args fragments).
      // A second distinct call must carry an id to get its own slot.
      return lastIndex >= 0 ? lastIndex : 0;
    };

    const processSseLine = (rawLine: string) => {
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch (ignored) {
        return; // malformed chunk: skip, the stream may recover.
      }
      const choice = chunk && chunk.choices && chunk.choices[0];
      if (!choice) return;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string') content += delta.content;
      if (Array.isArray(delta.tool_calls)) {
        for (const toolCall of delta.tool_calls) {
          const index = resolveStreamToolCallIndex(toolCall);
          const existing = toolCalls[index];
          if (!existing) {
            toolCalls[index] = {
              id: toolCall.id,
              type: toolCall.type || 'function',
              function: {
                name: (toolCall.function && toolCall.function.name) || '',
                arguments:
                  (toolCall.function && toolCall.function.arguments) || '',
              },
            };
          } else {
            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.function && toolCall.function.name) {
              existing.function.name =
                (existing.function.name || '') + toolCall.function.name;
            }
            if (
              toolCall.function &&
              typeof toolCall.function.arguments === 'string'
            ) {
              existing.function.arguments += toolCall.function.arguments;
            }
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (onStreamDelta) onStreamDelta(content);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep the trailing partial line.
      for (const line of lines) processSseLine(line);
    }
    // Connection close leaves a partial line in `buffer` and undecoded
    // multi-byte state in `decoder` — process both so a final data: event
    // without a trailing newline is not discarded.
    buffer += decoder.decode();
    if (buffer) processSseLine(buffer);

    const toolCallsArray = Object.keys(toolCalls)
      .map(index => toolCalls[index])
      .filter(toolCall => toolCall && toolCall.function.name);

    if (
      !content &&
      toolCallsArray.length === 0 &&
      finishReason !== 'stop' &&
      finishReason !== 'tool_calls'
    ) {
      throw new Error(
        'The AI provider stream ended without any content (connection may have been dropped mid-stream).'
      );
    }

    const message = { role: 'assistant', content };
    if (toolCallsArray.length > 0) message.tool_calls = toolCallsArray;
    return message;
  } catch (error) {
    if (signal && signal.aborted) {
      throw new Error('AI request was aborted.');
    }
    if (error && error.name === 'AbortError') {
      // Flag stream timeouts so sendChatCompletion does not immediately start
      // a second non-streaming request that would wait another full timeoutMs.
      const timeoutError: Error & { isStreamTimeout?: boolean } = new Error(
        `The request timed out or was aborted after ${timeoutMs} ms (streaming). Increase the timeout in the AI preferences for slow local models.`
      );
      timeoutError.isStreamTimeout = true;
      throw timeoutError;
    }
    if (
      error instanceof TypeError &&
      /failed to fetch|networkerror|load failed/i.test(error.message || '')
    ) {
      throw new Error(
        `The endpoint is not reachable: check the base URL and make sure the local AI server is running. Original error: ${
          error.message
        }`
      );
    }
    // Streaming is not universally supported: let the caller retry without it.
    // $FlowFixMe[prop-missing]
    error.isStreamUnsupported = !!(error.response && error.response.status);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', abortFromCaller);
  }
};

/**
 * Send a chat completion request to the OpenAI-compatible endpoint.
 */
export const sendChatCompletion = async ({
  messages,
  tools,
  config,
  signal,
  onStreamDelta,
}: {|
  messages: Array<Object>,
  tools?: ?Array<Object>,
  config?: ?CustomAIConfig,
  signal?: ?AbortSignal,
  onStreamDelta?: (partialContent: string) => void,
|}): Promise<Object> => {
  const currentConfig = config || getCustomEndpointConfig();
  const baseUrl = normalizeBaseUrl(currentConfig.baseUrl);
  const endpointUrl = getEndpointUrl(baseUrl, '/chat/completions');

  const headers: { [string]: string } = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://gdevelop.io',
    'X-Title': 'GDevelop IDE',
  };
  // Apply only safe custom headers; never let them replace Content-Type or
  // inject CR/LF, even when the config object skipped sanitizeCustomAIConfig.
  const customHeaders = currentConfig.customHeaders || {};
  for (const headerName of Object.keys(customHeaders)) {
    const headerValue = customHeaders[headerName];
    if (isSafeRequestHeader(headerName, headerValue)) {
      headers[headerName] = headerValue;
    }
  }

  if (currentConfig.apiKey && currentConfig.apiKey.trim()) {
    headers['Authorization'] = `Bearer ${currentConfig.apiKey.trim()}`;
  }

  const timeoutMs =
    typeof currentConfig.timeoutMs === 'number' && currentConfig.timeoutMs > 0
      ? currentConfig.timeoutMs
      : 120000;

  const payload: Object = {
    model: currentConfig.model || 'qwen2.5-coder',
    messages,
    temperature:
      typeof currentConfig.temperature === 'number'
        ? currentConfig.temperature
        : 0.7,
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  if (currentConfig.maxTokens) {
    payload.max_tokens = currentConfig.maxTokens;
  }

  if (currentConfig.streaming && typeof fetch !== 'undefined') {
    try {
      return await streamChatCompletion({
        endpointUrl,
        headers,
        payload,
        signal,
        timeoutMs,
        onStreamDelta,
        apiKeyConfigured: !!(
          currentConfig.apiKey && currentConfig.apiKey.trim()
        ),
      });
    } catch (streamError) {
      // A user abort must not trigger a retry: the caller signal is already
      // aborted and the non-streaming request would immediately fail too.
      if (signal && signal.aborted) throw streamError;
      // Stream timeouts already waited timeoutMs — a non-streaming retry would
      // double the stall. Surface the timeout immediately with its guidance.
      // $FlowFixMe[prop-missing] optional flag set by streamChatCompletion.
      if (streamError && streamError.isStreamTimeout) throw streamError;
      // Some endpoints reject streaming or drop mid-stream; a single
      // non-streaming retry keeps the turn alive at worst-case latency.
      console.warn(
        'Streaming failed, retrying without streaming:',
        streamError.message
      );
    }
  }

  try {
    // axios >=0.22 accepts the AbortSignal directly (and releases the
    // listener when the request settles) — no CancelToken bridge needed.
    const response = await axios.post(endpointUrl, payload, {
      headers,
      signal: signal || undefined,
      timeout: timeoutMs,
    });

    if (
      response.data &&
      response.data.choices &&
      response.data.choices[0] &&
      response.data.choices[0].message
    ) {
      return response.data.choices[0].message;
    }

    return response.data;
  } catch (error) {
    if (axios.isCancel(error) || (signal && signal.aborted)) {
      throw new Error('AI request was aborted.');
    }
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      const errorMsg =
        (data && data.error && (data.error.message || data.error)) ||
        error.message ||
        `HTTP error ${status}`;
      const hasApiKey = !!(currentConfig.apiKey && currentConfig.apiKey.trim());
      const authHint =
        status === 401 && !hasApiKey
          ? ' (No API key is configured for this endpoint — set one in the AI preferences if the provider requires it.)'
          : '';
      throw new Error(
        `AI Provider Error (${status}): ${errorMsg}${authHint}${getErrorHint(
          error
        )}`
      );
    }
    // No response at all (server down, network split, DNS): add the local
    // reachability/model hints when they match.
    const networkHint = getErrorHint(error);
    throw networkHint
      ? new Error(`${error.message || 'AI request failed.'}${networkHint}`)
      : error;
  }
};

const SIDE_EFFECT_FREE_TOOLS = new Set([
  'describe_instances',
  'describe_events',
  'describe_scene_layers_effects_groups',
  'describe_variables',
  'read_game_project_json',
  'read_full_docs',
  'search_docs',
  'get_game_starter_summary',
]);

/**
 * Parse an OpenAI assistant message response into GDevelop's internal format.
 */
/**
 * Validate parsed tool-call arguments against the tool's declared JSON Schema
 * (subset: required properties, primitive types, enum values). Unknown tools
 * pass — the schema registry is the source of truth only for known tools.
 */
export const validateToolCallArguments = (
  toolName: string,
  parsedArgs: Object,
  tools?: Array<Object> = GDEVELOP_OPENAI_TOOLS
): {| valid: boolean, errors: Array<string> |} => {
  const errors: Array<string> = [];
  const tool = tools.find(
    candidate =>
      candidate && candidate.function && candidate.function.name === toolName
  );
  const schema = tool && tool.function ? tool.function.parameters : null;
  if (
    !schema ||
    typeof schema !== 'object' ||
    !schema.properties ||
    typeof parsedArgs !== 'object' ||
    parsedArgs === null ||
    Array.isArray(parsedArgs)
  ) {
    return { valid: true, errors };
  }

  const required: Array<string> = Array.isArray(schema.required)
    ? schema.required
    : [];
  for (const requiredName of required) {
    if (!(requiredName in parsedArgs)) {
      errors.push(`Missing required argument '${requiredName}'.`);
    }
  }

  const TYPE_CHECKS = {
    string: value => typeof value === 'string',
    number: value => typeof value === 'number' && !Number.isNaN(value),
    boolean: value => typeof value === 'boolean',
    object: value =>
      typeof value === 'object' && value !== null && !Array.isArray(value),
    array: value => Array.isArray(value),
  };

  for (const argName of Object.keys(parsedArgs)) {
    const propertySchema = schema.properties[argName];
    if (!propertySchema) {
      errors.push(`Unknown argument '${argName}' (not in the tool schema).`);
      continue;
    }
    const expectedType = propertySchema.type;
    const check = expectedType && TYPE_CHECKS[expectedType];
    if (check && !check(parsedArgs[argName])) {
      errors.push(`Argument '${argName}' should be of type '${expectedType}'.`);
      continue;
    }
    if (
      check &&
      expectedType === 'string' &&
      Array.isArray(propertySchema.enum) &&
      !propertySchema.enum.includes(parsedArgs[argName])
    ) {
      errors.push(
        `Argument '${argName}' must be one of: ${propertySchema.enum
          .map(value => `'${value}'`)
          .join(', ')}.`
      );
    }
  }

  return { valid: errors.length === 0, errors };
};

export const parseAssistantMessage = (
  openAiMessageOrChoiceOrResponse: Object,
  messageId?: string
): AiRequestMessage => {
  const openAiMessage =
    openAiMessageOrChoiceOrResponse.message ||
    (openAiMessageOrChoiceOrResponse.choices &&
      openAiMessageOrChoiceOrResponse.choices[0] &&
      openAiMessageOrChoiceOrResponse.choices[0].message) ||
    openAiMessageOrChoiceOrResponse;

  const rawContent = openAiMessage.content || '';
  const reasoningContent = openAiMessage.reasoning_content || null;

  let { thinking, cleanContent } = extractThinkingAndContent(rawContent);
  if (!thinking && reasoningContent) {
    thinking = reasoningContent;
  }

  const contentArray: Array<any> = [];
  if (cleanContent) {
    contentArray.push({
      type: 'text',
      status: 'completed',
      text: cleanContent,
    });
  }

  const functionCalls: Array<any> = [];

  // Standard tool_calls
  if (Array.isArray(openAiMessage.tool_calls)) {
    for (const toolCall of openAiMessage.tool_calls) {
      if (toolCall.function) {
        const functionName = toolCall.function.name;
        const functionArgs = toolCall.function.arguments;
        let parsedArgs = {};
        let argsValid = false;
        try {
          parsedArgs =
            typeof functionArgs === 'string'
              ? JSON.parse(functionArgs)
              : functionArgs || {};
          // Arguments must be a JSON object — arrays or scalars would break
          // tool implementations that read named properties.
          argsValid =
            !!parsedArgs &&
            typeof parsedArgs === 'object' &&
            !Array.isArray(parsedArgs);
        } catch (e) {
          console.warn('Error parsing function call arguments JSON:', e);
        }
        if (!argsValid) {
          parsedArgs = {};
          console.warn(
            `Tool call '${String(
              functionName
            )}' had invalid arguments; executing with empty arguments.`
          );
        } else {
          const validation = validateToolCallArguments(
            String(functionName),
            parsedArgs
          );
          if (!validation.valid) {
            parsedArgs = {};
            console.warn(
              `Tool call '${String(
                functionName
              )}' arguments failed schema validation: ${validation.errors.join(
                ' '
              )} Executing with empty arguments.`
            );
          }
        }
        const callId =
          toolCall.id ||
          `call_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 5)}`;
        contentArray.push({
          type: 'function_call',
          status: 'completed',
          call_id: callId,
          name: functionName,
          // Round-trip the sanitized arguments so the tool executes exactly
          // what was validated, not the malformed original.
          arguments: argsValid
            ? JSON.stringify(parsedArgs)
            : typeof functionArgs === 'string' && functionArgs
            ? functionArgs
            : '{}',
        });
        functionCalls.push({
          id: callId,
          name: functionName,
          callArguments: parsedArgs,
        });
      }
    }
  }

  // Fallback: If no tool_calls but content contains markdown JSON tool call blocks (restricted to side-effect-free tools)
  if (
    (!openAiMessage.tool_calls || openAiMessage.tool_calls.length === 0) &&
    cleanContent
  ) {
    const jsonBlockRegex = /```(?:json)?\s*(\{\s*"(?:function|name|tool)":[\s\S]*?\})\s*```/gi;
    let match;
    while ((match = jsonBlockRegex.exec(cleanContent)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        const name = parsed.function || parsed.name || parsed.tool;
        const args = parsed.arguments || parsed.args || parsed.parameters || {};
        if (
          name &&
          typeof name === 'string' &&
          SIDE_EFFECT_FREE_TOOLS.has(name)
        ) {
          const callId = `call_parsed_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 5)}`;
          // Same contract as the tool_calls path (cycle-10/11 hardening):
          // arguments must parse to a non-array object, validated against
          // the tool schema before execution.
          let parsedArgsObj;
          try {
            parsedArgsObj = typeof args === 'string' ? JSON.parse(args) : args;
          } catch (argsParseErr) {
            parsedArgsObj = null;
          }
          const argsValid =
            !!parsedArgsObj &&
            typeof parsedArgsObj === 'object' &&
            !Array.isArray(parsedArgsObj);
          const validation = validateToolCallArguments(
            String(name),
            argsValid ? parsedArgsObj : {}
          );
          if (!argsValid || !validation.valid) {
            console.warn(
              `Parsed tool call '${String(
                name
              )}' had invalid arguments; skipping it.`
            );
            continue;
          }
          contentArray.push({
            type: 'function_call',
            status: 'completed',
            call_id: callId,
            name,
            arguments: JSON.stringify(parsedArgsObj),
          });
          functionCalls.push({
            id: callId,
            name,
            callArguments: parsedArgsObj,
          });
        }
      } catch (e) {
        // Not a tool call JSON block, ignore
      }
    }
  }

  return {
    type: 'message',
    status: 'completed',
    role: 'assistant',
    text: cleanContent,
    thinking,
    functionCalls,
    content: contentArray,
    messageId: messageId || `msg-asst-${Date.now()}`,
  };
};

/**
 * Client-side Create AI Request implementation.
 */
export const customCreateAiRequest = async ({
  userRequest,
  gameProjectJson,
  projectSpecificExtensionsSummaryJson,
  mode,
  aiConfiguration,
  gameId,
}: {|
  userRequest: string,
  gameProjectJson: string | null,
  projectSpecificExtensionsSummaryJson: string | null,
  mode?: 'chat' | 'agent' | 'orchestrator',
  aiConfiguration?: any,
  gameId?: string | null,
|}): Promise<AiRequest> => {
  const reqId = `local-ai-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 7)}`;
  const userMsgId = `msg-user-${Date.now()}`;
  const assistantMsgId = `msg-asst-${Date.now()}`;

  const userMessage: AiRequestUserMessage = {
    type: 'message',
    status: 'completed',
    role: 'user',
    content: [
      {
        type: 'user_request',
        status: 'completed',
        text: userRequest,
      },
    ],
    messageId: userMsgId,
  };

  const output: Array<AiRequestMessage> = [userMessage];

  const systemPrompt = buildSystemPrompt({
    gameProjectJson,
    projectSpecificExtensionsSummaryJson,
    mode,
  });

  const openAiMessages = transformGDevelopMessagesToOpenAi(
    output,
    systemPrompt
  );

  // Same budget as later turns: a create with a large embedded project
  // structure must fit a small local model before the first request is sent.
  const createConfig = getEffectiveConfigForRequest(reqId);
  const budgetedMessages = trimMessagesToBudget(
    openAiMessages,
    getTokenBudget(createConfig)
  );
  noteSystemCompactedIfChanged(reqId, openAiMessages, budgetedMessages);
  if (budgetedMessages.length < openAiMessages.length) {
    const trimmedCount = openAiMessages.length - budgetedMessages.length;
    localAiRequestTrimCounts[reqId] =
      (localAiRequestTrimCounts[reqId] || 0) + trimmedCount;
    console.warn(
      `[CustomAIClient] Trimmed ${trimmedCount} old message(s) to fit the model context budget.`
    );
  }

  const abortController = registerTurnAbortController(reqId);
  let assistantResponse;
  try {
    assistantResponse = await sendChatCompletion({
      messages: budgetedMessages,
      tools: GDEVELOP_OPENAI_TOOLS,
      config: createConfig,
      signal: abortController.signal,
    });
  } catch (error) {
    // Persist the request even when the first turn fails so the chat has a
    // transcript (user message) and the error row can offer Retry → continue,
    // matching ordinary addMessage failures (cycle 50) and hosted UX.
    const now = new Date().toISOString();
    const aborted = abortController.signal.aborted;
    const failed: AiRequest = {
      id: reqId,
      createdAt: now,
      updatedAt: now,
      userId: LOCAL_BYOK_USER_ID,
      gameId: gameId || null,
      gameProjectJson: gameProjectJson || null,
      status: aborted ? 'suspended' : 'error',
      mode: mode || 'orchestrator',
      aiConfiguration: aiConfiguration || { presetId: 'default' },
      toolsVersion: 'v14',
      toolOptions: null,
      error: aborted
        ? null
        : {
            code: 'server_error',
            message: (error && error.message) || String(error),
          },
      output,
      lastUserMessagePriceInCredits: 0,
      totalPriceInCredits: 0,
    };
    localAiRequestsCache[reqId] = failed;
    saveLocalAiRequests();
    return failed;
  } finally {
    releaseTurnAbortController(reqId);
  }

  const assistantMessage = parseAssistantMessage(
    assistantResponse,
    assistantMsgId
  );
  output.push(assistantMessage);

  // Same accounting as addMessage / sub-agent turns: the chat's local cost
  // meter must include the first turn, not only later continues.
  addTokenUsage(
    reqId,
    estimateMessagesTokens(budgetedMessages),
    estimateTokens(assistantResponse.content)
  );

  const now = new Date().toISOString();
  const aiRequest: AiRequest = {
    id: reqId,
    createdAt: now,
    updatedAt: now,
    userId: LOCAL_BYOK_USER_ID,
    gameId: gameId || null,
    gameProjectJson: gameProjectJson || null,
    status: 'ready',
    mode: mode || 'orchestrator',
    aiConfiguration: aiConfiguration || { presetId: 'default' },
    toolsVersion: 'v14',
    toolOptions: null,
    error: null,
    output,
    lastUserMessagePriceInCredits: 0,
    totalPriceInCredits: 0,
  };

  localAiRequestsCache[reqId] = aiRequest;
  saveLocalAiRequests();

  return aiRequest;
};

/**
 * Client-side Add Message To AI Request implementation.
 */
export const customAddMessageToAiRequest = async ({
  aiRequestId,
  userMessage,
  functionCallOutputs,
  gameProjectJson,
  projectSpecificExtensionsSummaryJson,
  mode,
}: {|
  aiRequestId: string,
  userMessage?: string,
  functionCallOutputs?: Array<AiRequestFunctionCallOutput>,
  gameProjectJson?: string | null,
  projectSpecificExtensionsSummaryJson?: string | null,
  mode?: 'chat' | 'agent' | 'orchestrator',
|}): Promise<AiRequest> => {
  return withLocalAiTurnLock(aiRequestId, async () => {
    const existing = localAiRequestsCache[aiRequestId] || {
      id: aiRequestId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId: LOCAL_BYOK_USER_ID,
      status: 'ready',
      output: [],
      error: null,
    };

    const output = [...(existing.output || [])];

    if (functionCallOutputs && functionCallOutputs.length > 0) {
      for (const fcOutput of functionCallOutputs) {
        output.push({
          type: 'function_call_output',
          call_id: fcOutput.call_id,
          output: fcOutput.output,
          messageId: `msg-fco-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 4)}`,
        });
      }
    }

    if (userMessage && userMessage.trim()) {
      output.push({
        type: 'message',
        status: 'completed',
        role: 'user',
        content: [
          {
            type: 'user_request',
            status: 'completed',
            text: userMessage,
          },
        ],
        messageId: `msg-user-${Date.now()}`,
      });
    }

    // The role a studio sub-agent was spawned with must shape every turn, not
    // just the first: keep its prompt and tool subset.
    const studioRoleId = existing.studioRoleId || null;

    const systemPrompt = buildSystemPrompt({
      gameProjectJson,
      projectSpecificExtensionsSummaryJson,
      mode: mode || existing.mode,
      role: studioRoleId,
    });

    const openAiMessages = transformGDevelopMessagesToOpenAi(
      output,
      systemPrompt
    );

    // Local models have small context windows: trim replayed history (never
    // the system prompt or the newest exchange) before burning the request.
    const budgetedMessages = trimMessagesToBudget(
      openAiMessages,
      getTokenBudget(getEffectiveConfigForRequest(aiRequestId))
    );
    noteSystemCompactedIfChanged(aiRequestId, openAiMessages, budgetedMessages);
    if (budgetedMessages.length < openAiMessages.length) {
      const trimmedCount = openAiMessages.length - budgetedMessages.length;
      localAiRequestTrimCounts[aiRequestId] =
        (localAiRequestTrimCounts[aiRequestId] || 0) + trimmedCount;
      console.warn(
        `[CustomAIClient] Trimmed ${trimmedCount} old message(s) to fit the model context budget.`
      );
    }

    const abortController = registerTurnAbortController(aiRequestId);
    let assistantResponse;
    try {
      assistantResponse = await sendChatCompletion({
        messages: budgetedMessages,
        tools: studioRoleId
          ? getToolsForRole((studioRoleId: any), GDEVELOP_OPENAI_TOOLS)
          : GDEVELOP_OPENAI_TOOLS,
        config: getEffectiveConfigForRequest(aiRequestId),
        signal: abortController.signal,
        onStreamDelta: partialContent => {
          localAiRequestPartialContent[aiRequestId] = partialContent;
        },
      });
    } catch (error) {
      releaseTurnAbortController(aiRequestId);
      delete localAiRequestPartialContent[aiRequestId];
      if (abortController.signal.aborted) {
        // The turn was stopped by the user (suspended): keep the suspended
        // cache copy — the turn's answer (if any arrived) is not written back
        // and no error surfaces for a stop the user asked for.
        return localAiRequestsCache[aiRequestId] || existing;
      }
      // Terminal model failure: flip status to error so the chat's error row
      // (and Retry → continue turn) is offered, matching hosted /action/retry
      // UX. Returning (not throwing) lets the container's updateAiRequest
      // sync the React state. Persist local `output` (user message /
      // function-call outputs) so the continue turn has the full transcript.
      const current = localAiRequestsCache[aiRequestId] || existing;
      const existingIds = new Set(
        (existing.output || []).map(message => message.messageId)
      );
      const cacheOnly = (current.output || []).filter(
        message =>
          !existingIds.has(message.messageId) &&
          !output.some(own => own.messageId === message.messageId)
      );
      const failed: AiRequest = {
        ...current,
        output: [...output, ...cacheOnly],
        status: 'error',
        updatedAt: new Date().toISOString(),
        error: {
          code: 'server_error',
          message: (error && error.message) || String(error),
        },
      };
      localAiRequestsCache[aiRequestId] = failed;
      saveLocalAiRequests();
      return failed;
    }
    releaseTurnAbortController(aiRequestId);
    delete localAiRequestPartialContent[aiRequestId];
    addTokenUsage(
      aiRequestId,
      estimateMessagesTokens(budgetedMessages),
      estimateTokens(assistantResponse.content)
    );

    const assistantMsgId = `msg-asst-${Date.now()}`;
    const assistantMessage = parseAssistantMessage(
      assistantResponse,
      assistantMsgId
    );
    output.push(assistantMessage);

    const currentCachedRequest = localAiRequestsCache[aiRequestId] || existing;
    // A suggestion or suspension write that landed while the model was
    // answering must not be discarded (W5): re-insert cache-only messages
    // before the turn's own additions.
    const turnIds = new Set(output.map(message => message.messageId));
    const cacheOnlyMessages = (currentCachedRequest.output || []).filter(
      message => message && !turnIds.has(message.messageId)
    );
    let merged = output;
    if (cacheOnlyMessages.length > 0) {
      const appendedThisTurn = (userMessage && userMessage.trim() ? 1 : 0) + 1;
      const turnStart = Math.max(0, output.length - appendedThisTurn);
      merged = [
        ...output.slice(0, turnStart),
        ...cacheOnlyMessages,
        ...output.slice(turnStart),
      ];
    }
    const updatedAiRequest: AiRequest = {
      // Read the cache again, inside the lock: a suspend or a suggestion write
      // that landed while the model was answering must not be discarded.
      ...currentCachedRequest,
      updatedAt: new Date().toISOString(),
      // A request suspended during the turn stays suspended: writing the answer
      // back must not silently resume it. It keeps the new output so the user
      // can read what the agent produced before it was stopped.
      status:
        currentCachedRequest.status === 'suspended' ? 'suspended' : 'ready',
      // A successful turn clears any prior terminal error: leave it set and
      // FinalizeSubAgents / any status-agnostic reader sees a false failure.
      error: null,
      output: merged,
    };

    localAiRequestsCache[aiRequestId] = updatedAiRequest;
    saveLocalAiRequests();

    return updatedAiRequest;
  });
};

/**
 * Create the `AiRequest` of one studio sub-agent: a child of `parentAiRequestId`,
 * with the role's prompt and tool subset, that runs exactly one model turn.
 *
 * The child is never listed as a top-level chat: it has a `parentAiRequestId`, so
 * the history ignores it (`AiRequestContext.updateAiRequest`).
 */
export const customCreateSubAgentAiRequest = async ({
  parentAiRequestId,
  roleId,
  userRequest,
  gameProjectJson,
  projectSpecificExtensionsSummaryJson,
  spawnContextNote,
}: {|
  parentAiRequestId: string,
  roleId: string,
  userRequest: string,
  gameProjectJson: string | null,
  projectSpecificExtensionsSummaryJson: string | null,
  spawnContextNote?: string | null,
|}): Promise<AiRequest> => {
  const reqId = `local-ai-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 7)}`;

  return withLocalAiTurnLock(reqId, async () => {
    const userMessage: AiRequestUserMessage = {
      type: 'message',
      status: 'completed',
      role: 'user',
      content: [
        {
          type: 'user_request',
          status: 'completed',
          text: userRequest,
        },
      ],
      messageId: `msg-user-${Date.now()}`,
    };

    const output: Array<AiRequestMessage> = [userMessage];

    const systemPrompt = buildSystemPrompt({
      gameProjectJson,
      projectSpecificExtensionsSummaryJson,
      mode: 'agent',
      role: roleId,
      spawnContextNote,
    });

    const openAiMessages = transformGDevelopMessagesToOpenAi(
      output,
      systemPrompt
    );

    const budgetedMessages = trimMessagesToBudget(
      openAiMessages,
      getTokenBudget(getEffectiveConfigForRequest(parentAiRequestId || reqId))
    );
    noteSystemCompactedIfChanged(
      parentAiRequestId || reqId,
      openAiMessages,
      budgetedMessages
    );
    if (budgetedMessages.length < openAiMessages.length) {
      const trimmedCount = openAiMessages.length - budgetedMessages.length;
      const countKey = parentAiRequestId || reqId;
      localAiRequestTrimCounts[countKey] =
        (localAiRequestTrimCounts[countKey] || 0) + trimmedCount;
      console.warn(
        `[CustomAIClient] Trimmed ${trimmedCount} old message(s) to fit the model context budget.`
      );
    }

    const abortController = registerTurnAbortController(
      reqId,
      parentAiRequestId
    );
    let assistantResponse;
    try {
      assistantResponse = await sendChatCompletion({
        messages: budgetedMessages,
        tools: getToolsForRole((roleId: any), GDEVELOP_OPENAI_TOOLS),
        config: getEffectiveConfigForRequest(parentAiRequestId || reqId),
        signal: abortController.signal,
      });
    } finally {
      releaseTurnAbortController(reqId);
    }
    addTokenUsage(
      parentAiRequestId || reqId,
      estimateMessagesTokens(budgetedMessages),
      estimateTokens(assistantResponse.content)
    );

    const assistantMessage = parseAssistantMessage(
      assistantResponse,
      `msg-asst-${Date.now()}`
    );
    output.push(assistantMessage);

    const now = new Date().toISOString();
    const aiRequest: AiRequest = {
      id: reqId,
      createdAt: now,
      updatedAt: now,
      userId: LOCAL_BYOK_USER_ID,
      gameProjectJson: gameProjectJson || null,
      status: 'ready',
      mode: 'agent',
      aiConfiguration: { presetId: 'default' },
      toolsVersion: 'v14',
      toolOptions: null,
      parentAiRequestId: parentAiRequestId,
      studioRoleId: roleId,
      error: null,
      output,
      lastUserMessagePriceInCredits: 0,
      totalPriceInCredits: 0,
    };

    localAiRequestsCache[reqId] = aiRequest;
    saveLocalAiRequests();

    return aiRequest;
  });
};

/**
 * Client-side Get AI Request.
 */
export const customGetAiRequest = (aiRequestId: string): AiRequest => {
  const request = localAiRequestsCache[aiRequestId];
  if (request) return request;

  const now = new Date().toISOString();
  const fallback: AiRequest = {
    id: aiRequestId,
    createdAt: now,
    updatedAt: now,
    userId: LOCAL_BYOK_USER_ID,
    status: 'ready',
    error: null,
    output: [],
  };
  return fallback;
};

/**
 * Client-side Get AI Requests list.
 */
export const customGetAiRequests = (): {
  aiRequests: Array<AiRequest>,
  nextPageUri: ?string,
} => {
  loadLocalAiRequests();
  const requests = Object.values(localAiRequestsCache);
  requests.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  return {
    aiRequests: requests,
    nextPageUri: null,
  };
};

/**
 * Client-side Get AI Request Statuses.
 */
export const customGetAiRequestStatuses = (
  aiRequestIds: Array<string>
): Array<{| id: string, status: GenerationStatus, userId: ?string |}> => {
  return aiRequestIds.map(id => {
    const req = localAiRequestsCache[id];
    return {
      id,
      status: req ? req.status : 'ready',
      userId: LOCAL_BYOK_USER_ID,
    };
  });
};

/**
 * Client-side Suspend AI Request.
 */
export const customSuspendAiRequest = (aiRequestId: string): AiRequest => {
  const existing = localAiRequestsCache[aiRequestId];
  if (existing) {
    // Replace the cached request rather than mutating it in place: a model turn
    // may be holding a reference to it and will write its own copy back.
    const now = new Date().toISOString();
    const suspended: AiRequest = {
      ...existing,
      status: 'suspended',
      updatedAt: now,
    };
    localAiRequestsCache[aiRequestId] = suspended;
    // A parent Stop must not leave BYOK-burning children running: cancel any
    // in-flight model turn (the aborted turn keeps the suspended cache copy)
    // and suspend every sub-agent of this request too.
    abortTurnsForRequest(aiRequestId);
    for (const key of Object.keys(localAiRequestsCache)) {
      const child = localAiRequestsCache[key];
      if (child && child.parentAiRequestId === aiRequestId) {
        localAiRequestsCache[key] = {
          ...child,
          status: 'suspended',
          updatedAt: now,
        };
      }
    }
    saveLocalAiRequests();
    return suspended;
  }
  return customGetAiRequest(aiRequestId);
};

/**
 * Client-side update write-through: a mutated request is written back to the
 * local cache so plan flips and the loop guard's `status: 'error'` are not
 * reverted by the next cache fetch. Content-idempotent.
 */
export const customUpdateAiRequest = (aiRequest: AiRequest): void => {
  localAiRequestsCache[aiRequest.id] = aiRequest;
  saveLocalAiRequests();
};

/**
 * Client-side Delete AI Request: drop it (and any per-request registries)
 * from the local cache. Mirrors the hosted DELETE /ai-request/{id}.
 */
export const customDeleteAiRequest = (aiRequestId: string): void => {
  // Cancel any in-flight turn before dropping the request so a late write
  // cannot resurrect it in the cache.
  abortTurnsForRequest(aiRequestId);
  delete localAiRequestsCache[aiRequestId];
  delete localAiRequestTrimCounts[aiRequestId];
  delete localAiRequestSystemCompacted[aiRequestId];
  delete localAiRequestTokenTotals[aiRequestId];
  delete localAiRequestModelOverrides[aiRequestId];
  delete localAiRequestPartialContent[aiRequestId];
  delete localAiTurnTails[aiRequestId];
  saveLocalAiRequests();
};

/**
 * Client-side PATCH of the user-editable attributes (title / archived),
 * mirroring the hosted PATCH /ai-request/{id}.
 */
export const customPatchAiRequestAttributes = (
  aiRequestId: string,
  attributes: {| title?: string | null, archived?: boolean |}
): AiRequest => {
  const existing = localAiRequestsCache[aiRequestId];
  if (!existing) return customGetAiRequest(aiRequestId);

  const now = new Date().toISOString();
  // Replace the cached request rather than mutating it in place (see
  // customSuspendAiRequest): a model turn may hold a reference to the old copy.
  const updated: AiRequest = { ...existing, updatedAt: now };
  if (attributes.title !== undefined) updated.title = attributes.title;
  if (attributes.archived !== undefined) {
    updated.archivedAt = attributes.archived ? now : null;
  }
  localAiRequestsCache[aiRequestId] = updated;
  saveLocalAiRequests();
  return updated;
};

/**
 * Client-side Retry after a failed turn: clear the terminal error, then
 * re-run one model turn with no new user message so the local path picks up
 * from the last message already in the cache (mirrors hosted
 * `/action/retry`, which resumes generation server-side).
 */
export const customRetryAiRequest = async (
  aiRequestId: string
): Promise<AiRequest> => {
  const existing = localAiRequestsCache[aiRequestId];
  if (!existing) return customGetAiRequest(aiRequestId);
  if (existing.status !== 'error') return existing;

  const outputLength = (existing.output || []).length;
  const retried: AiRequest = {
    ...existing,
    status: 'ready',
    error: null,
    updatedAt: new Date().toISOString(),
    // Track retries the same way the hosted API does so canRetryAiRequest
    // still applies to local chats after they are resumed.
    retriedAfterMessagesCount: outputLength,
    retriesInARowCount: (existing.retriesInARowCount || 0) + 1,
  };
  localAiRequestsCache[aiRequestId] = retried;
  saveLocalAiRequests();

  // No userMessage / functionCallOutputs: the turn continues from existing output.
  try {
    return await customAddMessageToAiRequest({ aiRequestId });
  } catch (error) {
    // User stopped the continued turn — leave the suspended cache copy alone.
    const current = localAiRequestsCache[aiRequestId] || retried;
    if (current.status === 'suspended') return current;
    const failed: AiRequest = {
      ...current,
      status: 'error',
      updatedAt: new Date().toISOString(),
      error: {
        code: 'server_error',
        message: (error && error.message) || String(error),
      },
    };
    localAiRequestsCache[aiRequestId] = failed;
    saveLocalAiRequests();
    // Return (do not throw) so the container's updateAiRequest syncs the
    // new error + retriesInARowCount; the error row still offers Retry.
    return failed;
  }
};

/**
 * Client-side Fork AI Request.
 */
export const customForkAiRequest = (
  aiRequestId: string,
  upToMessageId?: string
): AiRequest => {
  const original = localAiRequestsCache[aiRequestId];
  const newReqId = `local-ai-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 7)}`;
  let output = [];

  if (original && original.output) {
    if (upToMessageId) {
      const idx = original.output.findIndex(m => m.messageId === upToMessageId);
      output =
        idx >= 0 ? original.output.slice(0, idx + 1) : [...original.output];
    } else {
      output = [...original.output];
    }
  }

  const now = new Date().toISOString();
  // Clear any terminal error from the source chat: a fork starts ready. Keep
  // the per-request model override so the fork continues on the same model.
  const modelOverride = localAiRequestModelOverrides[aiRequestId];
  if (modelOverride) {
    localAiRequestModelOverrides[newReqId] = modelOverride;
  }
  const forked: AiRequest = {
    ...(original || {}),
    id: newReqId,
    createdAt: now,
    updatedAt: now,
    userId: LOCAL_BYOK_USER_ID,
    status: 'ready',
    error: null,
    forkedFromAiRequestId: aiRequestId,
    output,
  };

  localAiRequestsCache[newReqId] = forked;
  saveLocalAiRequests();
  return forked;
};

/**
 * Client-side Suggestions Generator.
 */
export const customGetAiRequestSuggestions = async (
  aiRequestId: string
): Promise<{|
  ...AiRequest,
  suggestions: Array<{| title: string, suggestedMessage: string |}>,
  explanationMessage: string,
|}> => {
  const req = customGetAiRequest(aiRequestId);
  const defaultSuggestions = {
    explanationMessage: 'Here are some things you can do next:',
    suggestions: [
      {
        title: 'Add Movement',
        suggestedMessage: 'Add top-down movement behavior',
      },
      {
        title: 'Add Collisions',
        suggestedMessage: 'Add collision events between player and obstacles',
      },
      {
        title: 'Add Sound Effects',
        suggestedMessage: 'Play a sound when collecting items',
      },
    ],
  };

  // Attach suggestions to the last assistant/function-output message in the
  // local cache and return THAT snapshot. The chat UI reads message.suggestions
  // (not the top-level fields), and callers merge this return value back over
  // the request — returning the pre-attach snapshot used to clobber the cache
  // write, so local BYOK suggestions never reached the UI.
  const attachSuggestions = (
    parsed: AiRequestSuggestions
  ): {|
    ...AiRequest,
    suggestions: Array<{| title: string, suggestedMessage: string |}>,
    explanationMessage: string,
  |} => {
    const topSuggestions = parsed.suggestions || defaultSuggestions.suggestions;
    const topExplanation =
      parsed.explanationMessage || defaultSuggestions.explanationMessage;
    // Re-read the cache: a model turn may have written the request back while
    // the suggestion model was answering.
    const latest = localAiRequestsCache[aiRequestId] || req;
    const output = latest.output || [];
    if (output.length === 0) {
      return {
        ...latest,
        suggestions: topSuggestions,
        explanationMessage: topExplanation,
      };
    }
    const lastMsgIndex = output.length - 1;
    const lastMsg = output[lastMsgIndex];
    const canAttach =
      (lastMsg.type === 'message' && lastMsg.role === 'assistant') ||
      lastMsg.type === 'function_call_output';
    if (!canAttach) {
      return {
        ...latest,
        suggestions: topSuggestions,
        explanationMessage: topExplanation,
      };
    }
    // Replace the message and the request rather than mutating in place: a
    // model turn holding this request will write its own copy back, and an
    // in-place edit would be silently discarded by that write.
    const updatedOutput = [...output];
    // $FlowFixMe[incompatible-type] - canAttach narrows to a type that accepts suggestions.
    updatedOutput[lastMsgIndex] = { ...lastMsg, suggestions: parsed };
    const updated: AiRequest = {
      ...latest,
      output: updatedOutput,
      updatedAt: new Date().toISOString(),
    };
    localAiRequestsCache[aiRequestId] = updated;
    saveLocalAiRequests();
    return {
      ...updated,
      suggestions: topSuggestions,
      explanationMessage: topExplanation,
    };
  };

  try {
    const prompt = `Based on the current GDevelop game project and conversation, provide 2 to 3 concise, helpful next step suggestions for the game creator.
Return your response STRICTLY as a JSON object with this format:
{
  "explanationMessage": "Here are some things you can do next:",
  "suggestions": [
    { "title": "Add Enemy Patrol", "suggestedMessage": "Add an enemy with patrol behavior" },
    { "title": "Add Sound Effects", "suggestedMessage": "Play sound when collecting coins" }
  ]
}`;

    const res = await sendChatCompletion({
      messages: [
        ...transformGDevelopMessagesToOpenAi(req.output || []),
        { role: 'user', content: prompt },
      ],
      config: getEffectiveConfigForRequest(aiRequestId),
    });

    const clean = (res.content || '')
      .replace(/```(?:json)?/gi, '')
      .replace(/```/gi, '')
      .trim();
    const parsed: AiRequestSuggestions = JSON.parse(clean);
    return attachSuggestions(parsed);
  } catch (err) {
    // Malformed JSON or a dropped connection: still surface defaults on the
    // last message so the chat is not stuck without next-step actions.
    return attachSuggestions({
      explanationMessage: defaultSuggestions.explanationMessage,
      suggestions: defaultSuggestions.suggestions,
    });
  }
};

/**
 * Client-side Create AI Generated Event implementation.
 */
export const customCreateAiGeneratedEvent = async ({
  sceneName,
  eventsDescription,
  eventBatches,
  extensionNamesList,
  objectsList,
  existingEventsAsText,
  aiRequestId,
}: {|
  sceneName: string,
  eventsDescription: string | null,
  eventBatches?: any,
  extensionNamesList?: string,
  objectsList?: string,
  existingEventsAsText?: string,
  aiRequestId?: string | null,
|}): Promise<CreateAiGeneratedEventResult> => {
  const prompt = `You are the GDevelop Event Generation Engine.
Generate the GDevelop events in JSON format matching GDevelop's internal event structure for scene "${sceneName}".
Description of events to generate: "${eventsDescription || ''}"
Available Objects: ${objectsList || 'None'}
Available Extensions: ${extensionNamesList || 'Builtin'}
Existing Events in Scene:
${existingEventsAsText || 'None'}

Return a valid JSON object with the following structure:
{
  "operationName": "insert",
  "operationTargetEvent": null,
  "generatedEvents": "[]",
  "diagnosticLines": [],
  "undeclaredVariables": [],
  "undeclaredObjectVariables": {},
  "missingObjectBehaviors": {},
  "missingResources": []
}
Ensure generatedEvents is a JSON string of standard GDevelop event objects (e.g. StandardEvent with conditions and actions).`;

  try {
    const res = await sendChatCompletion({
      messages: [
        { role: 'system', content: 'You are a GDevelop 5 Event generator.' },
        { role: 'user', content: prompt },
      ],
      config: getEffectiveConfigForRequest(aiRequestId || ''),
    });

    const clean = (res.content || '')
      .replace(/```(?:json)?/gi, '')
      .replace(/```/gi, '')
      .trim();
    let changeData;
    try {
      changeData = JSON.parse(clean);
    } catch (parseErr) {
      // Never report a silent, empty 'success': the editor would insert
      // nothing while telling the user the generation worked.
      return {
        creationSucceeded: false,
        errorMessage:
          'The model response could not be parsed as JSON. Try rephrasing the request, lowering the temperature, or using a stronger model.',
      };
    }

    // The generatedEvents payload must be a JSON string (or array) holding a
    // list of events; anything else would corrupt the events sheet.
    const rawGeneratedEvents = changeData.generatedEvents;
    let generatedEventsValid = true;
    let generatedEventsText;
    if (typeof rawGeneratedEvents === 'string') {
      generatedEventsText = rawGeneratedEvents;
      try {
        const parsedEvents = JSON.parse(rawGeneratedEvents);
        generatedEventsValid = Array.isArray(parsedEvents);
      } catch (eventsParseErr) {
        generatedEventsValid = false;
      }
    } else if (Array.isArray(rawGeneratedEvents)) {
      generatedEventsText = JSON.stringify(rawGeneratedEvents);
    } else if (
      rawGeneratedEvents === undefined ||
      rawGeneratedEvents === null
    ) {
      generatedEventsText = '[]';
    } else {
      generatedEventsText = JSON.stringify(rawGeneratedEvents);
      generatedEventsValid = false;
    }
    if (!generatedEventsValid) {
      return {
        creationSucceeded: false,
        errorMessage:
          'The model response did not contain a valid list of generated events (generatedEvents must be a JSON string or array of GDevelop event objects).',
      };
    }

    const aiGeneratedEvent: AiGeneratedEvent = {
      id: `local-evt-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId: LOCAL_BYOK_USER_ID,
      status: 'ready',
      partialGameProjectJson: '',
      eventsDescription: eventsDescription || null,
      eventBatches: eventBatches || null,
      extensionNamesList: extensionNamesList || '',
      objectsList: objectsList || '',
      existingEventsAsText: existingEventsAsText || '',
      existingEventsJson: null,
      existingEventsJsonUserRelativeKey: null,
      resultMessage: 'Events generated locally via custom AI endpoint.',
      changes: [
        {
          operationName: changeData.operationName || 'insert',
          operationTargetEvent: changeData.operationTargetEvent || null,
          isEventsJsonValid: true,
          generatedEvents: generatedEventsText,
          areEventsValid: true,
          extensionNames: changeData.extensionNames || [],
          diagnosticLines: changeData.diagnosticLines || [],
          undeclaredVariables: changeData.undeclaredVariables || [],
          undeclaredObjectVariables: changeData.undeclaredObjectVariables || {},
          missingObjectBehaviors: changeData.missingObjectBehaviors || {},
          missingResources: changeData.missingResources || [],
        },
      ],
      error: null,
      stats: null,
    };

    return {
      creationSucceeded: true,
      aiGeneratedEvent,
    };
  } catch (error) {
    return {
      creationSucceeded: false,
      errorMessage:
        error.message || 'Failed to generate events with custom AI endpoint.',
    };
  }
};

/**
 * Test connectivity with the configured custom endpoint.
 */
export const testConnection = async (
  customConfig?: $Shape<CustomAIConfig>
): Promise<{|
  success: boolean,
  message: string,
  models?: Array<string>,
|}> => {
  const config = {
    ...getCustomEndpointConfig(),
    ...(customConfig || {}),
  };
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  // First attempt: Try GET /models
  try {
    const modelsUrl = getEndpointUrl(baseUrl, '/models');
    const headers: { [string]: string } = {
      'HTTP-Referer': 'https://gdevelop.io',
      'X-Title': 'GDevelop IDE',
    };
    const testHeaders = config.customHeaders || {};
    for (const headerName of Object.keys(testHeaders)) {
      const headerValue = testHeaders[headerName];
      if (isSafeRequestHeader(headerName, headerValue)) {
        headers[headerName] = headerValue;
      }
    }
    if (config.apiKey && config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    const response = await axios.get(modelsUrl, { headers, timeout: 5000 });
    if (response.status === 200 && response.data) {
      const data = response.data.data || response.data.models || response.data;
      const models = Array.isArray(data)
        ? data.map(item => item.id || item.name || String(item)).filter(Boolean)
        : [];
      const configuredModel = (config.model || '').trim();
      const modelWarning =
        configuredModel &&
        models.length > 0 &&
        !models.some(
          model =>
            model === configuredModel || model.startsWith(`${configuredModel}:`)
        )
          ? ` Warning: the configured model '${configuredModel}' was not found in the endpoint's model list — check for a typo in the AI preferences.`
          : '';
      return {
        success: true,
        message: `Successfully connected to endpoint. Found ${
          models.length
        } model(s).${modelWarning}`,
        models,
      };
    }
  } catch (err) {
    // If /models failed, fallback to a lightweight completion test
  }

  // Second attempt: Minimal chat completion
  try {
    const res = await sendChatCompletion({
      messages: [{ role: 'user', content: 'Say "OK"' }],
      config,
    });
    return {
      success: true,
      message: `Successfully connected! Model responded: ${res.content ||
        'OK'}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Connection failed: ${err.message ||
        'Failed to connect to custom endpoint.'}`,
    };
  }
};

/**
 * Client-side Asset Search.
 */
export const customCreateAssetSearch = async ({
  searchTerms,
  objectType,
}: {|
  searchTerms: string,
  objectType?: string | null,
|}): Promise<AssetSearch> => {
  return {
    id: `local-asset-search-${Date.now()}`,
    userId: LOCAL_BYOK_USER_ID,
    createdAt: new Date().toISOString(),
    query: {
      searchTerms: [searchTerms],
      objectType: objectType || '',
      description: null,
      twoDimensionalViewKind: null,
      relatedAiRequestId: null,
      lastUserMessage: null,
      lastAssistantMessages: [],
    },
    status: 'completed',
    results: [],
  };
};

/**
 * Client-side Resource Search.
 */
export const customCreateResourceSearch = async ({
  searchTerms,
  resourceKind,
}: {|
  searchTerms: string,
  resourceKind: string,
|}): Promise<ResourceSearch> => {
  return {
    id: `local-resource-search-${Date.now()}`,
    userId: LOCAL_BYOK_USER_ID,
    createdAt: new Date().toISOString(),
    query: {
      searchTerms: [searchTerms],
      resourceKind,
    },
    status: 'completed',
    results: [],
  };
};

/**
 * Default fallback AI configuration presets when offline or in custom endpoint mode.
 */
export const DEFAULT_LOCAL_AI_SETTINGS: AiSettings = {
  aiRequest: {
    presets: [
      {
        mode: 'orchestrator',
        id: 'default',
        nameByLocale: { en: 'Custom / BYOK AI (Default)' },
        disabled: false,
        isDefault: true,
      },
      {
        mode: 'chat',
        id: 'chat-default',
        nameByLocale: { en: 'Custom / BYOK Chat' },
        disabled: false,
        isDefault: true,
      },
      {
        mode: 'agent',
        id: 'agent-default',
        nameByLocale: { en: 'Custom / BYOK Agent' },
        disabled: false,
        isDefault: true,
      },
    ],
  },
};
