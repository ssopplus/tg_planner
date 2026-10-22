// dev-cockpit — локальный наблюдатель за сессиями Claude Code (часть tg-planer, на Vercel не деплоится).
// Живой статус берётся из `claude agents --json`, переписка и изменённые файлы —
// из транскриптов ~/.claude/projects/*/<sessionId>.jsonl (читаются инкрементально),
// изменения в коде — из git тех репозиториев, которые трогала сессия.
// Свои имена и проекты сессий хранятся в data/meta.json: переименовать уже
// запущенную сессию снаружи Claude Code нельзя (только /rename внутри неё).
// Слушает только 127.0.0.1. Зависимостей нет.

import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const pexec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const PROJECTS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const VAULT = process.env.VAULT_DIR || path.join(os.homedir(), 'Разработка', 'Документация');
const META_FILE = path.join(HERE, 'data', 'meta.json');
const TASK_KEY_RE = /\b[A-Z][A-Z0-9]{1,15}-\d{1,6}\b/;
const DERIVED_NAME_RE = /^claude-[0-9a-f]{2}$/;
const MAX_EVENTS = 60;
const MAX_CHAT = 500;
const MAX_TEXT = 20_000;
const MAX_TOOL_IO = 4_000;
const MAX_DIFF_BYTES = 600_000;

// ---------- настройки проектов и метаданные ----------

function loadProjectsConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'projects.json'), 'utf8')); }
  catch { return { queues: {}, repos: {} }; }
}

let meta = { sessions: {} };
try { meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8')); meta.sessions ||= {}; } catch {}
async function saveMeta() {
  await fsp.mkdir(path.dirname(META_FILE), { recursive: true });
  const tmp = META_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(meta, null, 2));
  await fsp.rename(tmp, META_FILE);
}
const metaOf = id => (meta.sessions[id] ||= {});

// ---------- живые сессии ----------

let agentsCache = { at: 0, data: [] };
async function liveAgents() {
  if (Date.now() - agentsCache.at < 2000) return agentsCache.data;
  try {
    const { stdout } = await pexec(CLAUDE_BIN, ['agents', '--json'], { timeout: 15000, maxBuffer: 10e6 });
    agentsCache = { at: Date.now(), data: JSON.parse(stdout) };
  } catch (e) {
    console.error('claude agents --json:', e.message);
    agentsCache.at = Date.now();
  }
  return agentsCache.data;
}

// ---------- транскрипты ----------

const transcriptPath = new Map(); // sessionId -> path
async function findTranscript(sessionId) {
  if (transcriptPath.has(sessionId)) return transcriptPath.get(sessionId);
  for (const dir of await fsp.readdir(PROJECTS_DIR)) {
    const p = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) { transcriptPath.set(sessionId, p); return p; }
  }
  return null;
}

const states = new Map(); // path -> состояние разбора
function newState() {
  return {
    offset: 0, rest: '',
    title: null, agentName: null, firstPrompt: null, lastPrompt: null, lastAssistant: null,
    lastActivity: null, firstActivity: null, gitBranch: null, cwd: null, model: null,
    toolCounts: {}, files: new Map(), dirs: new Map(), events: [], prompts: 0, recentPrompts: [],
    chat: [], seq: 0, toolsById: new Map(),
  };
}

// Отпечаток вызова инструмента: по нему запрос разрешения сопоставляется с вызовом в транскрипте.
// Ключи сортируются: хук получает вход после нормализации схемой, и порядок полей там другой
// (у AskUserQuestion `options` идёт раньше `multiSelect`, а в транскрипте — наоборот).
const canon = v => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
const toolKey = (name, input) => createHash('sha1').update(`${name}\n${JSON.stringify(canon(input || {}))}`).digest('hex').slice(0, 16);

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + `\n… (+${s.length - n} симв.)` : s);

function shortArg(name, input = {}) {
  if (input.file_path) return input.file_path;
  if (input.command) return String(input.command).split('\n')[0].slice(0, 200);
  if (input.pattern) return input.pattern;
  if (input.url) return input.url;
  if (input.description) return input.description;
  if (input.to && input.message) return `→ ${input.to}: ${String(input.message).slice(0, 100)}`;
  if (input.prompt) return String(input.prompt).slice(0, 120);
  if (Array.isArray(input.questions)) return input.questions.map(q => q.question).join(' / ').slice(0, 200);
  const k = Object.keys(input)[0];
  return k ? `${k}: ${String(input[k]).slice(0, 100)}` : '';
}

// Каталоги, в которых Bash что-то делал: `cd <path>` и `git -C <path>`.
const DIR_RES = [/(?:^|[;&|(]\s*)cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g, /git\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g];
function bashDirs(cmd) {
  const out = [];
  for (const re of DIR_RES) {
    for (const m of cmd.matchAll(re)) {
      let d = m[1] || m[2] || m[3];
      if (!d) continue;
      d = d.replace(/^~(?=\/|$)/, os.homedir());
      if (path.isAbsolute(d)) out.push(d);
    }
  }
  return out;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b?.type === 'text').map(b => b.text).join('\n');
  return '';
}

// Текст пользовательского сообщения так, как его видит человек, или null для служебных.
function promptText(o) {
  if (o.isMeta || o.isSidechain || o.isCompactSummary || o.toolUseResult) return null;
  const c = o.message?.content;
  if (Array.isArray(c) && c.some(b => b?.type === 'tool_result')) return null;
  let text = textOf(c).trim();
  // VS Code и харнесс приклеивают к промпту служебные блоки: <browser_instruction>, <ide_selection>…
  for (let prev; prev !== text;) { prev = text; text = text.replace(/^<([a-z_-]+)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/, '').trim(); }
  if (!text) return null;
  const cmd = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return `${cmd[1].trim()}${args ? ' ' + args : ''}`;
  }
  if (/^<(local-command|system-reminder|task-notification|bash-|user-memory)/.test(text)) return null;
  if (text.startsWith('[Request interrupted')) return null;
  return text;
}

// Межсессионное сообщение (в том числе из поля ввода cockpit) Claude Code пишет в транскрипт как
// служебное (isMeta, origin.kind = 'peer') и оборачивает своей инструкцией — VS Code его не показывает.
// Достаём сам текст и помечаем, откуда он: из cockpit (наша пометка) или из соседней сессии.
const PEER_HEAD = 'Another Claude session sent a message:';
const PEER_TAIL = '\n\nThis came from another Claude session';
const COCKPIT_MARK = '[из dev-cockpit] ';
function peerMessage(o) {
  if (o.isSidechain || (o.origin?.kind !== 'peer' && o.turnOrigin !== 'peer')) return null;
  let text = textOf(o.message?.content).trim();
  if (text.startsWith(PEER_HEAD)) text = text.slice(PEER_HEAD.length);
  const tail = text.indexOf(PEER_TAIL);
  if (tail !== -1) text = text.slice(0, tail);
  text = text.trim();
  if (!text) return null;
  return text.startsWith(COCKPIT_MARK) ? { via: 'cockpit', text: text.slice(COCKPIT_MARK.length) } : { via: 'peer', text };
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[изображение]' : '')).join('\n');
  return '';
}

