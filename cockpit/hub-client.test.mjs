// node --test cockpit/hub-client.test.mjs
// Клиент hub без сети и Keychain: секрет — в файле (как вне macOS), fetch подменён.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aadFor, b64u, deriveKeys, generateDeviceKey, open, seal, signCommand } from './hub-crypto.mjs';
import { DEFAULT_STOPLIST, createHubClient, stopRule } from './hub-client.mjs';

Object.defineProperty(process, 'platform', { value: 'linux' }); // секрет — в файле, не в Keychain

const DEV = '11111111-2222-3333-4444-555555555555';

test('стоп-список: опасное ловит, чтение пропускает', () => {
  const hit = (tool, input) => stopRule(DEFAULT_STOPLIST, tool, input)?.name ?? null;
  assert.equal(hit('Bash', { command: 'git push origin main' }), 'git push');
  assert.equal(hit('Bash', { command: 'git status && git log -1' }), null);
  assert.equal(hit('Bash', { command: 'psql "$URL" -c "DELETE FROM users"' }), 'запись в БД из консоли');
  assert.equal(hit('Bash', { command: 'psql "$URL" -c "select 1"' }), null);
  assert.equal(hit('mcp__postgres-pola-prod__query', { sql: 'insert into t values (1)' }), 'запись в БД через MCP');
  assert.equal(hit('mcp__postgres-pola-prod__query', { sql: 'select * from t' }), null);
  assert.equal(hit('Bash', { command: 'kubectl get pods' }), null);
  assert.equal(hit('Bash', { command: 'kubectl -n x delete pod y' }), 'kubectl с изменениями'); // флаги до глагола
  assert.equal(hit('Bash', { command: 'git -C ../erp push -u origin x' }), 'git push');
  assert.equal(hit('Bash', { command: 'helm -n rr upgrade x ./chart' }), 'helm с изменениями');
  assert.equal(hit('Bash', { command: 'git status; echo push' }), null); // глагол другой команды не считается
  assert.equal(hit('Bash', { command: 'rm -rf build' }), 'rm -rf');
  assert.equal(hit('Bash', { command: 'vercel deploy --prod --yes' }), 'vercel --prod / env');
  assert.equal(hit('Bash', { command: 'pnpm db:migrate' }), 'миграции');
  assert.equal(stopRule({ ...DEFAULT_STOPLIST, enabled: false }, 'Bash', { command: 'git push' }), null);
  assert.equal(stopRule({ enabled: true, rules: [{ name: 'x', tool: '^Bash$', pattern: 'git push', off: true }] }, 'Bash', { command: 'git push' }), null);
  assert.equal(stopRule({ enabled: true, rules: [{ name: 'битое', tool: '^Bash$', pattern: '(' }] }, 'Bash', { command: 'ls' })?.name, 'битое');
});

async function setup(level = 'answers') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubc-'));
  const K = generateDeviceKey();
  const keys = await deriveKeys(K);
  fs.writeFileSync(path.join(dir, 'hub.json'), JSON.stringify({ url: 'https://hub.test', deviceId: DEV, kid: keys.kid, name: 'Mac', level }));
  fs.writeFileSync(path.join(dir, 'hub-secret.json'), JSON.stringify({ [DEV]: `${'t'.repeat(43)}:${b64u(K)}` }));
  const requests = new Map();
  const decided = [];
  const ran = [];
  const c = createHubClient({
    dataDir: dir,
    url: 'https://hub.test',
    deps: {
      snapshot: async () => ({ sessions: [], pending: [], closed: [] }),
      transcriptFor: async () => null,
      plan: () => null,
      request: id => requests.get(id),
      decide: (r, d) => { r.status = 'answered'; decided.push(d); },
      runCommand: async cmd => { ran.push(cmd); return { ok: true, output: 'готово' }; },
      hookLog: () => {},
    },
  });
  await c.start({ loop: false });
  const cmd = (kind, target, body) => signCommand(keys, { cmdId: crypto.randomUUID(), deviceId: DEV, kind, target, body });
  return { c, keys, requests, decided, ran, cmd, dir };
}

test('решение: разрешить один раз; «всегда» и смена режима отбрасываются', async () => {
  const t = await setup();
  t.requests.set('r1', { status: 'pending', kind: 'permission', tool: 'Bash', input: { command: 'git status' } });
  const res = await t.c._execute(await t.cmd('decision', 'r1', { behavior: 'allow', always: true, setMode: 'bypassPermissions' }));
  assert.equal(res.ok, true);
  assert.deepEqual(t.decided, [{ behavior: 'allow', via: 'hub' }]);
  assert.deepEqual(await open(t.keys, aadFor(DEV, 'result', res.cmdId), res.result), { output: 'разрешено' });
});

