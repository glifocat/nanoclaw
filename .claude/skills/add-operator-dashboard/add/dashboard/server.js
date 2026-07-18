#!/usr/bin/env node
/**
 * NanoClaw Dashboard — thin HTTP bridge over the `ncl` admin CLI.
 *
 * Design:
 *  - Zero npm dependencies (node:http, node:child_process, node:crypto, node:fs).
 *  - Every read and mutation shells out to `ncl <resource> <verb> --json`
 *    via execFile (argv array — user input is never shell-interpolated).
 *    All business logic / validation stays inside NanoClaw itself.
 *  - resource+verb are validated against a hard allowlist mirroring the
 *    real ncl surface; arg keys must match ^[a-z][a-z0-9-]*$; arg values
 *    may not begin with "--" (would be misparsed by ncl as a new flag).
 *  - Binds ONLY to a private interface (default 127.0.0.1; set NCL_DASH_HOST
 *    to a tailnet/LAN IP to reach it from other devices), never 0.0.0.0.
 *  - Bearer-token auth on every /api route. Token is generated at first
 *    start and persisted to dashboard/.token (chmod 600).
 */
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// node:sqlite is stable in behavior on Node 22 but still tagged experimental —
// silence just that one warning, keep everything else. Patch before the
// dynamic import so the warning (emitted at module load) is caught.
const origEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite')) return;
  origEmitWarning(warning, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.NCL_DASH_HOST || '127.0.0.1';
const PORT = parseInt(process.env.NCL_DASH_PORT || '8787', 10);
const NANOCLAW_DIR = process.env.NANOCLAW_DIR || path.resolve(__dirname, '..');
const NCL_BIN = process.env.NCL_BIN || path.join(NANOCLAW_DIR, 'bin', 'ncl');
const TOKEN_FILE = path.join(__dirname, '.token');
const INDEX_FILE = path.join(__dirname, 'index.html');
// Read the UI once at startup — every GET / used to re-read+decode it, blocking
// the event loop (risky given this box's disk-wedge history).
const INDEX_HTML = fs.readFileSync(INDEX_FILE, 'utf8');
const NCL_TIMEOUT_MS = 60_000;
// Verbs that rebuild the docker image (restart --rebuild, package add/remove)
// can run for minutes — a 60s cap 502s the client while the rebuild continues,
// and retries double-build. Give those a longer per-call timeout.
const NCL_REBUILD_TIMEOUT_MS = 300_000;

// ------------------------------------------------------------------ chat ----
// Web chat talks to the live NanoClaw install: routed sends go through the
// CLI channel's Unix socket (write-only, one JSON line, one-shot connection);
// history is read straight from the session SQLite DBs, strictly read-only.
const CLI_SOCK = path.join(NANOCLAW_DIR, 'data', 'cli.sock');
const CENTRAL_DB = path.join(NANOCLAW_DIR, 'data', 'v2.db');
const SESSIONS_DIR = path.join(NANOCLAW_DIR, 'data', 'v2-sessions');
const CHAT_SENDER = 'Ethan (webui)';
const CHAT_SENDER_ID = 'cli:webui';
const CHAT_MAX_TEXT = 8000;
const CHAT_HISTORY_LIMIT = 200;

// ---------------------------------------------------------------- token ----
function loadOrCreateToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t.length >= 32) return t;
  } catch {
    /* fall through: create */
  }
  const t = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600);
  return t;
}
const TOKEN = loadOrCreateToken();

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ------------------------------------------------------------ allowlist ----
// resource -> allowed verbs (multi-word verbs like "config get" included).
//
// Deliberately NOT allowlisted: `groups config add-mount` / `config remove-mount`.
// Their hostOnly flag only denies CONTAINER callers — the dashboard invokes ncl
// as a host caller, so allowlisting them would let a leaked bearer token edit
// host-filesystem mounts. Keep mount edits a CLI-on-the-host operation.
//
// Two things that look missing but are covered — don't "fix" them:
//  - `policies` IS allowlisted below (list/set/remove match the dispatcher).
//  - `groups create --template` needs no entry: buildArgv validates only
//    resource+verb, args pass through, and `create` is already allowed.
const ALLOW = {
  approvals: ['list', 'get'],
  destinations: ['list', 'add', 'remove'],
  'dropped-messages': ['list'],
  groups: [
    'list', 'get', 'create', 'update', 'delete', 'restart',
    'config get', 'config update',
    'config add-mcp-server', 'config remove-mcp-server',
    'config add-package', 'config remove-package',
  ],
  members: ['list', 'add', 'remove'],
  // `send` injects an inbound message and routes it in-process — the only way
  // to test a wiring end-to-end (as an arbitrary sender label) from here.
  'messaging-groups': ['list', 'get', 'create', 'update', 'delete', 'send'],
  policies: ['list', 'set', 'remove'],
  roles: ['list', 'grant', 'revoke'],
  sessions: ['list', 'get'],
  // All 10 tasks verbs. Safe with tasks' strict declared-arg validation: the
  // CLI client consumes --json itself before dispatch, so the always-appended
  // --json is never seen as an unknown flag. No tasks verb rebuilds images, so
  // the default 60s timeout applies.
  tasks: ['list', 'get', 'create', 'update', 'cancel', 'pause', 'resume', 'run', 'append-log', 'delete'],
  'user-dms': ['list'],
  users: ['list', 'get', 'create', 'update'],
  wirings: ['list', 'get', 'create', 'update', 'delete'],
};

