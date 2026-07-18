#!/usr/bin/env node
// Smoke test for the operator dashboard: boots server.js against a stub `ncl`
// in a temp dir and asserts the auth + allowlist behavior. No live NanoClaw
// instance is touched. Zero dependencies; exits non-zero on any failure.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, cpSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashDir = path.resolve(here, '..');
const work = mkdtempSync(path.join(tmpdir(), 'ncl-dash-smoke-'));
const PORT = 18787 + (process.pid % 1000);
const HOST = '127.0.0.1';

// Isolated copy so the test never writes .token into the shipped directory.
cpSync(path.join(dashDir, 'server.js'), path.join(work, 'server.js'));
cpSync(path.join(dashDir, 'index.html'), path.join(work, 'index.html'));

// Stub ncl: prints a fixed ncl-shaped JSON frame for any invocation.
const stub = path.join(work, 'ncl-stub');
writeFileSync(stub, '#!/usr/bin/env bash\necho \'{"id":1,"ok":true,"data":[{"id":"stub-group","name":"Stub"}]}\'\n');
chmodSync(stub, 0o755);

const server = spawn(process.execPath, [path.join(work, 'server.js')], {
  env: { ...process.env, NCL_DASH_HOST: HOST, NCL_DASH_PORT: String(PORT), NCL_BIN: stub },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const base = `http://${HOST}:${PORT}`;
let passed = 0;
const fail = (msg) => {
  console.error(`smoke: FAIL — ${msg}\n--- server log ---\n${serverLog}`);
  server.kill();
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
};
const check = (cond, msg) => (cond ? ++passed : fail(msg));

// Wait for the server to accept connections (any HTTP response counts —
// /api/health is 401 without a token, which is itself asserted below).
async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/api/health`);
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  fail('server did not come up within 5s');
}

try {
  await waitUp();
  const token = readFileSync(path.join(work, '.token'), 'utf8').trim();
  check(/^[0-9a-f]{64}$/.test(token), `.token is not 64 hex chars: ${token.slice(0, 12)}…`);

  const spa = await fetch(`${base}/`);
  check(spa.status === 200 && (await spa.text()).toLowerCase().includes('<!doctype html>'), 'GET / did not serve the SPA');

  const noAuthHealth = await fetch(`${base}/api/health`);
  check(noAuthHealth.status === 401, `unauthenticated health expected 401, got ${noAuthHealth.status}`);

  const noAuth = await fetch(`${base}/api/list/groups`);
  check(noAuth.status === 401, `unauthenticated list expected 401, got ${noAuth.status}`);

  const badAuth = await fetch(`${base}/api/list/groups`, { headers: { authorization: 'Bearer ' + '0'.repeat(64) } });
  check(badAuth.status === 401, `wrong-token list expected 401, got ${badAuth.status}`);

  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const list = await fetch(`${base}/api/list/groups`, { headers: auth });
  const listBody = await list.json();
  check(list.status === 200 && listBody.ok === true && listBody.data[0]?.id === 'stub-group', 'authed list did not return stub ncl data');

  const post = (body) => fetch(`${base}/api/ncl`, { method: 'POST', headers: auth, body: JSON.stringify(body) });

  const okVerb = await post({ resource: 'tasks', verb: 'list', args: {} });
  check(okVerb.status === 200 && (await okVerb.json()).ok === true, 'allowlisted verb (tasks list) did not pass through');

  const mountVerb = await post({ resource: 'groups', verb: 'config add-mount', args: {} });
  check(mountVerb.status === 400, `excluded verb (config add-mount) expected 400, got ${mountVerb.status}`);

  const bogusResource = await post({ resource: 'shadow', verb: 'list', args: {} });
  check(bogusResource.status === 400, `unknown resource expected 400, got ${bogusResource.status}`);

  const flagInjection = await post({ resource: 'groups', verb: 'list', args: { name: '--rebuild' } });
  check(flagInjection.status === 400, `arg value starting with -- expected 400, got ${flagInjection.status}`);

  const badKey = await post({ resource: 'groups', verb: 'list', args: { 'NAME;rm': 'x' } });
  check(badKey.status === 400, `invalid arg key expected 400, got ${badKey.status}`);

  console.log(`smoke: all ${passed} checks passed`);
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
