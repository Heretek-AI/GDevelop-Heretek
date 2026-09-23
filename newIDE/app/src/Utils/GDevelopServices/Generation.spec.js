// @flow
import axios from 'axios';
import {
  apiClient,
  getAiRequestSummaries,
  updateAiRequest,
  deleteAiRequest,
  retryAiRequest,
  sendAiRequestFeedback,
} from './Generation';
import {
  setCustomEndpointConfig,
  customCreateAiRequest,
  customGetAiRequest,
  customGetAiRequests,
  customUpdateAiRequest,
  _resetCustomAiClientForTesting,
} from '../../AI/CustomAIClient';

jest.mock('axios', () => {
  const api = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      ...api,
      create: jest.fn(() => api),
      // $FlowFixMe
      isCancel: (value: any) => false,
      Cancel: class Cancel {},
      CancelToken: {
        token: () => ({}),
        source: () => ({ token: {}, cancel: () => {} }),
      },
    },
    ...api,
    create: jest.fn(() => api),
  };
});
jest.mock('../../Version', () => ({
  getIDEVersionWithHash: () => 'test-version',
}));

const authHeader = () => Promise.resolve('fake-auth');
const seedLocalRequest = async (overrides: Object = {}) => {
  // $FlowFixMe
  axios.post.mockResolvedValueOnce({
    status: 200,
    data: {
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    },
  });
  const aiRequest = await customCreateAiRequest({
    userRequest: 'Lifecycle target',
    gameProjectJson: null,
    projectSpecificExtensionsSummaryJson: null,
    mode: 'chat',
    aiConfiguration: { presetId: 'default' },
    gameId: null,
  });
  if (Object.keys(overrides).length > 0) {
    customUpdateAiRequest({
      ...customGetAiRequest(aiRequest.id),
      ...overrides,
    });
    return customGetAiRequest(aiRequest.id);
  }
  return aiRequest;
};