function pushChat(st, item) {
  item.seq = ++st.seq;
  st.chat.push(item);
  if (st.chat.length > MAX_CHAT * 1.5) st.chat.splice(0, st.chat.length - MAX_CHAT);
}

function applyEntry(st, o) {
  const ts = o.timestamp ? Date.parse(o.timestamp) : null;
  switch (o.type) {
    case 'custom-title': st.title = o.customTitle || st.title; return;
    case 'agent-name': st.agentName = o.agentName || st.agentName; return;
    case 'user': {
      if (o.isSidechain) return;
      if (o.cwd) st.cwd = o.cwd;
      if (o.gitBranch) st.gitBranch = o.gitBranch;
      if (o.permissionMode) st.permissionMode = o.permissionMode;
      const c = o.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== 'tool_result') continue;
          const t = st.toolsById.get(b.tool_use_id);
          if (t) { t.result = clip(toolResultText(b.content), MAX_TOOL_IO); t.isError = !!b.is_error; t.done = ts; }
        }
      }
      const peer = peerMessage(o);
      if (peer) {
        st.events.push({ ts, kind: 'prompt', text: `${peer.via === 'cockpit' ? '[cockpit] ' : '[сессия] '}${peer.text.slice(0, 280)}` });
        pushChat(st, { kind: 'user', via: peer.via, ts, text: clip(peer.text, MAX_TEXT) });
        if (peer.via === 'cockpit') st.lastPrompt = peer.text;
        break;
      }
      const text = promptText(o);
      if (text) {
        st.lastPrompt = text; st.firstPrompt ??= text; st.prompts++;
        st.recentPrompts.push(text.slice(0, 500)); if (st.recentPrompts.length > 3) st.recentPrompts.shift();
        st.events.push({ ts, kind: 'prompt', text: text.slice(0, 300) });
        pushChat(st, { kind: 'user', ts, text: clip(text, MAX_TEXT) });
      }
      break;
    }
    case 'assistant': {
      if (o.isSidechain) return;
      if (o.cwd) st.cwd = o.cwd;
      if (o.gitBranch) st.gitBranch = o.gitBranch;
      if (o.message?.model && o.message.model !== '<synthetic>') st.model = o.message.model;
      for (const b of o.message?.content || []) {
        if (b?.type === 'text' && b.text?.trim()) {
          st.lastAssistant = b.text;
          pushChat(st, { kind: 'assistant', ts, text: clip(b.text, MAX_TEXT) });
        }
        if (b?.type !== 'tool_use') continue;
        st.toolCounts[b.name] = (st.toolCounts[b.name] || 0) + 1;
        const inp = b.input || {};
        if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(b.name) && inp.file_path) {
          const f = st.files.get(inp.file_path) || { edits: 0, last: 0 };
          f.edits++; f.last = ts || f.last; st.files.set(inp.file_path, f);
        }
        if (b.name === 'Bash' && inp.command) for (const d of bashDirs(inp.command)) st.dirs.set(d, (st.dirs.get(d) || 0) + 1);
        const summary = shortArg(b.name, inp);
        st.events.push({ ts, kind: 'tool', tool: b.name, text: summary });
        const item = { kind: 'tool', ts, id: b.id, name: b.name, summary, input: clip(JSON.stringify(inp, null, 2), MAX_TOOL_IO), key: toolKey(b.name, inp) };
        if (b.name === 'AskUserQuestion') item.questions = inp.questions;
        pushChat(st, item);
        st.toolsById.set(b.id, item);
        if (st.toolsById.size > 400) st.toolsById.delete(st.toolsById.keys().next().value);
      }
      break;
    }
    default: return;
  }
  if (ts) { st.lastActivity = ts; st.firstActivity ??= ts; }
  if (st.events.length > MAX_EVENTS * 2) st.events.splice(0, st.events.length - MAX_EVENTS);
}

async function readTranscript(p) {
  let st = states.get(p);
  const stat = await fsp.stat(p);
  if (!st || stat.size < st.offset) { st = newState(); states.set(p, st); }
  if (stat.size === st.offset) return st;
  const fd = await fsp.open(p, 'r');
  try {
    const CHUNK = 4 << 20;
    const buf = Buffer.alloc(CHUNK);
    while (st.offset < stat.size) {
      const { bytesRead } = await fd.read(buf, 0, Math.min(CHUNK, stat.size - st.offset), st.offset);
      if (!bytesRead) break;
      st.offset += bytesRead;
      const lines = (st.rest + buf.toString('utf8', 0, bytesRead)).split('\n');
      st.rest = lines.pop();
      for (const line of lines) {
        // Тела API-запросов огромные и нам не нужны.
        if (!line || line.slice(0, 120).includes('"api-request')) continue;
        try { applyEntry(st, JSON.parse(line)); } catch { /* битая строка */ }
      }
    }
  } finally { await fd.close(); }
  return st;
}

// ---------- git ----------

