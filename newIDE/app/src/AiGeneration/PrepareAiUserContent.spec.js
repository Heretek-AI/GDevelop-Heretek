// @flow
import { isCustomEndpointEnabled } from '../AI/CustomAIClient';
import { createAiUserContentPresignedUrls } from '../Utils/GDevelopServices/Generation';

jest.mock('../AI/CustomAIClient', () => ({
  isCustomEndpointEnabled: jest.fn(() => false),
}));
jest.mock('../Utils/GDevelopServices/Generation', () => ({
  createAiUserContentPresignedUrls: jest.fn(),
}));
jest.mock('axios');

// The module keeps upload caches at module scope (so an unchanged project is
// not re-uploaded across turns), which means one test's upload leaks into the
// next. Reset the registry and re-require the module per test.
let prepareAiUserContent: any;
beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Re-apply the mocks after the registry reset.
  jest.doMock('../AI/CustomAIClient', () => ({
    isCustomEndpointEnabled,
  }));
  jest.doMock('../Utils/GDevelopServices/Generation', () => ({
    createAiUserContentPresignedUrls,
  }));
  // $FlowFixMe jest mock
  isCustomEndpointEnabled.mockReturnValue(false);
  prepareAiUserContent = require('./PrepareAiUserContent').prepareAiUserContent;
});

const makeArgs = (overrides: Object = {}) => ({
  userId: 'user-1',
  simplifiedProjectJson: '{"scenes":[]}',
  projectSpecificExtensionsSummaryJson: '{"extensions":[]}',
  eventsJson: '{"events":[]}',
  getAuthorizationHeader: () => ({ Authorization: 'Bearer token' }),
  ...overrides,
});

// The upload only happens for a signed URL that is actually present, and the
// relative key is stored with it — so the mock must supply both.
const presignedResponse = {
  gameProjectJsonSignedUrl: 'https://upload.example/proj',
  gameProjectJsonUserRelativeKey: 'key-proj',
  projectSpecificExtensionsSummaryJsonSignedUrl: 'https://upload.example/ext',
  projectSpecificExtensionsSummaryJsonUserRelativeKey: 'key-ext',
  eventsJsonSignedUrl: 'https://upload.example/events',
  eventsJsonUserRelativeKey: 'key-events',
};

describe('prepareAiUserContent', () => {
  describe('local/BYOK sessions', () => {
    it('returns the content inline and uploads nothing when the endpoint is on', async () => {
      // The whole point of the BYOK path: the project never leaves the
      // machine. No presigned URL is requested, so nothing is uploaded.
      // $FlowFixMe jest mock
      isCustomEndpointEnabled.mockReturnValue(true);
      const args = makeArgs();

      const result = await prepareAiUserContent(args);

      expect(createAiUserContentPresignedUrls).not.toHaveBeenCalled();
      expect(result.gameProjectJson).toBe(args.simplifiedProjectJson);
      expect(result.gameProjectJsonUserRelativeKey).toBeNull();
      expect(result.projectSpecificExtensionsSummaryJson).toBe(
        args.projectSpecificExtensionsSummaryJson
      );
      expect(result.projectSpecificExtensionsSummaryJsonUserRelativeKey).toBe(
        null
      );
      expect(result.eventsJson).toBe(args.eventsJson);
      expect(result.eventsJsonUserRelativeKey).toBeNull();
    });

    it('also short-circuits for a local user id with the endpoint off', async () => {
      // A local-* session identity is the offline BYOK signal, independent of
      // the endpoint toggle.
      const args = makeArgs({ userId: 'local-byok-user' });

      const result = await prepareAiUserContent(args);

      expect(createAiUserContentPresignedUrls).not.toHaveBeenCalled();
      expect(result.gameProjectJson).toBe(args.simplifiedProjectJson);
      expect(result.eventsJson).toBe(args.eventsJson);
      expect(result.gameProjectJsonUserRelativeKey).toBeNull();
    });
  });

  describe('hosted sessions', () => {
    it('does not upload when there is no content to send', async () => {
      const result = await prepareAiUserContent(
        makeArgs({
          simplifiedProjectJson: null,
          projectSpecificExtensionsSummaryJson: null,
          eventsJson: null,
        })
      );

      expect(createAiUserContentPresignedUrls).not.toHaveBeenCalled();
      expect(result.gameProjectJson).toBeNull();
      expect(result.eventsJson).toBeNull();
    });

    it('uploads the extensions summary and returns its relative key', async () => {
      // Only the extensions summary has no minimum size, so it is the one
      // uploaded for these small fixtures — the project and events payloads
      // are deliberately below their 10KB/9KB upload thresholds.
      // $FlowFixMe jest mock
      createAiUserContentPresignedUrls.mockResolvedValue(presignedResponse);

      const result = await prepareAiUserContent(makeArgs());

      expect(createAiUserContentPresignedUrls).toHaveBeenCalledTimes(1);
      expect(result.projectSpecificExtensionsSummaryJsonUserRelativeKey).toBe(
        'key-ext'
      );
      // Only the summary is asked for: the project and events payloads are
      // below their 10KB/9KB thresholds, so their hashes are sent as null.
      const requestArgs = createAiUserContentPresignedUrls.mock.calls[0][1];
      expect(requestArgs.projectSpecificExtensionsSummaryJsonHash).toEqual(
        expect.any(String)
      );
      expect(requestArgs.gameProjectJsonHash).toBeNull();
      expect(requestArgs.eventsJsonHash).toBeNull();
    });

    it('uploads a large project payload and returns its relative key', async () => {
      // Above the 10KB threshold the project is uploaded and referenced by key.
      // $FlowFixMe jest mock
      createAiUserContentPresignedUrls.mockResolvedValue(presignedResponse);
      const largeProject = `{"scenes":[${'"x",'.repeat(12000)}]}`;

      const result = await prepareAiUserContent(
        makeArgs({ simplifiedProjectJson: largeProject })
      );

      expect(result.gameProjectJsonUserRelativeKey).toBe('key-proj');
    });

    it('does not re-upload identical content on a second call', async () => {
      // $FlowFixMe jest mock
      createAiUserContentPresignedUrls.mockResolvedValue(presignedResponse);

      await prepareAiUserContent(makeArgs());
      expect(createAiUserContentPresignedUrls).toHaveBeenCalledTimes(1);

      // Same content: the hash is unchanged and the recent upload is reused.
      await prepareAiUserContent(makeArgs());
      expect(createAiUserContentPresignedUrls).toHaveBeenCalledTimes(1);
    });

    it('uploads again when the project content changes', async () => {
      // $FlowFixMe jest mock
      createAiUserContentPresignedUrls.mockResolvedValue(presignedResponse);

      await prepareAiUserContent(
        makeArgs({ simplifiedProjectJson: `{"a":${'"y",'.repeat(13000)}}` })
      );
      expect(createAiUserContentPresignedUrls).toHaveBeenCalledTimes(1);

      await prepareAiUserContent(
        makeArgs({ simplifiedProjectJson: `{"b":${'"z",'.repeat(13000)}}` })
      );
      // A new hash is a new upload.
      expect(createAiUserContentPresignedUrls).toHaveBeenCalledTimes(2);
    });
  });
});