const ARG_KEY_RE = /^[a-z][a-z0-9-]*$/;

function buildArgv(resource, verb, args) {
  if (!Object.prototype.hasOwnProperty.call(ALLOW, resource)) {
    throw httpError(400, `unknown resource "${resource}"`);
  }
  if (!ALLOW[resource].includes(verb)) {
    throw httpError(400, `verb "${verb}" not allowed on "${resource}"`);
  }
  const argv = [resource, ...verb.split(' ')];
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    throw httpError(400, 'args must be an object');
  }
  for (const [key, value] of Object.entries(args || {})) {
    if (!ARG_KEY_RE.test(key)) throw httpError(400, `invalid arg key "${key}"`);
    if (key === 'json') continue; // we always add --json ourselves
    if (value === undefined || value === null || value === '') continue; // omit empties
    if (value === true) {
      argv.push(`--${key}`); // boolean flag (e.g. --rebuild)
      continue;
    }
    if (value === false) continue;
    const s = String(value);
    if (s.startsWith('--')) throw httpError(400, `arg value for "${key}" may not start with "--"`);
    argv.push(`--${key}`, s);
  }
  argv.push('--json');
  return argv;
}

function runNcl(argv, timeoutMs) {
  // Image-rebuilding verbs need the longer ceiling. Detect from the verb tokens
  // (they sit right after the resource, never as a flag value).
  const timeout = timeoutMs ??
    (argv.includes('restart') || argv.includes('add-package') || argv.includes('remove-package')
      ? NCL_REBUILD_TIMEOUT_MS
      : NCL_TIMEOUT_MS);
  return new Promise((resolve) => {
    execFile(
      NCL_BIN,
      argv,
      { timeout, maxBuffer: 32 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        // ncl exits 1 on ok:false but still prints a JSON frame — parse stdout
        // first, regardless of exit code.
        const out = (stdout || '').trim();
        try {
          const frame = JSON.parse(out);
          resolve({ status: 200, body: { ...frame, cmd: 'ncl ' + argv.join(' ') } });
          return;
        } catch {
          /* not JSON — transport error, timeout, etc. */
        }
        resolve({
          status: 502,
          body: {
            ok: false,
            error: {
              code: 'ncl-exec-failed',
              message: (stderr || '').trim() || (err ? err.message : 'ncl produced no JSON output'),
            },
            cmd: 'ncl ' + argv.join(' '),
          },
        });
      },
    );
  });
}

