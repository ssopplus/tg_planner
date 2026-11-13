// Связь cockpit ↔ cockpit-hub (docs/hub-protocol.md): привязка телефона, зашифрованный синк, проверка
// подписей команд, уровни доступа и стоп-список. Сервер hub содержимого не видит и команд не подделает:
// ключ K живёт только здесь (Keychain) и в Mini App.
//
// Работает рядом со старым синком sync.json (tg-planer): у каждого свой цикл, первый ответ побеждает.

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  aadFor, b64u, deriveKeys, fromB64u, generateDeviceKey, keyQr, pairQr, seal, verifyClaimProof, verifyCommand,
} from './hub-crypto.mjs';

const pexec = promisify(execFile);

const FAST_MS = 3_000;      // свежий запрос, на телефоне открыта переписка, идут команды
const POLL_MS = 15_000;     // покой и запросы, которые ждут дольше FRESH_MS (лимит вызовов Vercel Hobby)
const FRESH_MS = 120_000;   // столько после появления запроса синк частый — ответ с телефона доходит за секунды
const FULL_MS = 300_000;    // снимок сессий и план — при изменении и не реже раза в 5 мин
const IDLE_MS = 30_000;     // не привязан
const RETRY_MS = 30_000;
const PAIR_POLL_MS = 2_000;
const NONCE_TTL_MS = 24 * 3600e3;
const JOURNAL_MAX = 50;

export const LEVELS = ['observe', 'answers', 'control'];
const LEVEL_KINDS = {
  observe: [],
  answers: ['decision', 'plan-set'],
  control: ['decision', 'plan-set', 'message', 'start-task', 'close-session', 'to-vscode'],
};

