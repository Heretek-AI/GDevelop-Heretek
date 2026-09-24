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

/**
 * Optional deterministic script: a JSON array of turns, consumed one per
 * request (the last turn repeats). Each turn is either
 *   { "content": "..." }                                  a plain answer, or
 *   { "content": "...", "toolCalls": [ {"id","name","arguments"} ] }
 * with `arguments` a JSON string (or object) as the OpenAI API expects. Set
 * `MOCK_SCRIPT=/path/to/script.json` to drive a fixed multi-step run (e.g.
 * plan -> spawn_agent -> report) through the harness without a real model.
 */
const loadScript = () => {
  const path = process.env.MOCK_SCRIPT;
  if (!path) return null;
  try {
    const parsed = JSON.parse(require('fs').readFileSync(path, 'utf8'));
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (error) {
    console.error('MOCK_SCRIPT could not be read:', error.message);
    return null;
  }
};

const script = loadScript();
let requestCount = 0;

const nextTurn = () => {
  if (!script) return null;
  const turn = script[Math.min(requestCount, script.length - 1)];
  requestCount += 1;
  return turn;
};

/**
 * Optional PER-ROLE child scripts: MOCK_CHILD_SCRIPTS points at a JSON object
 * { "designer": [turns...], "developer": [...], "tester": [...] }. A sub-agent
 * request (its system prompt names a studio role) is matched to its role and
 * gets that role's turns, consumed per role; a role with no script gets a plain
 * reply. This lets a deterministic run script what each SPECIALIST does (e.g. a
 * tool call) instead of one shared sequence.
 */
const loadChildScripts = () => {
  const path = process.env.MOCK_CHILD_SCRIPTS;
  if (!path) return null;
  try {
    const parsed = JSON.parse(require('fs').readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (error) {
    console.error('MOCK_CHILD_SCRIPTS could not be read:', error.message);
    return null;
  }
};

const childScripts = loadChildScripts();
const childCounters = {};

const detectRole = messages => {
  const system = messages.find(
    m => m && m.role === 'system' && typeof m.content === 'string'
  );
  const prompt = system ? system.content.toLowerCase() : '';
  if (prompt.includes('the designer')) return 'designer';
  if (prompt.includes('the developer')) return 'developer';
  if (prompt.includes('the qa tester')) return 'tester';
  return null;
};

const nextChildTurn = messages => {
  if (!childScripts) return null;
  const role = detectRole(messages);
  const turns = role ? childScripts[role] : null;
  if (!Array.isArray(turns) || turns.length === 0) return null;
  const index = childCounters[role] || 0;
  childCounters[role] = index + 1;
  return turns[Math.min(index, turns.length - 1)];
};

const json = (res, status, body, extraHeaders) => {
  res.writeHead(
    status,
    Object.assign({ 'Content-Type': 'application/json' }, CORS, extraHeaders || {})
  );
  res.end(JSON.stringify(body));
};

// A sub-agent request carries its role prompt ("... of a small game studio");
// the top-level orchestrator does not. Distinguishing them lets a scripted run
// give the PARENT the scripted turns (plan, spawn, spawn, ...) while each child
// simply returns a report, so the interleaved parent/child request order does
// not consume the script out of sequence.
const isSubAgentRequest = messages =>
  messages.some(
    message =>
      message &&
      message.role === 'system' &&
      typeof message.content === 'string' &&
      message.content.includes('small game studio')
  );

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
      const isChild = isSubAgentRequest(messages);
      const turn = isChild ? nextChildTurn(messages) : nextTurn();
      const reply =
        turn && typeof turn.content === 'string'
          ? turn.content
          : buildReply(messages, rawBody);
      const scriptedToolCalls =
        turn && Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
      const toolCalls = scriptedToolCalls.map((call, index) => ({
        id: call.id || `call_${index}`,
        type: 'function',
        function: {
          name: call.name,
          arguments:
            typeof call.arguments === 'string'
              ? call.arguments
              : JSON.stringify(call.arguments || {}),
        },
      }));
      const headers = telemetry(rawBody, reply);

      if (payload.stream === true) {
        res.writeHead(
          200,
          Object.assign({ 'Content-Type': 'text/event-stream' }, CORS, headers)
        );
        const chunks = reply.match(/.{1,24}/g) || (reply ? [reply] : []);
        // MOCK_STREAM_DELAY_MS spaces out chunks so UI that only shows while a
        // stream is live (e.g. the streaming token counter) can be observed.
        const streamDelayMs = Number(process.env.MOCK_STREAM_DELAY_MS) || 0;
        const writeChunk = index => {
          if (index >= chunks.length) return sendTail();
          res.write(
            'data: ' +
              JSON.stringify({ choices: [{ delta: { content: chunks[index] } }] }) +
              '\n\n'
          );
          if (streamDelayMs > 0) {
            setTimeout(() => writeChunk(index + 1), streamDelayMs);
          } else {
            writeChunk(index + 1);
          }
        };
        const sendTail = () => {
        if (toolCalls.length > 0) {
          res.write(
            'data: ' +
              JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: toolCalls.map((call, index) => ({
                        index,
                        id: call.id,
                        function: call.function,
                      })),
                    },
                  },
                ],
              }) +
              '\n\n'
          );
        }
        res.write(
          'data: ' +
            JSON.stringify({
              choices: [
                {
                  delta: {},
                  finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
                },
              ],
            }) +
            '\n\n'
        );
        res.write('data: [DONE]\n\n');
        return res.end();
        };
        writeChunk(0);
        return;
      }

      const message = { role: 'assistant', content: reply };
      if (toolCalls.length > 0) message.tool_calls = toolCalls;
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
              message,
              finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
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