// -------------------------------------------------------------- helpers ----
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(data);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // Pause (don't destroy) the socket: destroying it here tears down the
        // connection before the route's catch can write the 413 JSON response.
        req.pause();
        reject(httpError(413, 'body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Read a request body and JSON-parse it, or throw a 400 the route catch turns
// into a clean response. Shared by POST /api/ncl and the /api/chat/* routes.
async function readJsonBody(req) {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw httpError(400, 'invalid JSON body');
  }
}

function authed(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? timingSafeEq(m[1].trim(), TOKEN) : false;
}

// ----------------------------------------------------------- chat: db i/o ---
// One-writer-per-file is a hard NanoClaw invariant: every open here MUST be
// readOnly. Connections are opened per request and closed in finally.
function withDb(file, fn) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (e) {
    throw httpError(502, `cannot open ${path.basename(file)} read-only: ${e.message}`);
  }
  try {
    return fn(db);
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}
const withCentralDb = (fn) => withDb(CENTRAL_DB, fn);

// IDs that get interpolated into filesystem paths. They come from our own DB,
// but sanitize anyway: no path separators, no traversal, no null bytes.
function safePathId(id) {
  const s = String(id ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) || s.includes('..')) {
    throw httpError(400, `unsafe id "${s.slice(0, 80)}"`);
  }
  return s;
}

// messages_out.timestamp is sqlite datetime ("YYYY-MM-DD HH:MM:SS", UTC);
// messages_in.timestamp is ISO ("...T...Z"). Canonicalize both to ISO — never
// compare the two forms lexicographically.
function canonTime(t) {
  if (!t) return null;
  let s = String(t);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseMsgContent(raw) {
  if (typeof raw !== 'string') return { text: '' };
  try {
    const c = JSON.parse(raw);
    if (c && typeof c === 'object') {
      return {
        text: typeof c.text === 'string' ? c.text : typeof c.body === 'string' ? c.body : '',
        sender: typeof c.sender === 'string' ? c.sender : typeof c.senderName === 'string' ? c.senderName : undefined,
        senderId: typeof c.senderId === 'string' ? c.senderId : undefined,
      };
    }
    return { text: String(c) };
  } catch {
    return { text: raw }; // plain-text content
  }
}

const getAgentGroup = (db, id) =>
  db.prepare('SELECT id, name, folder FROM agent_groups WHERE id = ?').get(String(id));
const findWebuiMg = (db, folder) =>
  db.prepare("SELECT * FROM messaging_groups WHERE channel_type = 'cli' AND platform_id = ?").get('webui:' + folder);
const findWiring = (db, mgId, agId) =>
  db.prepare('SELECT * FROM messaging_group_agents WHERE messaging_group_id = ? AND agent_group_id = ?').get(mgId, agId);
const findChannelDest = (db, agId, mgId) =>
  db.prepare("SELECT * FROM agent_destinations WHERE agent_group_id = ? AND target_type = 'channel' AND target_id = ?").get(agId, mgId);
const destNameTaken = (db, agId, name) =>
  !!db.prepare('SELECT 1 FROM agent_destinations WHERE agent_group_id = ? AND local_name = ?').get(agId, name);
const findWebuiSession = (db, agId, mgId) =>
  db.prepare("SELECT * FROM sessions WHERE agent_group_id = ? AND messaging_group_id = ? ORDER BY created_at DESC LIMIT 1").get(agId, mgId);

// Run a mutating ncl command through buildArgv so it goes through the SAME
// resource/verb allowlist and "value may not start with --" guard as every
// other route — never hand-build raw argv with DB-derived values spliced in.
async function nclOrThrow(resource, verb, args) {
  const res = await runNcl(buildArgv(resource, verb, args));
  if (!res.body.ok) {
    const msg = res.body.error?.message || 'ncl failed';
    const e = httpError(502, `${res.body.cmd}: ${msg}`);
    e.cmd = res.body.cmd;
    throw e;
  }
  return res.body;
}

// -------------------------------------------------------- chat: cli socket --
function sendToCliSock(payload) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(CLI_SOCK);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(httpError(504, 'timed out writing to NanoClaw CLI socket'));
    }, 5000);
    sock.on('connect', () => {
      // One routed line, then FIN — routed connections are one-shot and never
      // claim the interactive chat slot (won't evict a terminal `pnpm run chat`).
      sock.end(JSON.stringify(payload) + '\n', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(httpError(502, `NanoClaw CLI socket (${CLI_SOCK}): ${err.message}`));
    });
  });
}

