// dev-cockpit — локальный наблюдатель за сессиями Claude Code (часть tg-planer, на Vercel не деплоится).
// Живой статус берётся из `claude agents --json`, переписка и изменённые файлы —
// из транскриптов ~/.claude/projects/*/<sessionId>.jsonl (читаются инкрементально),
// изменения в коде — из git тех репозиториев, которые трогала сессия.
// Свои имена и проекты сессий хранятся в data/meta.json: переименовать уже
// запущенную сессию снаружи Claude Code нельзя (только /rename внутри неё).
// Слушает только 127.0.0.1. Зависимостей нет.

import http from 'node:http';
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
      const c = o.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type !== 'tool_result') continue;
          const t = st.toolsById.get(b.tool_use_id);
          if (t) { t.result = clip(toolResultText(b.content), MAX_TOOL_IO); t.isError = !!b.is_error; t.done = ts; }
        }
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
        const item = { kind: 'tool', ts, id: b.id, name: b.name, summary, input: clip(JSON.stringify(inp, null, 2), MAX_TOOL_IO) };
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

// ---------- сборка ответа ----------

async function sessionSummary(a, cfg) {
  const s = { ...a };
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
  const projects = [...new Set([...Object.values(cfg.queues || {}), ...Object.values(cfg.repos || {}), ...sessions.map(s => s.project)])].sort();
  return { at: Date.now(), sessions, projects };
}

async function sessionDetail(id, since) {
  const cfg = loadProjectsConfig();
  const a = (await liveAgents()).find(x => x.sessionId === id);
  if (!a) return null;
  const s = await sessionSummary(a, cfg);
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
  return s;
}

// ---------- HTTP ----------

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 20000) throw new Error('body too large'); }
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

server.listen(PORT, '127.0.0.1', () => console.log(`dev-cockpit: http://127.0.0.1:${PORT}`));