const gitRootCache = new Map(); // dir -> root | null
async function gitRoot(p) {
  let dir = p;
  try { if (!(await fsp.stat(p)).isDirectory()) dir = path.dirname(p); } catch { dir = path.dirname(p); }
  while (dir && !fs.existsSync(dir)) dir = path.dirname(dir);
  if (gitRootCache.has(dir)) return gitRootCache.get(dir);
  let root = null;
  try { root = (await pexec('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 5000 })).stdout.trim() || null; } catch {}
  gitRootCache.set(dir, root);
  return root;
}

// Имя основного репозитория для worktree (erp-209 → erp).
const mainRepoCache = new Map();
async function mainRepoName(root) {
  if (mainRepoCache.has(root)) return mainRepoCache.get(root);
  let name = path.basename(root);
  try {
    const common = (await pexec('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 5000 })).stdout.trim();
    if (common.endsWith('/.git')) name = path.basename(path.dirname(common));
  } catch {}
  mainRepoCache.set(root, name);
  return name;
}

const knownRepos = new Set(); // только их разрешено отдавать в /api/repo и /api/diff
const git = (repo, args, opts = {}) => pexec('git', ['-C', repo, ...args], { timeout: 15000, maxBuffer: 20e6, ...opts }).then(r => r.stdout);

// База ветки: из кандидатов берём ту, от которой HEAD ушёл меньше всего коммитов
// (у нас бывают master, main, turbo_main и мёртвый origin/HEAD → develop).
async function detectBase(repo) {
  const cands = ['origin/HEAD', 'origin/master', 'origin/main', 'origin/turbo_main', 'master', 'main'];
  let best = null;
  for (const c of cands) {
    try {
      const n = Number((await git(repo, ['rev-list', '--count', `${c}..HEAD`])).trim());
      if (best === null || n < best.ahead) best = { ref: c, ahead: n };
    } catch {}
  }
  return best;
}

const repoCache = new Map(); // repo -> { at, data }
async function repoInfo(repo) {
  const c = repoCache.get(repo);
  if (c && Date.now() - c.at < 4000) return c.data;
  const data = { repo, name: path.basename(repo) };
  try {
    data.branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    data.status = (await git(repo, ['status', '--porcelain=v1', '-uall'])).split('\n').filter(Boolean)
      .slice(0, 300).map(l => ({ code: l.slice(0, 2), file: l.slice(3) }));
    const base = await detectBase(repo);
    if (base) {
      data.base = base.ref; data.ahead = base.ahead;
      if (base.ahead > 0) {
        data.commits = (await git(repo, ['log', '--format=%h%x09%ct%x09%s', `${base.ref}..HEAD`, '-n', '40'])).split('\n')
          .filter(Boolean).map(l => { const [h, t, s] = l.split('\t'); return { hash: h, ts: Number(t) * 1000, subject: s }; });
        data.branchStat = await numstat(repo, [`${base.ref}...HEAD`]);
      }
    }
    data.workStat = await numstat(repo, ['HEAD']);
  } catch (e) { data.error = e.message.split('\n')[0]; }
  repoCache.set(repo, { at: Date.now(), data });
  return data;
}

async function numstat(repo, range) {
  const out = await git(repo, ['diff', '--numstat', ...range]);
  return out.split('\n').filter(Boolean).slice(0, 400).map(l => {
    const [a, d, f] = l.split('\t');
    return { file: f, add: a === '-' ? null : Number(a), del: d === '-' ? null : Number(d) };
  });
}

// ---------- имена и проекты ----------

function displayName(a, st, m) {
  if (m.name && m.nameSource === 'user') return { name: m.name, source: 'cockpit' };
  if (st?.title) return { name: st.title, source: 'rename' };
  if (a.name && !DERIVED_NAME_RE.test(a.name)) return { name: a.name, source: 'claude' };
  if (m.name) return { name: m.name, source: 'auto' };
  return { name: a.name || a.sessionId.slice(0, 8), source: 'derived' };
}

async function resolveProject(s, st, m, cfg) {
  if (m.project) return { project: m.project, projectSource: 'user' };
  const queue = s.taskKey?.split('-')[0];
  if (queue && cfg.queues?.[queue]) return { project: cfg.queues[queue], projectSource: 'task' };
  // Основной репозиторий — тот, где больше всего правок; cd/git -C весят меньше.
  const score = new Map();
  for (const [f, info] of st?.files || []) { const r = await gitRoot(f); if (r) score.set(r, (score.get(r) || 0) + 3 * info.edits); }
  for (const [d, n] of st?.dirs || []) { const r = await gitRoot(d); if (r) score.set(r, (score.get(r) || 0) + n); }
  const ranked = [...score].filter(([r]) => r !== VAULT).sort((x, y) => y[1] - x[1]);
  const top = ranked[0]?.[0] || (score.has(VAULT) ? VAULT : null);
  if (!top) return { project: 'Без проекта', projectSource: 'none' };
  const repo = await mainRepoName(top);
  return { project: cfg.repos?.[repo] || repo, projectSource: 'repo' };
}

// Автоименование через `claude -p` на Haiku без инструментов, MCP и настроек.
const NAME_SYSTEM = 'Ты придумываешь короткие названия рабочих сессий разработчика по его запросам к ассистенту. '
  + 'Ответь ТОЛЬКО названием: 2–5 слов по-русски, без кавычек и точки в конце, суть задачи, а не действие ассистента. '
  + 'Если указан ключ задачи трекера — начни с него, например «POLAERP-201 ускорение удаления рейса».';
const naming = new Set();
const nameQueue = [];
let nameWorkers = 0;

function generateName(input) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--strict-mcp-config',
      '--setting-sources', '', '--disable-slash-commands', '--system-prompt', NAME_SYSTEM];
    const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; // только подписка
    const p = spawn(CLAUDE_BIN, args, { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGTERM'), 60000);
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('close', code => {
      clearTimeout(timer);
      const name = out.trim().split('\n').pop()?.replace(/^["«']|["»'.]$/g, '').trim();
      if (code === 0 && name) resolve(name.slice(0, 80));
      else reject(new Error(err.trim() || `exit ${code}`));
    });
    p.stdin.end(input);
  });
}

async function nameWorker() {
  nameWorkers++;
  try {
    while (nameQueue.length) {
      const job = nameQueue.shift();
      try {
        const name = await generateName(job.input);
        const m = metaOf(job.sessionId);
        if (m.nameSource !== 'user') { m.name = name; m.nameSource = 'auto'; m.namedAt = Date.now(); await saveMeta(); }
      } catch (e) { console.error('autoname', job.sessionId, e.message); }
      naming.delete(job.sessionId);
    }
  } finally { nameWorkers--; }
}

async function queueAutoname(ids, force) {
  const agents = await liveAgents();
  let queued = 0;
  for (const a of agents) {
    if (ids && !ids.includes(a.sessionId)) continue;
    if (naming.has(a.sessionId)) continue;
    const p = await findTranscript(a.sessionId);
    const st = p ? await readTranscript(p) : null;
    const m = metaOf(a.sessionId);
    const dn = displayName(a, st, m);
    if (!force && dn.source !== 'derived') continue;
    if (!st?.firstPrompt) continue;
    const key = `${st.title || ''} ${a.name || ''} ${st.gitBranch || ''} ${st.firstPrompt}`.match(TASK_KEY_RE)?.[0];
    const input = [
      `Ключ задачи: ${key || 'нет'}`,
      `Первый запрос:\n${st.firstPrompt.slice(0, 1500)}`,
      `Последние запросы:\n${st.recentPrompts.join('\n---\n')}`,
    ].join('\n\n');
    naming.add(a.sessionId); nameQueue.push({ sessionId: a.sessionId, input }); queued++;
  }
  while (nameWorkers < 4 && nameQueue.length) nameWorker();
  return queued;
}

// ---------- запросы сессий (разрешения и вопросы) ----------

const HOOK_HOLD_MS = Number(process.env.HOOK_HOLD_MS || 590_000); // чуть меньше timeout хука 600 с
const HOOK_LOG = path.join(path.dirname(META_FILE), 'hooks.jsonl');
const requests = new Map(); // id -> запрос
let requestSeq = 0;

async function hookLog(rec) {
  await fsp.mkdir(path.dirname(HOOK_LOG), { recursive: true });
  try { if ((await fsp.stat(HOOK_LOG)).size > 5e6) await fsp.rename(HOOK_LOG, HOOK_LOG + '.1'); } catch {}
  await fsp.appendFile(HOOK_LOG, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n');
}

function publicRequest(r) {
  const out = { ...r };
  delete out.respond; delete out.timer;
  return out;
}

function holdPermission(b, res) {
  const id = `r${Date.now().toString(36)}${(++requestSeq).toString(36)}`;
  const r = {
    id, sessionId: b.session_id, tool: b.tool_name,
    kind: b.tool_name === 'AskUserQuestion' ? 'question' : 'permission',
    input: b.tool_input || {}, suggestions: b.permission_suggestions || null,
    mode: b.permission_mode, createdAt: Date.now(), status: 'pending',
    key: toolKey(b.tool_name, b.tool_input),
  };
  r.respond = body => {
    clearTimeout(r.timer);
    if (!res.writableEnded && !res.destroyed) send(res, 200, body);
  };
  r.timer = setTimeout(() => close(r, 'expired'), HOOK_HOLD_MS);
  // Сессия закрыла соединение: ответили в VS Code, прервали ход или истёк timeout хука.
  res.on('close', () => { if (r.status === 'pending') close(r, 'closed'); });
  requests.set(id, r);
  hookLog({ event: 'request-open', id, session: r.sessionId, tool: r.tool });
  kickSync();
}

function close(r, status) {
  if (r.status !== 'pending') return;
  r.status = status; r.closedAt = Date.now();
  r.respond({});
  hookLog({ event: `request-${status}`, id: r.id, session: r.sessionId });
}

const SETTABLE_MODES = ['default', 'acceptEdits', 'plan', 'auto'];

// Решение из UI: { behavior: 'allow'|'deny', always?, message?, answers?, setMode? }.
function decide(r, d) {
  const decision = { behavior: d.behavior === 'deny' ? 'deny' : 'allow' };
  if (decision.behavior === 'deny') {
    decision.message = String(d.message || 'Отклонено в dev-cockpit').slice(0, 2000);
  } else if (r.kind === 'question') {
    // Ответ на AskUserQuestion: вопрос → выбранная метка (несколько — через запятую).
    const answers = {};
    for (const [q, a] of Object.entries(d.answers || {})) answers[String(q)] = Array.isArray(a) ? a.join(', ') : String(a);
    decision.updatedInput = { ...r.input, answers };
  } else if (d.always && Array.isArray(r.suggestions) && r.suggestions.length) {
    decision.updatedPermissions = r.suggestions;
  }
  // Смена режима сессии вместе с ответом — единственный способ поменять режим снаружи. Bypass и
  // dontAsk снимают проверки, поэтому из cockpit их не включаем.
  if (decision.behavior === 'allow' && SETTABLE_MODES.includes(d.setMode)) {
    decision.updatedPermissions = [...(decision.updatedPermissions || []), { type: 'setMode', mode: d.setMode, destination: 'session' }];
  }
  r.status = 'answered'; r.closedAt = Date.now();
  r.decision = { ...d, behavior: decision.behavior };
  r.respond({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
  hookLog({ event: 'request-answered', id: r.id, session: r.sessionId, behavior: decision.behavior });
  return r;
}

// Ответ в VS Code соединение хука не закрывает. Поэтому смотрим в транскрипт: у вызова
// с тем же отпечатком появился результат — значит, решили в другом месте, запрос снимаем.
async function closeAnsweredElsewhere() {
  for (const r of requests.values()) {
    if (r.status !== 'pending') continue;
    const p = await findTranscript(r.sessionId);
    const st = p ? await readTranscript(p) : null;
    if (!st) continue;
    for (let i = st.chat.length - 1; i >= 0; i--) {
      const it = st.chat[i];
      if (it.ts && it.ts < r.createdAt - 10_000) break;
      if (it.kind === 'tool' && it.key === r.key && it.result !== undefined) { close(r, 'answered-elsewhere'); break; }
    }
  }
}

function requestsPayload() {
  const now = Date.now();
  for (const [id, r] of requests) if (r.status !== 'pending' && now - r.closedAt > 3600e3) requests.delete(id);
  const list = [...requests.values()].map(publicRequest).sort((a, b) => b.createdAt - a.createdAt);
  return { pending: list.filter(r => r.status === 'pending'), recent: list.filter(r => r.status !== 'pending').slice(0, 30) };
}

// ---------- свободный текст в сессию ----------
// Межсессионный сокет Claude Code: JSON-строка {"type":"user",...} в messagingSocketPath из
// ~/.claude/sessions/<pid>.json. Формат не задокументирован (взят из подсказки в коде CLI),
// строка авторизации на macOS необязательна. Claude получает текст как межсессионное
// сообщение, а не как команду пользователя.
const SESSIONS_DIR = path.join(path.dirname(PROJECTS_DIR), 'sessions');

// Регистрация сессии с путём сокета: у интерактивной — по pid, у фоновой (`claude --bg`) pid в
// `claude agents` нет, ищем по id сессии среди всех регистраций.
async function sessionRegistration(a) {
  if (a.pid) return JSON.parse(await fsp.readFile(path.join(SESSIONS_DIR, `${a.pid}.json`), 'utf8'));
  for (const f of await fsp.readdir(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const reg = JSON.parse(await fsp.readFile(path.join(SESSIONS_DIR, f), 'utf8').catch(() => '{}'));
    if (reg.sessionId === a.sessionId) return reg;
  }
  throw new Error(a.kind === 'background'
    ? `фоновая сессия ещё не запустилась (${a.state || 'нет состояния'}) — открой её в терминале: claude attach ${a.id}`
    : 'регистрация сессии не найдена');
}

async function sendToSession(a, text) {
  const reg = await sessionRegistration(a);
  if (reg.sessionId !== a.sessionId || !reg.messagingSocketPath) throw new Error('у сессии нет входящего сокета');
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: `[из dev-cockpit] ${text}` } }) + '\n';
  await new Promise((resolve, reject) => {
    const sock = net.createConnection(reg.messagingSocketPath);
    const timer = setTimeout(() => { sock.destroy(); resolve(); }, 1500);
    sock.on('connect', () => sock.end(line));
    sock.on('close', () => { clearTimeout(timer); resolve(); });
    sock.on('error', e => { clearTimeout(timer); reject(e); });
  });
  hookLog({ event: 'message-sent', session: a.sessionId, text: text.slice(0, 200) });
}

// ---------- заметки задач в vault (ворклог start-task) ----------
// Скилл start-task ведёт на задачу заметку в Документация/Проекты/…: шапка `issue: КЛЮЧ`, чек-лист
// «## Что нужно сделать» и «## Ворклог» с записью на каждую сессию: `### 2026-10-21 · сессия 8a228037`,
// внутри «Сделано: … Осталось: … Блокеры: …». Сессия связывается с заметкой по первым 8 символам
// своего id в заголовке записи или по ключу задачи.
const NOTES_ROOT = path.join(VAULT, 'Проекты');
const NOTES_SCAN_MS = 30_000;
const noteCache = new Map(); // path -> { mtime, note | null }
let notesScannedAt = 0;

function parseTaskNote(file, text) {
  if (!/^## Ворклог/m.test(text)) return null;
  const head = text.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  const field = k => head.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim() || null;
  const section = name => {
    const m = text.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
    return m ? m[1] : '';
  };
  const todo = [...section('Что нужно сделать').matchAll(/^\s*- \[([ xX])\] (.+)$/gm)].map(m => ({ done: m[1] !== ' ', text: m[2].trim() }));
  const log = [];
  for (const m of section('Ворклог').matchAll(/^### (\d{4}-\d{2}-\d{2}) · сессия ([0-9a-f]{8})[^\n]*\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)) {
    const parts = {};
    for (const p of m[3].split(/^(?=(?:Сделано|Осталось|Блокеры):)/m)) {
      const k = p.match(/^(Сделано|Осталось|Блокеры):\s*/);
      if (k) parts[{ Сделано: 'done', Осталось: 'left', Блокеры: 'blockers' }[k[1]]] = p.slice(k[0].length).trim();
    }
    log.push({ date: m[1], session: m[2], ...parts });
  }
  return {
    file, issue: field('issue'), branch: field('branch'), mr: field('mr'),
    title: text.match(/^# (.+)$/m)?.[1].trim() || path.basename(file, '.md'), todo, log,
  };
}

async function taskNotes() {
  if (Date.now() - notesScannedAt > NOTES_SCAN_MS) {
    notesScannedAt = Date.now();
    const files = [];
    const walk = async dir => {
      for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.md')) files.push(p);
      }
    };
    await walk(NOTES_ROOT);
    const alive = new Set(files);
    for (const p of noteCache.keys()) if (!alive.has(p)) noteCache.delete(p);
    for (const p of files) {
      const st = await fsp.stat(p).catch(() => null);
      if (!st || noteCache.get(p)?.mtime === st.mtimeMs) continue;
      noteCache.set(p, { mtime: st.mtimeMs, note: parseTaskNote(p, await fsp.readFile(p, 'utf8')) });
    }
  }
  return [...noteCache.values()].map(x => x.note).filter(Boolean);
}

// Заметки, к которым относится сессия: её запись в ворклоге или ключ задачи в имени/ветке.
async function notesForSession(sessionId, taskKey) {
  const sid = sessionId.slice(0, 8);
  return (await taskNotes()).filter(n => n.log.some(e => e.session === sid) || (taskKey && n.issue === taskKey));
}

// Краткая сводка для карточки на доске: пункты плана и «Осталось» этой сессии (или последнее).
function taskBrief(n, sessionId) {
  const mine = n.log.filter(e => e.session === sessionId.slice(0, 8)).at(-1);
  return {
    issue: n.issue, title: n.title, done: n.todo.filter(t => t.done).length, total: n.todo.length,
    left: (mine || n.log.at(-1))?.left || null, own: !!mine,
    next: n.todo.find(t => !t.done)?.text.slice(0, 200) || null,
  };
}

// ---------- статусы задач в Яндекс Трекере ----------
// Только чтение: POST /v2/issues/_search по списку ключей. Токен и организация — из env или из
// ~/Разработка/.mcp.json (сервер yandex-tracker), чтобы не заводить второй секрет. Нет доступа —
// статусов просто нет, доска работает как раньше.
const TRACKER_TTL_MS = 120_000;
const trackerCache = new Map(); // key -> { at, status | null }
let trackerCfg;
function loadTrackerConfig() {
  if (trackerCfg !== undefined) return trackerCfg;
  let token = process.env.TRACKER_TOKEN, org = process.env.TRACKER_ORG_ID;
  if (!token) {
    try {
      const env = JSON.parse(fs.readFileSync(path.join(path.dirname(VAULT), '.mcp.json'), 'utf8')).mcpServers?.['yandex-tracker']?.env || {};
      token = env.TRACKER_TOKEN; org ||= env.TRACKER_ORG_ID;
    } catch { /* нет файла — нет статусов */ }
  }
  trackerCfg = token && org ? { token, org } : null;
  return trackerCfg;
}

// Ответа Трекера на каждый опрос доски не ждём: обновляем фоном, отдаём то, что в кэше.
let trackerInflight = null;
function trackerStatuses(keys) {
  const cfg = loadTrackerConfig();
  const out = {};
  if (!cfg || !keys.length) return out;
  const stale = keys.filter(k => !(Date.now() - (trackerCache.get(k)?.at || 0) < TRACKER_TTL_MS));
  if (stale.length && !trackerInflight) {
    trackerInflight = fetch('https://api.tracker.yandex.net/v2/issues/_search?perPage=100', {
      method: 'POST',
      headers: { authorization: `OAuth ${cfg.token}`, 'x-org-id': cfg.org, 'content-type': 'application/json' },
      body: JSON.stringify({ keys: stale.slice(0, 100) }),
      signal: AbortSignal.timeout(15_000),
    }).then(async res => {
      if (!res.ok) throw new Error(`Трекер ${res.status}`);
      const found = new Map((await res.json()).map(i => [i.key, i]));
      for (const k of stale) {
        const i = found.get(k);
        // Тестирование и ревью у Трекера того же типа inProgress, что и «В работе», — различаем по ключу.
        const type = /test|review|ready|check/i.test(i?.status?.key || '') && i?.statusType?.key === 'inProgress' ? 'review' : i?.statusType?.key || null;
        trackerCache.set(k, { at: Date.now(), status: i ? { display: i.status?.display, key: i.status?.key, type, resolution: i.resolution?.display || null } : null });
      }
    }).catch(e => {
      // Повторим через полминуты, старый статус пока оставляем.
      for (const k of stale) trackerCache.set(k, { at: Date.now() - TRACKER_TTL_MS + 30_000, status: trackerCache.get(k)?.status ?? null });
      console.error('[tracker]', e.message);
    }).finally(() => { trackerInflight = null; });
  }
  for (const k of keys) { const st = trackerCache.get(k)?.status; if (st) out[k] = st; }
  return out;
}

// ---------- сборка ответа ----------

// Фоновые сессии (`claude --bg`, запуск задачи из Mini App) отдают не status, а state.
// blocked — стоит на интерактивном вопросе (доверие к папке, MCP-серверы проекта): ответить
// можно только в терминале через `claude attach`, хуки и сокет до этого не работают.
function backgroundStatus(a) {
  if (a.kind !== 'background') return {};
  if (a.state === 'blocked') {
    return { status: 'waiting', waitingFor: `ответа в терминале — фоновая сессия стоит на вопросе Claude Code: claude attach ${a.id}` };
  }
  return { status: /run|busy|work/i.test(a.state || '') ? 'busy' : 'idle' };
}

async function sessionSummary(a, cfg) {
  const s = { ...a, ...backgroundStatus(a) };
  const m = meta.sessions[a.sessionId] || {};
  let st = null;
  try {
    const p = await findTranscript(a.sessionId);
    if (p) {
      st = await readTranscript(p);
      s.lastPrompt = st.lastPrompt?.slice(0, 1500) ?? null;
      s.lastAssistant = st.lastAssistant?.slice(0, 1500) ?? null;
      s.lastActivity = st.lastActivity; s.firstActivity = st.firstActivity;
      s.gitBranch = st.gitBranch; s.model = st.model; s.prompts = st.prompts;
      s.permissionMode = st.permissionMode || null;
      s.toolCounts = st.toolCounts;
      s.filesCount = st.files.size;
      const roots = new Set();
      for (const f of st.files.keys()) { const r = await gitRoot(f); if (r) roots.add(r); }
      for (const d of st.dirs.keys()) { const r = await gitRoot(d); if (r) roots.add(r); }
      s.repos = [...roots];
      for (const r of roots) knownRepos.add(r);
    }
  } catch (e) { s.error = e.message; }
  const dn = displayName(a, st, m);
  s.title = dn.name; s.nameSource = dn.source; s.naming = naming.has(a.sessionId);
  s.claudeName = a.name;
  const key = `${s.title || ''} ${a.name || ''} ${s.gitBranch || ''}`.match(TASK_KEY_RE);
  s.taskKey = key ? key[0] : null;
  Object.assign(s, await resolveProject(s, st, m, cfg));
  s.tasks = (await notesForSession(a.sessionId, s.taskKey)).map(n => taskBrief(n, a.sessionId));
  // Порядок репо: worktree задачи первым, vault (его трогает почти каждая сессия) — последним.
  const num = s.taskKey?.split('-')[1];
  const rank = r => (num && path.basename(r).endsWith(`-${num}`) ? 0 : r === VAULT ? 2 : 1);
  s.repos = (s.repos || []).sort((x, y) => rank(x) - rank(y));
  return s;
}

async function sessionsPayload() {
  const cfg = loadProjectsConfig();
  const agents = await liveAgents();
  const sessions = await Promise.all(agents.map(a => sessionSummary(a, cfg)));
  await closeAnsweredElsewhere();
  const keysOf = x => [x.taskKey, ...(x.tasks || []).map(t => t.issue)].filter(Boolean);
  const statuses = trackerStatuses([...new Set(sessions.flatMap(keysOf))]);
  for (const x of sessions) x.trackerStatus = Object.fromEntries(keysOf(x).filter(k => statuses[k]).map(k => [k, statuses[k]]));
  const projects = [...new Set([...Object.values(cfg.queues || {}), ...Object.values(cfg.repos || {}), ...sessions.map(s => s.project)])].sort();
  const { pending } = requestsPayload();
  for (const s of sessions) {
    s.requests = pending.filter(r => r.sessionId === s.sessionId);
    // Режим из запроса свежее транскрипта: хук получает его в момент вопроса.
    if (s.requests[0]?.mode) s.permissionMode = s.requests[0].mode;
  }
  return { at: Date.now(), sessions, projects, pending, sync: syncStatus };
}

async function sessionDetail(id, since) {
  const cfg = loadProjectsConfig();
  const a = (await liveAgents()).find(x => x.sessionId === id);
  if (!a) return null;
  const s = await sessionSummary(a, cfg);
  s.requests = requestsPayload().pending.filter(r => r.sessionId === id);
  const p = await findTranscript(id);
  const st = p ? states.get(p) : null;
  s.cwd = st?.cwd || a.cwd;
  s.events = st?.events.slice(-MAX_EVENTS) || [];
  s.files = st ? [...st.files].map(([file, f]) => ({ file, ...f })).sort((x, y) => y.last - x.last) : [];
  const chat = st?.chat.slice(-MAX_CHAT) || [];
  // Инструменты дополняются результатом задним числом, поэтому при since отдаём ещё и хвост.
  s.chat = since ? chat.filter(c => c.seq > since - 60) : chat;
  s.chatSeq = st?.seq || 0;
  s.chatTruncated = (st?.chat[0]?.seq || 1) > 1;
  s.taskNotes = (await notesForSession(id, s.taskKey)).map(n => ({ ...n, file: path.relative(VAULT, n.file) }));
  s.trackerStatus = trackerStatuses([...new Set([s.taskKey, ...s.taskNotes.map(n => n.issue)].filter(Boolean))]);
  return s;
}

// ---------- синк с tg-planer (Mini App) ----------
// Cockpit сам ходит в POST /api/cockpit/sync: шлёт снимок сессий, ожидающие запросы и итоги
// закрытых, получает решения и команды из Mini App. Входящих соединений на машину нет. Включается
// файлом data/sync.json {"url":"https://…/api/cockpit/sync","secret":"…"}; без него синка нет.
// Переписка и diff не уходят: только имя, статус, последняя реплика Claude, план и ворклог задачи
// и входы запросов, с замаскированными секретами.
const SYNC_FILE = path.join(path.dirname(META_FILE), 'sync.json');
const SYNC_FAST_MS = 3_000;    // есть ожидающие запросы или команды — ждём следующего шага
const SYNC_CHECK_MS = 5_000;   // как часто смотреть, не пора ли синкаться
const SYNC_POLL_MS = 10_000;   // покой: лёгкий опрос без снимка — за решениями и командами с телефона
const SYNC_FULL_MS = 300_000;  // снимок целиком — при изменении и не реже раза в 5 мин
const SYNC_IDLE_MS = 60_000;   // синк выключен — проверяем, не появился ли sync.json
const SYNC_RETRY_MS = 30_000;
const syncStatus = { enabled: false, lastOk: null, lastError: null };
let syncTimer = null, syncRunning = false, syncLastSent = 0, syncLastFull = 0, syncLastHash = '';
const commandResults = []; // итоги команд, уйдут следующим синком
// Сессии, которые сейчас открыты в Mini App: только их переписка уходит с машины.
let watched = new Set();
const transcriptHash = new Map(); // sessionId -> хеш отправленной переписки
const TRANSCRIPT_ITEMS = 100;
const TRANSCRIPT_TEXT = 3_000;

// Хвост переписки для Mini App: реплики целиком (обрезаны и замаскированы), действия Claude —
// только название и строка-описание, без входа и вывода.
async function transcriptFor(sessionId) {
  const p = await findTranscript(sessionId);
  const st = p ? await readTranscript(p) : null;
  if (!st) return null;
  return st.chat.slice(-TRANSCRIPT_ITEMS).map(it => {
    const cut = t => mask(t.length > TRANSCRIPT_TEXT ? t.slice(0, TRANSCRIPT_TEXT) + '\n…' : t);
    if (it.kind === 'tool') return { kind: 'tool', ts: it.ts, name: it.name, summary: mask(it.summary || '').slice(0, 200), ...(it.isError ? { isError: true } : {}) };
    return { kind: it.kind, ts: it.ts, text: cut(it.text || ''), ...(it.via ? { via: it.via } : {}) };
  });
}

// Каталог, где запускаются новые сессии по задаче: там CLAUDE.md, .mcp.json и vault.
const TASK_CWD = process.env.COCKPIT_TASK_CWD || path.dirname(VAULT);

// Задачи сессии для Mini App: статус в Трекере, план и запись ворклога этой сессии (или последняя).
function taskSnapshot(s, notes) {
  const sid = s.sessionId.slice(0, 8);
  const status = k => (s.trackerStatus?.[k] ? { display: s.trackerStatus[k].display, type: s.trackerStatus[k].type } : null);
  const out = notes.map(n => {
    const e = n.log.filter(x => x.session === sid).at(-1) || n.log.at(-1);
    const cut = (t, len) => (t ? mask(t.length > len ? t.slice(0, len) + '…' : t) : undefined);
    return {
      issue: n.issue, title: n.issue ? n.title.replace(`${n.issue} — `, '') : n.title, status: status(n.issue),
      todo: n.todo.slice(0, 40).map(t => ({ done: t.done, text: cut(t.text, 300) })),
      log: e ? { date: e.date, own: e.session === sid, done: cut(e.done, 1500), left: cut(e.left, 1000), blockers: cut(e.blockers, 500) } : null,
    };
  });
  if (s.taskKey && !out.some(t => t.issue === s.taskKey) && status(s.taskKey)) {
    out.unshift({ issue: s.taskKey, title: s.taskKey, status: status(s.taskKey), todo: [], log: null });
  }
  return out;
}

// Команда из Mini App: текст в сессию или новая фоновая сессия по задаче.
// Вкладка Claude в VS Code с подставленным `/start-task КЛЮЧ` (uri-хендлер расширения: /open?prompt=&session=).
const vscodeTaskUri = key => `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(`/start-task ${key}`)}`;

// Скрины из Mini App: сохраняем файлами, в сессию уходят пути — Claude откроет их через Read.
const UPLOADS_DIR = path.join(HERE, 'data', 'uploads');
const UPLOADS_TTL_MS = 7 * 86400e3;
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function saveImages(c) {
  const images = Array.isArray(c.payload?.images) ? c.payload.images : [];
  if (!images.length) return [];
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  for (const f of await fsp.readdir(UPLOADS_DIR)) {
    const file = path.join(UPLOADS_DIR, f);
    const st = await fsp.stat(file).catch(() => null);
    if (st && Date.now() - st.mtimeMs > UPLOADS_TTL_MS) await fsp.rm(file, { force: true });
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return Promise.all(images.map(async (img, i) => {
    const ext = IMAGE_EXT[img.mime];
    if (!ext || typeof img.data !== 'string') throw new Error('скрин не похож на картинку');
    const file = path.join(UPLOADS_DIR, `${stamp}-${String(c.id).slice(0, 8)}-${i + 1}.${ext}`);
    await fsp.writeFile(file, Buffer.from(img.data, 'base64'));
    return file;
  }));
}

async function runCommand(c) {
  try {
    if (c.kind === 'message') {
      const a = (await liveAgents()).find(x => x.sessionId === c.sessionId);
      if (!a) throw new Error('сессия закрыта или не найдена');
      const files = await saveImages(c);
      const text = String(c.payload?.text || '');
      const shots = files.length
        ? `${text ? '\n\n' : ''}${files.length > 1 ? 'Скрины' : 'Скрин'} с телефона — открой через Read:\n${files.map(f => `- ${f}`).join('\n')}`
        : '';
      await sendToSession(a, text + shots);
      return { id: c.id, ok: true };
    }
    if (c.kind === 'start-task') {
      const key = String(c.payload?.issueKey || '');
      if (!/^[A-Z][A-Z0-9]{1,15}-\d{1,6}$/.test(key)) throw new Error('неверный ключ задачи');
      if (c.payload?.where === 'vscode') {
        // Расширение Claude открывает вкладку с подставленным текстом, но не отправляет его.
        await pexec('open', [vscodeTaskUri(key)], { timeout: 15_000 });
        hookLog({ event: 'task-opened-vscode', issue: key });
        return { id: c.id, ok: true, output: 'вкладка Claude открыта в VS Code — отправь /start-task там Enter' };
      }
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY; // иначе фоновая сессия уйдёт в оплату по API, а не по подписке
      const { stdout, stderr } = await pexec(CLAUDE_BIN, ['--bg', '--name', key, `/start-task ${key}`], { cwd: TASK_CWD, env, timeout: 60_000 });
      hookLog({ event: 'task-started', issue: key, output: (stdout || stderr).trim().slice(0, 300) });
      return { id: c.id, ok: true, output: (stdout || stderr).trim().slice(0, 500) };
    }
    throw new Error(`неизвестная команда ${c.kind}`);
  } catch (e) {
    hookLog({ event: 'command-failed', id: c.id, kind: c.kind, error: e.message });
    return { id: c.id, ok: false, error: e.message };
  }
}

const SECRET_RES = [
  [/((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z_]*["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"'&,;}]+)/gi, '$1***'],
  [/(Bearer\s+)[\w.~+/=-]{8,}/g, '$1***'],
  [/(\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1***@'],
  [/(\s-p)(?=\S)[^\s-]\S*/g, '$1***'], // mysql -pPASSWORD
  [/\b(?:sk-[\w-]{16,}|gh[pousr]_\w{20,}|glpat-[\w-]{16,}|xox[abp]-[\w-]{10,}|AKIA[0-9A-Z]{16}|y0_[\w-]{20,})/g, '***'],
];
const mask = s => SECRET_RES.reduce((acc, [re, to]) => acc.replace(re, to), String(s));
const maskDeep = v => (typeof v === 'string' ? mask(v) : Array.isArray(v) ? v.map(maskDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)])) : v);

function loadSyncConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf8'));
    return c.url && c.secret ? c : null;
  } catch { return null; }
}

async function syncTick() {
  const cfg = loadSyncConfig();
  syncStatus.enabled = !!cfg;
  if (!cfg) return SYNC_IDLE_MS;
  const { sessions } = await sessionsPayload();
  const { pending, recent } = requestsPayload();
  const byId = new Map(sessions.map(s => [s.sessionId, s]));
  const snapshot = await Promise.all(sessions.map(async s => ({
    id: s.sessionId, name: s.title || s.claudeName || s.sessionId.slice(0, 8), project: s.project || '',
    status: s.requests?.length ? 'waiting' : ['busy', 'waiting'].includes(s.status) ? s.status : 'idle',
    lastAssistant: s.lastAssistant ? mask(s.lastAssistant.slice(0, 700)) : undefined,
    taskKey: s.taskKey || null,
    permissionMode: s.permissionMode || null,
    waitingFor: s.waitingFor || null,
    tasks: taskSnapshot(s, await notesForSession(s.sessionId, s.taskKey)),
    updatedAt: new Date(s.lastActivity || Date.now()).toISOString(),
  })));
  // Снимок — только когда изменился (и раз в 5 мин); между ними лёгкий опрос раз в 10 с, чтобы
  // решения и команды с телефона доходили быстро. При ожидающих запросах — каждые 3 с.
  const hash = createHash('sha1').update(JSON.stringify(snapshot.map(s => ({ ...s, updatedAt: 0 })))).digest('hex');
  const now = Date.now();
  const full = hash !== syncLastHash || now - syncLastFull > SYNC_FULL_MS;
  const transcripts = [];
  for (const id of watched) {
    const items = await transcriptFor(id);
    if (!items) continue;
    const h = createHash('sha1').update(JSON.stringify(items)).digest('hex');
    if (transcriptHash.get(id) !== h) transcripts.push({ sessionId: id, items, h });
  }
  if (!full && !pending.length && !commandResults.length && !transcripts.length && now - syncLastSent < (watched.size ? SYNC_FAST_MS : SYNC_POLL_MS)) return SYNC_CHECK_MS;
  const results = commandResults.splice(0);
  const body = {
    ...(full ? { sessions: snapshot } : {}),
    commandResults: results,
    transcripts: transcripts.map(({ sessionId, items }) => ({ sessionId, items })),
    pending: pending.map(r => {
      const s = byId.get(r.sessionId);
      return {
        id: r.id, sessionId: r.sessionId, sessionName: s?.title || s?.claudeName || r.sessionId.slice(0, 8),
        project: s?.project || null, kind: r.kind, toolName: r.tool, summary: mask(shortArg(r.tool, r.input)),
        payload: r.kind === 'question' ? { questions: r.input.questions || [] } : maskDeep(r.input),
        canAlways: Array.isArray(r.suggestions) && r.suggestions.length > 0, createdAt: r.createdAt,
      };
    }),
    closed: recent.map(r => ({ id: r.id, status: r.status })),
  };
  let reply;
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`sync ${res.status}: ${(await res.text()).slice(0, 200)}`);
    reply = await res.json();
  } catch (e) {
    commandResults.unshift(...results); // итоги не дошли — отправим со следующим синком
    throw e;
  }
  syncLastSent = now;
  if (full) { syncLastHash = hash; syncLastFull = now; }
  syncStatus.lastOk = Date.now(); syncStatus.lastError = null;
  for (const t of transcripts) transcriptHash.set(t.sessionId, t.h);
  const { decisions = [], commands = [], watch = [] } = reply;
  // Новая просматриваемая сессия — отправить переписку заново, даже если она не менялась.
  for (const id of watch) if (!watched.has(id)) transcriptHash.delete(id);
  watched = new Set(watch);
  for (const { id, decision } of decisions) {
    const r = requests.get(id);
    if (r?.status === 'pending' && decision) decide(r, { ...decision, via: 'mini-app' });
  }
  for (const c of commands) commandResults.push(await runCommand(c));
  return decisions.length || pending.length || commands.length || watched.size ? SYNC_FAST_MS : SYNC_CHECK_MS;
}

// Один цикл на процесс; kickSync() — внеочередной прогон, когда пришёл новый запрос.
function scheduleSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); }
async function runSync() {
  if (syncRunning) return;
  syncRunning = true;
  let next = SYNC_RETRY_MS;
  try { next = await syncTick(); } catch (e) {
    if (syncStatus.lastError !== e.message) console.error('[sync]', e.message);
    syncStatus.lastError = e.message;
  } finally { syncRunning = false; scheduleSync(next); }
}
const kickSync = () => { if (!syncRunning) scheduleSync(300); };

// ---------- HTTP ----------

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) throw new Error('body too large'); }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(res, 200, await fsp.readFile(path.join(HERE, 'index.html')), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/api/sessions') return send(res, 200, await sessionsPayload());
    if (url.pathname === '/api/session') {
      const s = await sessionDetail(url.searchParams.get('id'), Number(url.searchParams.get('since') || 0));
      return s ? send(res, 200, s) : send(res, 404, { error: 'session not found' });
    }
    // HTTP-хуки Claude Code. PermissionRequest держим до решения из cockpit (нативный диалог
    // в VS Code при этом виден параллельно — кто ответил первым, тот и решил). Остальные
    // события только пишем в лог. Ответ `{}` = «решения нет».
    if (req.method === 'POST' && url.pathname.startsWith('/hooks/')) {
      const b = await readJson(req).catch(() => ({}));
      await hookLog({
        event: b.hook_event_name, session: b.session_id, tool: b.tool_name,
        notification: b.notification_type, message: b.message, mode: b.permission_mode,
        input: b.tool_input ? JSON.stringify(b.tool_input).slice(0, 500) : undefined,
      });
      if (b.hook_event_name !== 'PermissionRequest' || !b.session_id) return send(res, 200, {});
      return holdPermission(b, res);
    }
    if (url.pathname === '/api/requests') return send(res, 200, requestsPayload());
    if (req.method === 'POST' && url.pathname === '/api/requests/decision') {
      if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'json only' });
      const b = await readJson(req);
      const r = requests.get(b.id);
      if (!r || r.status !== 'pending') return send(res, 409, { error: 'запрос уже закрыт' });
      return send(res, 200, { ok: true, request: publicRequest(decide(r, b)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/message') {
      if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'json only' });
      const b = await readJson(req);
      const text = String(b.text || '').trim();
      if (!text || text.length > 10000) return send(res, 400, { error: 'пустой или слишком длинный текст' });
      const a = (await liveAgents()).find(x => x.sessionId === b.sessionId);
      if (!a) return send(res, 404, { error: 'session not found' });
      await sendToSession(a, text);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/meta') {
      // Защита от запросов с чужих страниц: принимаем только JSON (простая форма его не отправит).
      if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'json only' });
      const b = await readJson(req);
      if (!(await liveAgents()).some(a => a.sessionId === b.sessionId)) return send(res, 404, { error: 'session not found' });
      const m = metaOf(b.sessionId);
      if ('name' in b) {
        const name = String(b.name || '').trim().slice(0, 80);
        if (name) { m.name = name; m.nameSource = 'user'; } else { delete m.name; delete m.nameSource; }
      }
      if ('project' in b) {
        const project = String(b.project || '').trim().slice(0, 60);
        if (project) m.project = project; else delete m.project;
      }
      await saveMeta();
      return send(res, 200, { ok: true, meta: m });
    }
    if (req.method === 'POST' && url.pathname === '/api/autoname') {
      if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'json only' });
      const b = await readJson(req);
      if (b.force && b.sessionId) { const m = metaOf(b.sessionId); if (m.nameSource === 'user') { delete m.name; delete m.nameSource; } }
      const queued = await queueAutoname(b.sessionId ? [b.sessionId] : null, !!b.force);
      return send(res, 200, { queued });
    }
    if (url.pathname === '/api/repo' || url.pathname === '/api/diff') {
      const repo = url.searchParams.get('repo');
      if (!knownRepos.has(repo)) return send(res, 403, { error: 'unknown repo' });
      if (url.pathname === '/api/repo') return send(res, 200, await repoInfo(repo));
      const mode = url.searchParams.get('mode') === 'branch' ? 'branch' : 'work';
      const file = url.searchParams.get('file');
      const args = ['diff', '--no-color', '--no-ext-diff'];
      if (mode === 'branch') { const b = await detectBase(repo); if (!b) return send(res, 200, ''); args.push(`${b.ref}...HEAD`); }
      else args.push('HEAD');
      if (file) args.push('--', file);
      let diff = await git(repo, args);
      if (!diff && file && mode === 'work') {
        // Неотслеживаемый файл — показываем целиком.
        try { diff = await git(repo, ['diff', '--no-color', '--no-index', '/dev/null', file]); } catch (e) { diff = e.stdout || ''; }
      }
      if (diff.length > MAX_DIFF_BYTES) diff = diff.slice(0, MAX_DIFF_BYTES) + '\n… diff обрезан …\n';
      return send(res, 200, diff, 'text/plain; charset=utf-8');
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dev-cockpit: http://127.0.0.1:${PORT}`);
  scheduleSync(2_000);
});