// -------------------------------------------------------- chat: handlers ----
async function chatProvision(agentGroupId) {
  const info = withCentralDb((db) => {
    const ag = getAgentGroup(db, agentGroupId);
    if (!ag) throw httpError(404, `unknown agent group "${String(agentGroupId).slice(0, 80)}"`);
    return { ag, mg: findWebuiMg(db, ag.folder) };
  });
  const { ag } = info;
  const created = { messagingGroup: false, wiring: false, destination: false };
  const cmds = [];

  let mg = info.mg;
  if (!mg) {
    const res = await nclOrThrow('messaging-groups', 'create', {
      'channel-type': 'cli',
      'platform-id': 'webui:' + ag.folder,
      'name': 'WebUI: ' + ag.name,
      'is-group': '0',
      'unknown-sender-policy': 'public',
    });
    cmds.push(res.cmd);
    created.messagingGroup = true;
    mg = withCentralDb((db) => findWebuiMg(db, ag.folder));
    if (!mg) throw httpError(502, 'messaging group was created but cannot be found in the central DB');
  }

  if (!withCentralDb((db) => findWiring(db, mg.id, ag.id))) {
    const res = await nclOrThrow('wirings', 'create', {
      'messaging-group-id': mg.id,
      'agent-group-id': ag.id,
      'engage-mode': 'pattern',
      'engage-pattern': '.',
      'sender-scope': 'all',
      'ignored-message-policy': 'drop',
      'session-mode': 'shared',
    });
    cmds.push(res.cmd);
    created.wiring = true;
  }

  // Idempotence backstop. `wirings create` provisions the companion
  // agent_destinations row itself in the same transaction (fixed upstream at
  // 2.1.42 — this used to be the #2389 workaround), so findChannelDest()
  // normally finds it and this block is skipped. Kept as a pure safety net:
  // if the destination is ever missing, replies would be silently dropped.
  let dest = withCentralDb((db) => findChannelDest(db, ag.id, mg.id));
  if (!dest) {
    const name = withCentralDb((db) => (destNameTaken(db, ag.id, 'webui') ? 'webui-' + mg.id.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase() : 'webui'));
    const res = await nclOrThrow('destinations', 'add', {
      'agent-group-id': ag.id,
      'local-name': name,
      'target-type': 'channel',
      'target-id': mg.id,
    });
    cmds.push(res.cmd);
    created.destination = true;
    dest = { local_name: name };
  }

  return {
    agentGroupId: ag.id,
    messagingGroupId: mg.id,
    platformId: mg.platform_id,
    destination: dest.local_name,
    created,
    cmds,
  };
}

async function chatUnprovision(agentGroupId) {
  const info = withCentralDb((db) => {
    const ag = getAgentGroup(db, agentGroupId);
    if (!ag) throw httpError(404, `unknown agent group "${String(agentGroupId).slice(0, 80)}"`);
    const mg = findWebuiMg(db, ag.folder);
    if (!mg) return { ag, mg: null };
    const wiring = findWiring(db, mg.id, ag.id);
    const dests = db.prepare("SELECT local_name FROM agent_destinations WHERE agent_group_id = ? AND target_type = 'channel' AND target_id = ?").all(ag.id, mg.id);
    return { ag, mg, wiring, dests };
  });
  if (!info.mg) return { removed: false, reason: 'no webui messaging group exists for this agent' };
  const cmds = [];
  if (info.wiring) cmds.push((await nclOrThrow('wirings', 'delete', { id: info.wiring.id })).cmd);
  for (const d of info.dests || []) {
    cmds.push((await nclOrThrow('destinations', 'remove', { 'agent-group-id': info.ag.id, 'local-name': d.local_name })).cmd);
  }
  // Once a session row references the mg, `messaging-groups delete` fails on
  // the sessions FK. The line is already disconnected (wiring + destination
  // gone), so keep the mg and say so honestly instead of failing the request.
  let messagingGroupKept = false;
  try {
    cmds.push((await nclOrThrow('messaging-groups', 'delete', { id: info.mg.id })).cmd);
  } catch (e) {
    if (!/FOREIGN KEY/i.test(e.message || '')) throw e;
    messagingGroupKept = true;
  }
  return {
    removed: true,
    messagingGroupId: info.mg.id,
    messagingGroupKept,
    ...(messagingGroupKept
      ? { note: 'messaging group kept: a session references it. The line is disconnected (wiring + destination removed); the transcript survives and re-provisioning reconnects it.' }
      : {}),
    cmds,
  };
}