test('повтор той же команды отклоняется (nonce), подделка подписи — тоже', async () => {
  const t = await setup();
  t.requests.set('r1', { status: 'pending', kind: 'permission', tool: 'Bash', input: { command: 'ls' } });
  const c = await t.cmd('decision', 'r1', { behavior: 'deny', message: 'нет' });
  assert.equal((await t.c._execute(c)).ok, true);
  t.requests.get('r1').status = 'pending';
  assert.equal((await t.c._execute(c)).error, 'повтор');
  const forged = { ...(await t.cmd('decision', 'r1', { behavior: 'allow' })), target: 'r2' };
  assert.equal((await t.c._execute(forged)).error, 'подпись');
  const other = await deriveKeys(generateDeviceKey());
  const alien = await signCommand(other, { cmdId: crypto.randomUUID(), deviceId: DEV, kind: 'decision', target: 'r1', body: { behavior: 'allow' } });
  assert.match((await t.c._execute(alien)).error, /ключ|подпись/);
  assert.deepEqual(t.decided, [{ behavior: 'deny', message: 'нет', via: 'hub' }]);
});

test('стоп-список: удалённое «разрешить» git push — отказ, «отклонить» — можно', async () => {
  const t = await setup();
  t.requests.set('r1', { status: 'pending', kind: 'permission', tool: 'Bash', input: { command: 'git push' } });
  const r = await t.c._execute(await t.cmd('decision', 'r1', { behavior: 'allow' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /стоп-список \(git push\)/);
  assert.equal(t.requests.get('r1').status, 'pending');
  assert.equal((await t.c._execute(await t.cmd('decision', 'r1', { behavior: 'deny' }))).ok, true);
});

test('ответ на вопрос передаёт answers; закрытый запрос — отказ', async () => {
  const t = await setup();
  t.requests.set('q1', { status: 'pending', kind: 'question', tool: 'AskUserQuestion', input: { questions: [] } });
  assert.equal((await t.c._execute(await t.cmd('decision', 'q1', { behavior: 'allow', answers: { 'Куда?': 'Препрод' } }))).ok, true);
  assert.deepEqual(t.decided.at(-1), { behavior: 'allow', answers: { 'Куда?': 'Препрод' }, via: 'hub' });
  assert.equal((await t.c._execute(await t.cmd('decision', 'q1', { behavior: 'allow' }))).error, 'на запрос уже ответили');
});

test('уровни: наблюдение — ничего, ответы — без управления, управление — всё', async () => {
  const obs = await setup('observe');
  obs.requests.set('r1', { status: 'pending', kind: 'permission', tool: 'Bash', input: { command: 'ls' } });
  assert.match((await obs.c._execute(await obs.cmd('decision', 'r1', { behavior: 'allow' }))).error, /уровень/);
  const ans = await setup('answers');
  assert.match((await ans.c._execute(await ans.cmd('message', 's1', { text: 'привет' }))).error, /уровень/);
  assert.equal((await ans.c._execute(await ans.cmd('plan-set', null, { project: 'P', keys: ['A-1'] }))).ok, true);
  const ctl = await setup('control');
  assert.equal((await ctl.c._execute(await ctl.cmd('message', 's1', { text: 'привет' }))).ok, true);
  assert.deepEqual(ctl.ran.at(-1), { id: ctl.ran.at(-1).id, kind: 'message', sessionId: 's1', payload: { text: 'привет' } });
});

test('синк: конверты зашифрованы, запрос уходит один раз, отзыв стирает ключ', async () => {
  const t = await setup();
  const bodies = [];
  let revoked = false;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    if (revoked) return new Response(JSON.stringify({ error: 'revoked' }), { status: 401 });
    return new Response(JSON.stringify({ commands: [], watch: [] }), { status: 200 });
  };
  const c = createHubClient({
    dataDir: t.dir,
    url: 'https://hub.test',
    deps: {
      snapshot: async () => ({
        sessions: [{ id: 's1', name: 'Сессия', project: 'P', status: 'waiting', lastAssistant: 'секрет' }],
        pending: [{ id: 'r1', sessionId: 's1', kind: 'permission', toolName: 'Bash', summary: 'ls', payload: { command: 'ls -la' }, canAlways: false, createdAt: 1 }],
        closed: [],
      }),
      transcriptFor: async () => null, plan: () => null, request: () => undefined, decide: () => {}, runCommand: async () => ({ ok: true }), hookLog: () => {},
    },
  });
  await c.start({ loop: false });
  await c._tick();
  const first = bodies.at(-1);
  assert.equal(first.sessions[0].name, 'Сессия');
  assert.ok(!JSON.stringify(first).includes('секрет') && !JSON.stringify(first).includes('ls -la'));
  assert.deepEqual(await open(t.keys, aadFor(DEV, 'request', 'r1'), first.pending[0].body), { summary: 'ls', payload: { command: 'ls -la' }, canAlways: false });
  await c._tick();
  assert.equal(bodies.at(-1).pending, undefined); // уже отдан
  assert.equal(bodies.at(-1).sessions, undefined); // не менялся
  revoked = true;
  await c._tick();
  assert.equal(c.status().device, null);
  assert.ok(!fs.existsSync(path.join(t.dir, 'hub.json')));
  assert.ok(!fs.existsSync(path.join(t.dir, 'hub-secret.json')));
});