describe('Generation local-ai lifecycle routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetCustomAiClientForTesting();
    // Shared axios instance used by Generation's hosted paths.
    // $FlowFixMe
    const client: any = apiClient;
    if (client && typeof client.patch === 'function') client.patch.mockReset();
    if (client && typeof client.post === 'function') client.post.mockReset();
    if (client && typeof client.delete === 'function')
      client.delete.mockReset();
    if (client && typeof client.get === 'function') client.get.mockReset();
    setCustomEndpointConfig({
      enabled: false,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      temperature: 0.7,
    });
  });

  afterEach(() => {
    setCustomEndpointConfig({
      enabled: false,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder',
      temperature: 0.7,
    });
  });

  it('returns summaries shaped like the hosted API for custom endpoints', async () => {
    setCustomEndpointConfig({
      enabled: true,
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'k',
      model: 'qwen2.5-coder',
      temperature: 0.7,
    });

    const active = await seedLocalRequest();
    const archived = await seedLocalRequest();
    customUpdateAiRequest({
      ...customGetAiRequest(archived.id),
      title: 'Archived chat',
      archivedAt: new Date().toISOString(),
    });
    // A sub-agent must never appear in the history list.
    customUpdateAiRequest({
      ...active,
      parentAiRequestId: 'local-ai-parent',
    });

    const page = await getAiRequestSummaries(authHeader, {
      userId: 'local-byok-user',
      forceUri: null,
      filter: 'all',
    });
    expect(Array.isArray(page.aiRequestSummaries)).toBe(true);
    expect(page.nextPageUri).toBe(null);
    const ids = page.aiRequestSummaries.map(summary => summary.id);
    expect(ids).not.toContain(active.id);
    expect(ids).toContain(archived.id);
    expect(
      page.aiRequestSummaries.every(summary => !summary.parentAiRequestId)
    ).toBe(true);

    const activePage = await getAiRequestSummaries(authHeader, {
      userId: 'local-byok-user',
      forceUri: null,
      filter: 'active',
    });
    expect(
      activePage.aiRequestSummaries.every(summary => !summary.archivedAt)
    ).toBe(true);

    const archivedPage = await getAiRequestSummaries(authHeader, {
      userId: 'local-byok-user',
      forceUri: null,
      filter: 'archived',
    });
    expect(archivedPage.aiRequestSummaries).toHaveLength(1);
    expect(archivedPage.aiRequestSummaries[0].id).toBe(archived.id);
  });

  it('updates title/archived of a local request without calling the hosted API', async () => {
    const aiRequest = await seedLocalRequest();

    const renamed = await updateAiRequest(authHeader, {
      userId: 'user-1',
      aiRequestId: aiRequest.id,
      title: 'Renamed local',
    });
    expect(renamed.title).toBe('Renamed local');
    expect(axios.patch).not.toHaveBeenCalled();

    const archived = await updateAiRequest(authHeader, {
      userId: 'user-1',
      aiRequestId: aiRequest.id,
      archived: true,
    });
    expect(archived.archivedAt).toBeTruthy();
    expect(axios.patch).not.toHaveBeenCalled();
  });

  it('deletes a local request without calling the hosted API', async () => {
    const aiRequest = await seedLocalRequest();
    await deleteAiRequest(authHeader, {
      userId: 'user-1',
      aiRequestId: aiRequest.id,
    });
    expect(axios.delete).not.toHaveBeenCalled();
    expect(
      customGetAiRequests().aiRequests.some(r => r.id === aiRequest.id)
    ).toBe(false);
  });

  it('retries a failed local request by continuing the local model turn only', async () => {
    const aiRequest = await seedLocalRequest({
      status: 'error',
      error: { code: 'server_error', message: 'boom' },
    });
    // seedLocalRequest itself POSTs once (local create); clear before asserting.
    // $FlowFixMe
    axios.post.mockClear();
    // $FlowFixMe
    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        choices: [{ message: { role: 'assistant', content: 'continued' } }],
      },
    });

    const retried = await retryAiRequest(authHeader, {
      userId: 'user-1',
      aiRequestId: aiRequest.id,
    });
    expect(retried.status).toBe('ready');
    expect(retried.error).toBeNull();
    // Local continuation hits the OpenAI-compatible endpoint, not hosted /action/retry.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(String(axios.post.mock.calls[0][0])).toContain('/chat/completions');
    expect(customGetAiRequest(aiRequest.id).status).toBe('ready');
  });

  it('returns feedback for a local request without calling the hosted API', async () => {
    const aiRequest = await seedLocalRequest();
    // seedLocalRequest POSTs once (local create); clear before asserting.
    // $FlowFixMe
    axios.post.mockClear();
    // $FlowFixMe
    const post = (apiClient: any).post;
    if (typeof post === 'function') post.mockReset();

    const returned = await sendAiRequestFeedback(authHeader, {
      userId: 'user-1',
      aiRequestId: aiRequest.id,
      messageIndex: 0,
      feedback: 'like',
    });
    expect(returned.id).toBe(aiRequest.id);
    expect(axios.post).not.toHaveBeenCalled();
    if (typeof post === 'function') expect(post).not.toHaveBeenCalled();
  });

  it('still hits the hosted API for non-local ids when custom endpoint is off', async () => {
    // $FlowFixMe
    const patch = (apiClient: any).patch;
    patch.mockReset();
    patch.mockResolvedValueOnce({
      data: { id: 'hosted-1', title: 'x' },
      status: 200,
      headers: {},
    });
    await updateAiRequest(authHeader, {
      userId: 'user-1',
      aiRequestId: 'hosted-1',
      title: 'x',
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]).toBe('/ai-request/hosted-1');
  });

  it('lists local chats without the custom endpoint toggle (offline BYOK)', async () => {
    // Endpoint left disabled (afterEach/beforeEach default).
    const local = await seedLocalRequest();
    // $FlowFixMe
    const get = (apiClient: any).get;
    if (typeof get === 'function') get.mockReset();

    const page = await getAiRequestSummaries(authHeader, {
      userId: 'local-byok-user',
      forceUri: null,
      filter: 'active',
    });
    const ids = page.aiRequestSummaries.map(summary => summary.id);
    expect(ids).toContain(local.id);
    // Offline session must never hit the hosted history endpoint.
    if (typeof get === 'function') expect(get).not.toHaveBeenCalled();
    expect(page.nextPageUri).toBe(null);
  });

  it('merges local chats into the hosted history when a profile userId is used', async () => {
    const local = await seedLocalRequest();
    // $FlowFixMe
    const get = (apiClient: any).get;
    if (typeof get === 'function') {
      get.mockReset();
      get.mockResolvedValueOnce({
        data: [
          {
            id: 'hosted-1',
            title: 'Hosted chat',
            archivedAt: null,
            gameId: null,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            userId: 'user-1',
            status: 'ready',
            mode: 'chat',
            error: null,
            output: [],
          },
        ],
        headers: {},
      });
    }

    const page = await getAiRequestSummaries(authHeader, {
      userId: 'user-1',
      forceUri: null,
      filter: 'all',
    });
    const ids = page.aiRequestSummaries.map(summary => summary.id);
    expect(ids).toContain(local.id);
    expect(ids).toContain('hosted-1');
    if (typeof get === 'function') expect(get).toHaveBeenCalledTimes(1);
  });

  it('falls back to local chats when the hosted history request fails', async () => {
    const local = await seedLocalRequest();
    // $FlowFixMe
    const get = (apiClient: any).get;
    if (typeof get === 'function') {
      get.mockReset();
      get.mockRejectedValueOnce(new Error('network down'));
    }

    const page = await getAiRequestSummaries(authHeader, {
      userId: 'user-1',
      forceUri: null,
      filter: 'active',
    });
    const ids = page.aiRequestSummaries.map(summary => summary.id);
    expect(ids).toContain(local.id);
    expect(page.nextPageUri).toBe(null);
  });
});