function readSessionMessages(session, webuiPlatformId) {
  const dir = path.join(SESSIONS_DIR, safePathId(session.agent_group_id), safePathId(session.id));
  const messages = [];

  const inboundFile = path.join(dir, 'inbound.db');
  if (fs.existsSync(inboundFile)) {
    withDb(inboundFile, (db) => {
      const rows = db.prepare(
        "SELECT id, timestamp, status, content FROM messages_in WHERE kind IN ('chat','chat-sdk') ORDER BY seq DESC LIMIT ?"
      ).all(CHAT_HISTORY_LIMIT + 50);
      for (const r of rows) {
        const c = parseMsgContent(r.content);
        if (!c.text) continue;
        messages.push({
          id: r.id,
          role: c.senderId === CHAT_SENDER_ID ? 'operator' : 'user',
          sender: c.sender,
          text: c.text,
          time: canonTime(r.timestamp),
          status: r.status,
        });
      }
    });
  }

  const outboundFile = path.join(dir, 'outbound.db');
  if (fs.existsSync(outboundFile)) {
    withDb(outboundFile, (db) => {
      const rows = db.prepare(
        "SELECT id, timestamp, platform_id, channel_type, content FROM messages_out WHERE kind = 'chat' ORDER BY seq DESC LIMIT ?"
      ).all(CHAT_HISTORY_LIMIT + 50);
      for (const r of rows) {
        const c = parseMsgContent(r.content);
        if (!c.text) continue;
        const misdirected = webuiPlatformId && r.platform_id && r.platform_id !== webuiPlatformId;
        messages.push({
          id: r.id,
          role: 'agent',
          text: c.text,
          time: canonTime(r.timestamp),
          ...(misdirected ? { sentTo: `${r.channel_type || '?'}:${r.platform_id}` } : {}),
        });
      }
    });
  }

  messages.sort((a, b) => {
    const t = String(a.time || '').localeCompare(String(b.time || '')); // both ISO now
    if (t) return t;
    // Same timestamp: rank operator/user before agent, then break ties by id so
    // the order is a total order (stable, symmetric) and never renders reversed.
    const rankA = a.role === 'agent' ? 1 : 0;
    const rankB = b.role === 'agent' ? 1 : 0;
    if (rankA !== rankB) return rankA - rankB;
    return String(a.id).localeCompare(String(b.id));
  });
  return messages.slice(-CHAT_HISTORY_LIMIT);
}

function chatHistory(params) {
  const sessionIdParam = params.get('sessionId');
  const agentGroupId = params.get('agentGroupId');
  if (!sessionIdParam && !agentGroupId) throw httpError(400, 'agentGroupId or sessionId is required');

  const ctx = withCentralDb((db) => {
    if (sessionIdParam) {
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(sessionIdParam));
      if (!session) throw httpError(404, `unknown session "${String(sessionIdParam).slice(0, 80)}"`);
      const mg = session.messaging_group_id
        ? db.prepare('SELECT * FROM messaging_groups WHERE id = ?').get(session.messaging_group_id)
        : null;
      return { session, mg, provisioned: true };
    }
    const ag = getAgentGroup(db, agentGroupId);
    if (!ag) throw httpError(404, `unknown agent group "${String(agentGroupId).slice(0, 80)}"`);
    const mg = findWebuiMg(db, ag.folder);
    // "Provisioned" means the whole route works: mg AND wiring. A leftover mg
    // (kept after unprovision because a session references it) doesn't count.
    if (!mg || !findWiring(db, mg.id, ag.id)) return { provisioned: false };
    return { session: findWebuiSession(db, ag.id, mg.id), mg, provisioned: true };
  });

  if (!ctx.provisioned) return { provisioned: false, session: null, messages: [] };
  if (!ctx.session) return { provisioned: true, session: null, messages: [] };
  const isCli = ctx.mg && ctx.mg.channel_type === 'cli';
  return {
    provisioned: true,
    session: {
      id: ctx.session.id,
      agentGroupId: ctx.session.agent_group_id,
      messagingGroupId: ctx.session.messaging_group_id,
      containerStatus: ctx.session.container_status,
      lastActive: canonTime(ctx.session.last_active),
    },
    messages: readSessionMessages(ctx.session, isCli ? ctx.mg.platform_id : null),
  };
}