// ---------- стоп-список ----------
// Удалённое «разрешить» для этих вызовов отклоняется: «подтвердите на машине». tool — regex имени
// инструмента, pattern — regex текста входа (для Bash — команда, для остальных — JSON входа).
const WRITE_SQL = String.raw`\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b`;
export const DEFAULT_STOPLIST = {
  enabled: true,
  rules: [
    { name: 'git push', tool: '^Bash$', pattern: String.raw`\bgit\b[^\n|;&]*\bpush\b` },
    { name: 'merge через gh/glab', tool: '^Bash$', pattern: String.raw`\b(gh|glab)\b[^\n|;&]*\bmerge\b` },
    { name: 'запись в БД из консоли', tool: '^Bash$', pattern: String.raw`\b(psql|mysql|clickhouse-client|clickhouse)\b[\s\S]*` + WRITE_SQL, flags: 'i' },
    { name: 'запись в БД через MCP', tool: String.raw`^mcp__.*__(run_query|query|mysql_query|execute\w*)$`, pattern: WRITE_SQL, flags: 'i' },
    { name: 'миграции', tool: '^Bash$', pattern: String.raw`\b(pnpm|npm|yarn)\s+(run\s+)?(db:)?migrate` },
    { name: 'kubectl с изменениями', tool: '^Bash$', pattern: String.raw`\bkubectl\b[^\n|;&]*\b(apply|delete|exec|scale|rollout|patch|edit|cp)\b` },
    { name: 'helm с изменениями', tool: '^Bash$', pattern: String.raw`\bhelm\b[^\n|;&]*\b(upgrade|install|uninstall|rollback)\b` },
    { name: 'rm -rf', tool: '^Bash$', pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r\s+-f|-f\s+-r)\b` },
    { name: 'vercel --prod / env', tool: '^Bash$', pattern: String.raw`\bvercel\b[^\n|;&]*(--prod\b|\benv\b)` },
  ],
};

/** Первое правило стоп-списка, под которое подходит вызов; null — можно. Битое правило — срабатывает (безопаснее). */
export function stopRule(stoplist, tool, input) {
  if (!stoplist?.enabled) return null;
  const text = tool === 'Bash' && typeof input?.command === 'string' ? input.command : JSON.stringify(input ?? {});
  for (const r of stoplist.rules || []) {
    if (r.off) continue;
    try {
      if (new RegExp(r.tool || '.', 'i').test(tool) && new RegExp(r.pattern || '.', r.flags || '').test(text)) return r;
    } catch { return r; }
  }
  return null;
}

// ---------- Keychain ----------
// Токен и ключ — одной строкой `<token>:<K base64url>` в login Keychain, сервис dev-cockpit-hub, аккаунт —
// id устройства. Запись — через `security -i` из stdin, чтобы секрет не попал в аргументы процесса (ps).
const KC_SERVICE = 'dev-cockpit-hub';
const SAFE = /^[A-Za-z0-9_:-]+$/;

async function kcSet(account, value, fallbackFile) {
  if (!SAFE.test(account) || !SAFE.test(value)) throw new Error('недопустимые символы для Keychain');
  if (process.platform !== 'darwin') {
    await fsp.writeFile(fallbackFile, JSON.stringify({ [account]: value }), { mode: 0o600 });
    return;
  }
  await new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`Keychain: ${err.trim() || code}`))));
    p.stdin.end(`add-generic-password -U -s ${KC_SERVICE} -a ${account} -l "dev-cockpit hub" -w ${value}\n`);
  });
  if ((await kcGet(account, fallbackFile)) !== value) throw new Error('Keychain: запись не прочиталась обратно');
}

async function kcGet(account, fallbackFile) {
  if (process.platform !== 'darwin') {
    try { return JSON.parse(fs.readFileSync(fallbackFile, 'utf8'))[account] ?? null; } catch { return null; }
  }
  try {
    const { stdout } = await pexec('/usr/bin/security', ['find-generic-password', '-s', KC_SERVICE, '-a', account, '-w'], { timeout: 10_000 });
    return stdout.trim() || null;
  } catch { return null; }
}

async function kcDelete(account, fallbackFile) {
  if (process.platform !== 'darwin') { await fsp.rm(fallbackFile, { force: true }); return; }
  await pexec('/usr/bin/security', ['delete-generic-password', '-s', KC_SERVICE, '-a', account], { timeout: 10_000 }).catch(() => {});
}

// ---------- клиент ----------

/**
 * deps — то, что знает server.mjs:
 *  snapshot() → { sessions: [{ id, name, project, status, ...содержимое }], pending: [{ id, sessionId, kind, toolName, summary, payload, canAlways, createdAt }], closed: [{ id, status }] }
 *  transcriptFor(sessionId) → items | null;  plan() → снимок плана | null
 *  request(id) → { status, kind, tool, input } | undefined;  decide(r, decision)
 *  runCommand({ id, kind, sessionId, payload }) → { ok, error?, output? };  hookLog(rec)
 */
export function createHubClient({ dataDir, url, deps }) {
  const STATE_FILE = path.join(dataDir, 'hub.json');
  const STOPLIST_FILE = path.join(dataDir, 'stoplist.json');
  const NONCE_FILE = path.join(dataDir, 'nonces.json');
  const SECRET_FILE = path.join(dataDir, 'hub-secret.json'); // только вне macOS
  const hubUrl = (url || '').replace(/\/$/, '');

  let state = readJson(STATE_FILE); // { url, deviceId, kid, name, user, pairedAt, level }
  let keys = null;                   // DeviceKeys
  let rawKey = null;                 // K — для «Показать QR снова»
  let token = null;
  let pairing = null;                // { code, secret, K, keys, name, expiresAt, status, user?, deviceId?, deviceToken?, error? }
  let timer = null, running = false, looping = false;
  const status = { lastOk: null, lastError: null };
  const journal = [];
  const nonces = new Map(Object.entries(readJson(NONCE_FILE) || {}));
  // Что уже отдано hub: чтобы не слать одно и то же каждые 3 с.
  let sessionsHash = '', sessionsAt = 0, planHash = '', planAt = 0;
  const sessionSent = new Map(); // sessionId → хеш отправленной сессии: неизменённые уходят с keep, без конверта
  const sentPending = new Set();
  const transcriptHash = new Map();
  let watched = [];
  const results = [];

  function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
  async function writeJson(f, v, mode = 0o600) {
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f + '.tmp', JSON.stringify(v, null, 2), { mode });
    await fsp.rename(f + '.tmp', f);
  }
  const sha = v => createHash('sha1').update(JSON.stringify(v)).digest('hex');
  const note = rec => {
    journal.unshift({ at: Date.now(), ...rec });
    journal.length = Math.min(journal.length, JOURNAL_MAX);
    deps.hookLog({ event: 'hub', ...rec });
  };

  function stoplist() { return readJson(STOPLIST_FILE) || DEFAULT_STOPLIST; }
  async function setStoplist(v) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.rules)) throw new Error('ожидался { enabled, rules: [] }');
    const rules = v.rules.slice(0, 100).map(r => {
      const rule = { name: String(r.name || '').slice(0, 80), tool: String(r.tool || '^Bash$').slice(0, 300), pattern: String(r.pattern || '').slice(0, 1000), ...(r.flags ? { flags: String(r.flags).replace(/[^gimsuy]/g, '') } : {}), ...(r.off ? { off: true } : {}) };
      if (!rule.pattern) throw new Error(`правило «${rule.name}»: пустой шаблон`);
      try { new RegExp(rule.tool, 'i'); new RegExp(rule.pattern, rule.flags || ''); } catch (e) { throw new Error(`правило «${rule.name}»: ${e.message}`); }
      return rule;
    });
    await writeJson(STOPLIST_FILE, { enabled: v.enabled !== false, rules }, 0o644);
    note({ action: 'stoplist', rules: rules.length, enabled: v.enabled !== false });
    return stoplist();
  }

  async function load() {
    if (!state?.deviceId) return;
    const secret = await kcGet(state.deviceId, SECRET_FILE);
    const m = /^([A-Za-z0-9_-]+):([A-Za-z0-9_-]{43})$/.exec(secret || '');
    if (!m) { status.lastError = 'ключ устройства не найден в Keychain — привяжите заново'; return; }
    token = m[1];
    rawKey = fromB64u(m[2]);
    keys = await deriveKeys(rawKey);
    if (keys.kid !== state.kid) { status.lastError = 'ключ в Keychain не совпадает с устройством'; keys = null; }
  }

  async function wipe(reason) {
    if (state?.deviceId) await kcDelete(state.deviceId, SECRET_FILE);
    await fsp.rm(STATE_FILE, { force: true });
    note({ action: 'unpaired', reason, deviceId: state?.deviceId });
    state = null; keys = null; rawKey = null; token = null;
    sentPending.clear(); transcriptHash.clear(); sessionSent.clear(); sessionsHash = ''; planHash = ''; watched = []; results.length = 0;
  }

  async function post(p, body, auth) {
    const res = await fetch(hubUrl + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Device ${state.deviceId}.${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || `hub ${res.status}`); e.status = res.status; throw e; }
    return j;
  }

  // ---------- привязка ----------

  async function startPairing(name) {
    if (!hubUrl) throw new Error('не задан адрес hub: config.json → hub.url');
    if (state?.deviceId) throw new Error('машина уже привязана — сначала «Отвязать»');
    const K = generateDeviceKey();
    const secret = b64u(randomBytes(32));
    const devName = String(name || os.hostname().replace(/\.local$/, '')).slice(0, 100);
    const r = await post('/api/pair/start', { name: devName, platform: `${process.platform}`, secretHash: createHash('sha256').update(secret).digest('hex') });
    pairing = { code: r.code, secret, K, keys: await deriveKeys(K), name: devName, expiresAt: r.expiresAt, status: 'waiting' };
    note({ action: 'pair-start', code: r.code });
    pollPairing(pairing);
    return publicPairing();
  }

  async function pollPairing(p) {
    while (pairing === p && p.status === 'waiting') {
      await new Promise(r => setTimeout(r, PAIR_POLL_MS));
      if (pairing !== p) return;
      try {
        const r = await post('/api/pair/poll', { code: p.code, secret: p.secret });
        if (r.status === 'waiting') continue;
        if (r.status !== 'claimed') { p.status = r.status; return; }
        // proof — HMAC ключом из QR: заявил тот, кто действительно отсканировал наш QR, а не hub.
        if (r.kid !== p.keys.kid || !(await verifyClaimProof(p.keys, p.code, r.proof))) {
          await post('/api/pair/finish', { code: p.code, secret: p.secret, deviceToken: r.deviceToken, accept: false }).catch(() => {});
          p.status = 'bad-proof';
          note({ action: 'pair-bad-proof', code: p.code });
          return;
        }
        Object.assign(p, { status: 'claimed', user: r.user, deviceId: r.deviceId, deviceToken: r.deviceToken });
        note({ action: 'pair-claimed', user: r.user?.username || r.user?.name });
      } catch (e) {
        p.error = e.message;
        if (Date.now() > p.expiresAt) { p.status = 'expired'; return; }
      }
    }
  }

  async function confirmPairing(accept) {
    const p = pairing;
    if (!p || p.status !== 'claimed') throw new Error('нет заявки на привязку');
    if (!accept) {
      await post('/api/pair/finish', { code: p.code, secret: p.secret, deviceToken: p.deviceToken, accept: false });
      p.status = 'rejected';
      note({ action: 'pair-rejected' });
      return publicPairing();
    }
    // Сначала — ключ и токен в Keychain: если запись не удалась, устройство не активируем.
    await kcSet(p.deviceId, `${p.deviceToken}:${b64u(p.K)}`, SECRET_FILE);
    await post('/api/pair/finish', { code: p.code, secret: p.secret, deviceToken: p.deviceToken, accept: true });
    state = { url: hubUrl, deviceId: p.deviceId, kid: p.keys.kid, name: p.name, user: p.user, pairedAt: Date.now(), level: 'answers' };
    await writeJson(STATE_FILE, state);
    token = p.deviceToken; rawKey = p.K; keys = p.keys;
    pairing = null;
    note({ action: 'paired', deviceId: state.deviceId, user: state.user?.username || state.user?.name });
    kick();
    return null;
  }

  function cancelPairing() { pairing = null; }

  function publicPairing() {
    if (!pairing) return null;
    const p = pairing;
    return {
      code: p.code, expiresAt: p.expiresAt, name: p.name,
      status: p.status === 'waiting' && Date.now() > p.expiresAt ? 'expired' : p.status,
      qr: p.status === 'waiting' ? pairQr(p.code, p.K) : null, // QR с ключом — только пока ждём скан
      user: p.user || null, error: p.error || null,
    };
  }

  async function unpair() {
    if (!state) return;
    if (token) await post('/api/device/revoke', {}, true).catch(e => note({ action: 'revoke-failed', error: e.message }));
    await wipe('cockpit');
  }

  async function setLevel(level) {
    if (!state || !LEVELS.includes(level)) throw new Error('неверный уровень');
    state.level = level;
    await writeJson(STATE_FILE, state);
    note({ action: 'level', level });
    kick();
  }

  // ---------- синк ----------

  async function tick() {
    if (!state || !keys || !token) return IDLE_MS;
    const dev = state.deviceId;
    const now = Date.now();
    const { sessions, pending, closed } = await deps.snapshot();
    const body = { level: state.level };

    const sh = sha(sessions.map(s => ({ ...s, updatedAt: 0 })));
    const fullResend = now - sessionsAt > FULL_MS; // раз в 5 мин — всё заново: вдруг hub что-то потерял
    const sendSessions = sh !== sessionsHash || fullResend;
    const sessionHashes = new Map();
    if (sendSessions) {
      // Конверт каждый раз новый (новый IV), поэтому неизменённую сессию шлём без тела, с keep: hub не
      // переписывает строку, а Mini App не перекачивает её тело.
      body.sessions = await Promise.all(sessions.map(async ({ id, name, project, status, ...rest }) => {
        const h = sha({ name, project, status, ...rest, updatedAt: 0 });
        sessionHashes.set(id, h);
        const base = { sessionId: id, name, project: project || null, status };
        if (!fullResend && sessionSent.get(id) === h) return { ...base, keep: true };
        return { ...base, body: await seal(keys, aadFor(dev, 'session', id), rest) };
      }));
    }
    const fresh = pending.filter(r => !sentPending.has(r.id));
    if (fresh.length) {
      body.pending = await Promise.all(fresh.map(async r => ({
        id: r.id, sessionId: r.sessionId, kind: r.kind, tool: r.toolName, createdAt: r.createdAt,
        body: await seal(keys, aadFor(dev, 'request', r.id), {
          summary: r.summary, payload: r.payload, canAlways: r.canAlways,
          ...(typeof r.payload?.description === 'string' ? { description: r.payload.description } : {}),
        }),
      })));
    }
    const closing = closed.filter(c => sentPending.has(c.id));
    if (closing.length) body.closed = closing;
    const plan = deps.plan();
    const ph = plan ? sha(plan) : '';
    const sendPlan = !!plan && (ph !== planHash || now - planAt > FULL_MS);
    if (sendPlan) body.plan = await seal(keys, aadFor(dev, 'plan', dev), plan);
    const transcripts = [];
    for (const id of watched) {
      const items = await deps.transcriptFor(id);
      if (!items) continue;
      const h = sha(items);
      if (transcriptHash.get(id) !== h) transcripts.push({ id, h, body: await seal(keys, aadFor(dev, 'transcript', id), { items }) });
    }
    if (transcripts.length) body.transcripts = transcripts.map(t => ({ sessionId: t.id, body: t.body }));
    const sentResults = results.splice(0);
    if (sentResults.length) body.commandResults = sentResults;

    let reply;
    try {
      reply = await post('/api/device/sync', body, true);
    } catch (e) {
      results.unshift(...sentResults); // итоги не дошли — отправим следующим синком
      if (e.status === 401 && /revoked/.test(e.message)) { await wipe('revoked'); return IDLE_MS; }
      throw e;
    }
    status.lastOk = Date.now(); status.lastError = null;
    if (sendSessions) {
      sessionsHash = sh;
      if (fullResend) sessionsAt = now;
      sessionSent.clear();
      for (const [id, h] of sessionHashes) sessionSent.set(id, h);
    }
    for (const r of fresh) sentPending.add(r.id);
    for (const c of closing) sentPending.delete(c.id);
    if (sendPlan) { planHash = ph; planAt = now; }
    for (const t of transcripts) transcriptHash.set(t.id, t.h);
    for (const id of reply.watch || []) if (!watched.includes(id)) transcriptHash.delete(id);
    watched = reply.watch || [];
    for (const c of reply.commands || []) results.push(await execute(c));
    // Часто — только пока это нужно: свежий запрос, открытая на телефоне переписка, команды и их итоги.
    // Запрос может висеть часами (хук держит до суток), и опрос раз в 3 с всё это время съел бы квоту.
    const freshPending = pending.some(r => now - (Number(r.createdAt) || now) < FRESH_MS);
    return freshPending || (reply.commands || []).length || watched.length || results.length ? FAST_MS : POLL_MS;
  }

  /** Подписанная команда из Mini App → итог { cmdId, ok, error?, result? }. Всё, что не прошло, — в журнал. */
  async function execute(c) {
    const fail = (reason) => {
      note({ action: 'command', kind: c?.kind, target: c?.target, ok: false, reason });
      return { cmdId: String(c?.cmdId || ''), ok: false, error: reason };
    };
    const v = await verifyCommand(keys, c, { deviceId: state.deviceId, seenNonce: n => nonces.has(n) });
    if (!v.ok) return fail(v.reason);
    rememberNonce(c.nonce);
    if (!LEVEL_KINDS[state.level]?.includes(c.kind)) return fail(`уровень «${state.level}» не разрешает ${c.kind}`);
    const b = v.body || {};
    let out;
    try {
      if (c.kind === 'decision') {
        const r = deps.request(c.target);
        if (!r || r.status !== 'pending') return fail('на запрос уже ответили');
        const behavior = b.behavior === 'deny' ? 'deny' : 'allow';
        if (behavior === 'allow' && r.kind === 'permission') {
          const rule = stopRule(stoplist(), r.tool, r.input);
          if (rule) return fail(`стоп-список (${rule.name}): подтвердите на машине`);
        }
        // «Разрешать всегда» и смена режима удалённо не делаются — берём только допустимые поля.
        deps.decide(r, {
          behavior,
          ...(behavior === 'deny' && b.message ? { message: String(b.message).slice(0, 2000) } : {}),
          ...(behavior === 'allow' && r.kind === 'question' && b.answers && typeof b.answers === 'object' ? { answers: b.answers } : {}),
          via: 'hub',
        });
        out = { ok: true, output: behavior === 'deny' ? 'отклонено' : 'разрешено' };
      } else {
        out = await deps.runCommand({ id: c.cmdId, kind: c.kind, sessionId: c.target, payload: b });
      }
    } catch (e) {
      return fail(e.message);
    }
    note({ action: 'command', kind: c.kind, target: c.target, ok: !!out.ok, ...(out.ok ? {} : { reason: out.error }) });
    return {
      cmdId: c.cmdId, ok: !!out.ok, error: out.ok ? null : String(out.error || 'ошибка'),
      result: out.output ? await seal(keys, aadFor(state.deviceId, 'result', c.cmdId), { output: String(out.output).slice(0, 2000) }) : null,
    };
  }

  function rememberNonce(n) {
    const now = Date.now();
    nonces.set(n, now);
    for (const [k, t] of nonces) if (now - t > NONCE_TTL_MS) nonces.delete(k);
    writeJson(NONCE_FILE, Object.fromEntries(nonces)).catch(() => {});
  }

  async function loop() {
    if (running) return;
    running = true;
    let next = RETRY_MS;
    try { next = await tick(); } catch (e) {
      if (status.lastError !== e.message) console.error('[hub]', e.message);
      status.lastError = e.message;
    } finally { running = false; clearTimeout(timer); timer = setTimeout(loop, next); timer.unref?.(); }
  }
  // Таймеры не держат процесс: cockpit живёт за счёт http-сервера, тесты завершаются сами.
  function kick() { if (looping && !running) { clearTimeout(timer); timer = setTimeout(loop, 300); timer.unref?.(); } }

  return {
    async start({ loop = true } = {}) { await load(); looping = loop; kick(); },
    kick,
    status: () => ({
      url: hubUrl || null,
      device: state ? { id: state.deviceId, name: state.name, kid: state.kid, user: state.user, level: state.level, pairedAt: state.pairedAt } : null,
      ready: !!keys,
      pairing: publicPairing(),
      lastOk: status.lastOk, lastError: status.lastError,
      journal,
      stoplist: stoplist(),
      keychain: process.platform === 'darwin' ? 'macOS Keychain' : `файл ${SECRET_FILE} (0600)`,
    }),
    startPairing, confirmPairing, cancelPairing, unpair, setLevel, setStoplist,
    keyQr: () => (state && rawKey ? keyQr(state.deviceId, rawKey) : null),
    // для тестов
    _execute: execute, _tick: tick,
  };
}
