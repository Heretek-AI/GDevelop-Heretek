#!/usr/bin/env node
'use strict';

/**
 * A tiny OpenAI-compatible mock provider for the BYOK / multi-agent harness.
 *
 * Lets the editor's AI path be exercised end-to-end without credentials: the
 * @feedback-loop skill and manual WebUI audits can point the editor at this
 * server and get deterministic replies, while the routing/telemetry code paths
 * run exactly as they do against a real gateway.
 *
 *   node scripts/dev/mock-ai-provider.js            # listens on :11435
 *   PORT=11500 node scripts/dev/mock-ai-provider.js
 *
 * Then set the editor's custom AI base URL to http://localhost:11435/v1.
 *
 * It streams (`stream: true`) and answers non-streamed requests, and emits
 * `x-omniroute-*` telemetry headers. Two details matter and are easy to get
 * wrong in a real proxy too:
 *   - the response must be permissive CORS (the editor is served from :3000);
 *   - custom response headers are invisible to browser JS unless listed in
 *     `Access-Control-Expose-Headers`.
 * Without the latter the editor cannot read the telemetry at all.
 *
 * No API key, no outbound network, no persistence: safe to leave running while
 * developing.
 */

const http = require('http');

const PORT = Number(process.env.PORT) || 11435;
const MODEL = process.env.MODEL || 'mock-city-builder';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers':
    'x-omniroute-model, x-omniroute-latency-ms, x-omniroute-tokens-in, x-omniroute-tokens-out, x-omniroute-cache',
};

const json = (res, status, body, extraHeaders) => {
  res.writeHead(
    status,
    Object.assign({ 'Content-Type': 'application/json' }, CORS, extraHeaders || {})
  );
  res.end(JSON.stringify(body));
};

const buildReply = (messages, rawBody) => {
  const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
  const text =
    lastUser && typeof lastUser.content === 'string' ? lastUser.content : '';
  return (
    'Mock provider online. I received ' +
    messages.length +
    ' messages. Your last request starts: "' +
    text.slice(0, 120).replace(/\s+/g, ' ') +
    '". In a real run I would call create_or_update_plan and spawn_agent.'
  );
};

const telemetry = (rawBody, reply) => ({
  'x-omniroute-model': MODEL,
  'x-omniroute-latency-ms': '42',
  'x-omniroute-tokens-in': String(Math.ceil(rawBody.length / 4)),
  'x-omniroute-tokens-out': String(Math.ceil(reply.length / 4)),
  'x-omniroute-cache': 'MISS',
});

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  let rawBody = '';
  req.on('data', chunk => {
    rawBody += chunk;
  });
  req.on('end', () => {
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      return json(res, 200, {
        object: 'list',
        data: [{ id: MODEL, object: 'model', owned_by: 'mock' }],
      });
    }
    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
      let payload = {};
      try {
        payload = JSON.parse(rawBody || '{}');
      } catch (ignored) {
        // A malformed body still gets a deterministic reply.
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const reply = buildReply(messages, rawBody);
      const headers = telemetry(rawBody, reply);

      if (payload.stream === true) {
        res.writeHead(
          200,
          Object.assign({ 'Content-Type': 'text/event-stream' }, CORS, headers)
        );
        const chunks = reply.match(/.{1,24}/g) || [reply];
        for (const chunk of chunks) {
          res.write(
            'data: ' +
              JSON.stringify({ choices: [{ delta: { content: chunk } }] }) +
              '\n\n'
          );
        }
        res.write(
          'data: ' +
            JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
            '\n\n'
        );
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      return json(
        res,
        200,
        {
          id: 'mock-1',
          object: 'chat.completion',
          model: MODEL,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: reply },
              finish_reason: 'stop',
            },
          ],
        },
        headers
      );
    }
    json(res, 404, { error: { message: 'not found: ' + req.url } });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `mock AI provider listening on http://127.0.0.1:${PORT}/v1 (model ${MODEL})`
  );
});