function chatSessions(agentGroupId) {
  return withCentralDb((db) => {
    const ag = getAgentGroup(db, agentGroupId);
    if (!ag) throw httpError(404, `unknown agent group "${String(agentGroupId).slice(0, 80)}"`);
    const rows = db.prepare(`
      SELECT s.id, s.messaging_group_id, s.thread_id, s.status, s.container_status,
             s.last_active, s.created_at,
             m.name AS mg_name, m.channel_type, m.platform_id, m.is_group
      FROM sessions s LEFT JOIN messaging_groups m ON m.id = s.messaging_group_id
      WHERE s.agent_group_id = ?
      ORDER BY COALESCE(s.last_active, s.created_at) DESC
    `).all(ag.id);
    return rows.map((r) => ({
      id: r.id,
      messagingGroupId: r.messaging_group_id,
      threadId: r.thread_id,
      status: r.status,
      containerStatus: r.container_status,
      lastActive: canonTime(r.last_active),
      createdAt: canonTime(r.created_at),
      name: r.mg_name,
      channelType: r.channel_type,
      platformId: r.platform_id,
      isGroup: !!r.is_group,
      isWebui: r.channel_type === 'cli' && String(r.platform_id || '').startsWith('webui:'),
    }));
  });
}

async function chatSend(body) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw httpError(400, 'text is required');
  if (text.length > CHAT_MAX_TEXT) throw httpError(400, `text too long (max ${CHAT_MAX_TEXT} chars)`);

  let to;
  if (body.target && typeof body.target === 'object' && !Array.isArray(body.target)) {
    // Explicit target — send into a REAL channel session. The UI labels this
    // clearly: the reply goes wherever that chat's replies normally go.
    const { channelType, platformId, threadId } = body.target;
    if (typeof channelType !== 'string' || !channelType || channelType.length > 64) throw httpError(400, 'target.channelType is required');
    if (typeof platformId !== 'string' || !platformId || platformId.length > 256) throw httpError(400, 'target.platformId is required');
    if (threadId !== undefined && threadId !== null && typeof threadId !== 'string') throw httpError(400, 'target.threadId must be a string or null');
    to = { channelType, platformId, threadId: threadId ?? null };
    // Validate the target actually exists as a messaging group. Without this the
    // router silently drops the send (no group to route to) and the UI shows
    // "thinking" forever. Identity is (channel_type, platform_id) — the router
    // resolves instance from channel_type, so those two columns are the match.
    const exists = withCentralDb((db) =>
      db.prepare('SELECT 1 FROM messaging_groups WHERE channel_type = ? AND platform_id = ?').get(channelType, platformId));
    if (!exists) throw httpError(404, 'no messaging group matches that target');
  } else {
    const mg = withCentralDb((db) => {
      const ag = getAgentGroup(db, body.agentGroupId);
      if (!ag) throw httpError(404, `unknown agent group "${String(body.agentGroupId).slice(0, 80)}"`);
      const m = findWebuiMg(db, ag.folder);
      return m && findWiring(db, m.id, ag.id) ? m : null;
    });
    if (!mg) {
      const e = httpError(409, 'this agent has no webui line yet — provision it first');
      e.extra = { provisioned: false };
      throw e;
    }
    to = { channelType: 'cli', platformId: mg.platform_id, threadId: null };
  }

  await sendToCliSock({ text, to, sender: CHAT_SENDER, senderId: CHAT_SENDER_ID });
  return { sent: true, to, at: new Date().toISOString() };
}

// --------------------------------------------------------------- server ----
const server = http.createServer(async (req, res) => {
  // Build the URL BEFORE the main try — a malformed Host header makes `new URL`
  // throw; outside a catch that would become an unhandled rejection and kill the
  // process (an unauthenticated DoS). 400 instead and keep serving.
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    send(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid request URL or Host header' } });
    return;
  }

  try {
    // UI (no auth — the page itself contains the login screen; all data
    // endpoints require the bearer token). Served from the startup cache.
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      send(res, 200, INDEX_HTML);
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      send(res, 404, { ok: false, error: { code: 'not-found', message: 'not found' } });
      return;
    }

    // All /api routes require auth.
    if (!authed(req)) {
      send(res, 401, { ok: false, error: { code: 'unauthorized', message: 'missing or invalid bearer token' } });
      return;
    }

    // GET /api/health — auth check + liveness (used by the login screen).
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true, data: { host: HOST, port: PORT, ncl: NCL_BIN, ts: new Date().toISOString() } });
      return;
    }

    // GET /api/list/<resource> — convenience read endpoint.
    if (req.method === 'GET' && url.pathname.startsWith('/api/list/')) {
      const resource = decodeURIComponent(url.pathname.slice('/api/list/'.length));
      const result = await runNcl(buildArgv(resource, 'list', {}));
      send(res, result.status, result.body);
      return;
    }

    // POST /api/ncl — { resource, verb, args } → ncl <resource> <verb...> --flags --json
    if (req.method === 'POST' && url.pathname === '/api/ncl') {
      const parsed = await readJsonBody(req);
      const { resource, verb, args } = parsed;
      if (typeof resource !== 'string' || typeof verb !== 'string') {
        throw httpError(400, 'resource and verb are required strings');
      }
      const result = await runNcl(buildArgv(resource, verb, args));
      send(res, result.status, result.body);
      return;
    }

    // ---- chat endpoints -------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/chat/history') {
      send(res, 200, { ok: true, data: chatHistory(url.searchParams) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/chat/sessions') {
      const ag = url.searchParams.get('agentGroupId');
      if (!ag) throw httpError(400, 'agentGroupId is required');
      send(res, 200, { ok: true, data: chatSessions(ag) });
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/chat/')) {
      const parsed = await readJsonBody(req);
      if (url.pathname === '/api/chat/send') {
        send(res, 200, { ok: true, data: await chatSend(parsed) });
        return;
      }
      if (url.pathname === '/api/chat/provision') {
        if (typeof parsed.agentGroupId !== 'string' || !parsed.agentGroupId) throw httpError(400, 'agentGroupId is required');
        send(res, 200, { ok: true, data: await chatProvision(parsed.agentGroupId) });
        return;
      }
      if (url.pathname === '/api/chat/unprovision') {
        if (typeof parsed.agentGroupId !== 'string' || !parsed.agentGroupId) throw httpError(400, 'agentGroupId is required');
        send(res, 200, { ok: true, data: await chatUnprovision(parsed.agentGroupId) });
        return;
      }
    }

    send(res, 404, { ok: false, error: { code: 'not-found', message: 'not found' } });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    send(res, status, {
      ok: false,
      error: { code: status === 500 ? 'internal' : 'bad-request', message: e.message },
      ...(e && e.cmd ? { cmd: e.cmd } : {}),
      ...(e && e.extra ? e.extra : {}),
    });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[nanoclaw-dashboard] listening on http://${HOST}:${PORT}`);
  console.log(`[nanoclaw-dashboard] token file: ${TOKEN_FILE}`);
});

server.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error(`[nanoclaw-dashboard] server error: ${err.message}`);
  process.exit(1);
});

// Defense in depth: log and keep serving rather than letting a stray rejection
// or thrown error take the whole process down (would be an unauthenticated DoS).
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error(`[nanoclaw-dashboard] unhandledRejection: ${reason instanceof Error ? (reason.stack || reason.message) : reason}`);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error(`[nanoclaw-dashboard] uncaughtException: ${err && err.stack ? err.stack : err}`);
});
