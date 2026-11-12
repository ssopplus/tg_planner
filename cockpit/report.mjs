// Отчёт «что сделано» по проекту за период — для копирования в Telegram.
//
// Два режима:
//  • data — без LLM: скрипты скиллов prod-releases (выкатки/сборки) и task-audit (статусы, работа в сессиях),
//    текст собирается здесь по шаблону. Быстро и без расхода лимита, но без пересказа сессий.
//  • llm  — фоновая сессия Claude (`claude --bg`) с готовым заданием: она сама прогоняет те же скрипты,
//    читает хвосты сессий и пишет связный текст. Отчёт приходит в чат сессии, его можно уточнять.
//
// «Только мои»: в релизах — коммиты, где автор — я (почта из git config + COCKPIT_ME_EMAILS);
// в работе по задачам — и так только мои сессии Claude Code.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const pexec = promisify(execFile);
const SKILLS = path.join(os.homedir(), '.claude', 'skills');
const RELEASES = path.join(SKILLS, 'prod-releases', 'scripts', 'releases.py');
const AUDIT = path.join(SKILLS, 'task-audit', 'scripts', 'audit.py');
const MSK_MS = 3 * 3600e3;
const JOB_KEEP_MS = 3600e3;

// Окружения — как в PROJECTS скрипта releases.py; short — подпись в тексте отчёта.
export const REPORT_PROJECTS = {
  REVENUERADAR: {
    label: 'Revenue Radar',
    envs: { combined: 'прод Водохода', 'aws-swan': 'AWS Swan', 'pola-rise': 'стенд Pola Rise' },
  },
  POLAERP: { label: 'Pola ERP', envs: { master: 'master' } },
  VDHWEBNEW: { label: 'Интур', envs: { intur: 'Vercel' } },
  WEBSH: { label: 'Сайты SH', envs: { web: 'сайт', cms: 'CMS' } },
};

const jobs = new Map();

const pad = n => String(n).padStart(2, '0');
const mskParts = ts => {
  const d = new Date(ts + MSK_MS);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
};
const mskDate = ts => { const p = mskParts(ts); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };
const fmt = ts => { const p = mskParts(ts); return `${pad(p.d)}.${pad(p.mo)} ${pad(p.h)}:${pad(p.mi)}`; };
// «dd.mm HH:MM» из task-audit (МСК, без года) → ms; год — от начала окна, с переходом через Новый год.
function parseAuditTime(s, fromTs) {
  const m = /^(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  const y0 = mskParts(fromTs).y;
  const at = y => Date.UTC(y, m[2] - 1, +m[1], +m[3], +m[4]) - MSK_MS;
  const t = at(y0);
  return t < fromTs - 180 * 86400e3 ? at(y0 + 1) : t;
}

async function myEmails() {
  const set = new Set((process.env.COCKPIT_ME_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  try { const { stdout } = await pexec('git', ['config', '--global', 'user.email'], { timeout: 5000 }); if (stdout.trim()) set.add(stdout.trim().toLowerCase()); } catch {}
  return set;
}

async function runPy(script, args, timeout = 420_000) {
  const env = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}` };
  try {
    const { stderr } = await pexec('python3', [script, ...args], { timeout, maxBuffer: 50e6, env });
    return { warnings: (stderr || '').split('\n').map(s => s.replace(/^⚠️\s*/, '').trim()).filter(Boolean) };
  } catch (e) {
    throw new Error(`${path.basename(script)}: ${(e.stderr || e.message || '').trim().split('\n').slice(-3).join(' ').slice(0, 400)}`);
  }
}

// ---------- режим без LLM ----------

async function buildDataReport({ project, fromTs, mine }, setStage) {
  const cfg = REPORT_PROJECTS[project];
  const now = Date.now();
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cockpit-report-'));
  const relJson = path.join(tmp, 'releases.json'), audJson = path.join(tmp, 'audit.json');
  // Сутки prod-releases начинаются в 15:00 МСК — берём сутки, в которые попадает начало окна.
  const relFrom = mskDate(fromTs - 15 * 3600e3);
  const audFrom = mskDate(fromTs - 3 * 3600e3);
  const to = mskDate(now);
  const warnings = [];
  try {
    setStage('Релизы: git, helm, Vercel, Трекер…');
    const rel = await runPy(RELEASES, ['--project', project, '--from', relFrom, '--to', to,
      ...Object.keys(cfg.envs).flatMap(e => ['--env', e]), '--json', relJson]);
    warnings.push(...rel.warnings);
    setStage('Работа по задачам: сессии и статусы…');
    let audit = { tasks: [] };
    try {
      const a = await runPy(AUDIT, ['--from', audFrom, '--to', to, '--queue', project, '--no-fetch', '--no-assigned', '--json', audJson]);
      warnings.push(...a.warnings.filter(w => !/^(Аудит|Сессий)/.test(w)));
      audit = JSON.parse(await fsp.readFile(audJson, 'utf8'));
    } catch (e) { warnings.push(`аудит не собран: ${e.message}`); }
    const releases = JSON.parse(await fsp.readFile(relJson, 'utf8'));
    return composeText({ cfg, project, fromTs, now, mine, releases, audit, emails: await myEmails(), warnings });
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function composeText({ cfg, fromTs, now, mine, releases, audit, emails, warnings }) {
  const issues = releases.issues || {};
  const auditBy = Object.fromEntries((audit.tasks || []).map(t => [t.key, t]));
  const isMine = it => emails.has(String(it.author_email || '').toLowerCase());
  const releaseLines = [];
  const tasks = new Map(); // key → { deploys: [], sessions, flags }
  const loose = [];
  const task = k => { if (!tasks.has(k)) tasks.set(k, { deploys: [], manual: false, pending: false }); return tasks.get(k); };

  for (const [ename, er] of Object.entries(releases.envs || {})) {
    for (const w of er.warnings || []) warnings.push(`${cfg.envs[ename] || ename}: ${w}`);
    const where = cfg.envs[ename] || ename;
    for (const ev of er.events || []) {
      const t = Date.parse(ev.time);
      if (!(t >= fromTs)) continue;
      const items = (ev.items || []).filter(it => (!mine || isMine(it)) && it.fate !== 'other-env');
      if (!items.length) continue;
      const keys = [...new Set(items.flatMap(it => it.keys))].sort();
      const what = er.source === 'merges' ? `влито в ${where}${ev.repo ? ` (${ev.repo})` : ''}`
        : er.manual ? `сборка ${ev.label} (${where}, выкатка вручную)`
        : er.source === 'vercel' ? `выкатка: ${where}`
        : `выкатка на ${where} (${ev.label})`;
      // Один пайплайн собирает образы сразу для нескольких окружений — склеиваем в одну строку.
      const id = `${fmt(t)}|${keys.join(',')}`;
      const same = releaseLines.find(x => x.id === id);
      if (same) { if (!same.what.includes(what)) same.what.push(what); } else releaseLines.push({ id, t, keys, what: [what] });
      for (const it of items) {
        if (!it.keys.length) {
          if (!it.merge) loose.push({ t, text: `• ${fmt(t)} ${where}: ${it.subject}` });
          continue;
        }
        for (const k of it.keys) {
          const x = task(k);
          if (it.fate === 'manual') x.manual = true;
          if (it.fate === 'pending-image') x.pending = true;
          if (it.fate !== 'manual' && !x.deploys.some(d => d.where === where)) x.deploys.push({ where, t, manual: er.manual, source: er.source });
        }
      }
    }
  }

  // Работа в сессиях: задачи, у которых сессия была активна после начала окна. Сессия, задевшая 4+ задач, —
  // обзорная (аудит, таймшит, сводка) или просто упоминает соседние ключи: за ней оставляем только задачу,
  // чей номер есть в ветке или каталоге сессии (worktree erp-261, feature/REVENUERADAR-328-…).
  const perSession = {};
  for (const a of audit.tasks || []) for (const s of a.sessions || []) perSession[s.id] = (perSession[s.id] || 0) + 1;
  const ownsTask = (s, key) => perSession[s.id] < 4
    || new RegExp(`(^|[^0-9])${key.split('-')[1]}($|[^0-9])`).test(`${s.branch || ''} ${path.basename(s.cwd || '')} ${(s.cwd || '').split('/').find(x => /-\d+$/.test(x)) || ''}`);
  for (const a of audit.tasks || []) {
    const ss = (a.sessions || []).filter(s => ownsTask(s, a.key) && (parseAuditTime(s.end, fromTs) ?? 0) >= fromTs);
    if (!ss.length && !tasks.has(a.key)) continue;
    const x = task(a.key);
    x.sessions = ss;
  }

  const head = `${cfg.label}: что сделано с ${fmt(fromTs)} по ${fmt(now)}${mine ? '' : ' (вся команда)'}`;
  const out = [head, ''];
  out.push('Релизы');
  if (releaseLines.length) out.push(...releaseLines.sort((a, b) => a.t - b.t)
    .map(x => `• ${fmt(x.t)} — ${x.what.join('; ')}: ${x.keys.length ? x.keys.join(', ') : 'без задачи'}`));
  else out.push('• выкаток не было');

  const order = [...tasks.entries()].sort((a, b) => {
    const la = Math.max(...a[1].deploys.map(d => d.t), 0), lb = Math.max(...b[1].deploys.map(d => d.t), 0);
    return (lb > 0) - (la > 0) || a[0].localeCompare(b[0], 'en', { numeric: true });
  });
  if (order.length) {
    out.push('', 'По задачам');
    for (const [k, x] of order) {
      const iss = issues[k] || {}, au = auditBy[k] || {};
      const summary = iss.summary || au.summary || '';
      const status = au.status || iss.status || '';
      const who = !mine && (iss.assignee || au.assignee) ? `, ${iss.assignee || au.assignee}` : '';
      out.push('', `• ${k}${summary ? ` «${summary}»` : ''}${status ? ` — ${status}` : ''}${who}`);
      for (const d of x.deploys.sort((a, b) => a.t - b.t)) {
        out.push(`  – ${fmt(d.t)} ${d.source === 'merges' ? `влито в ${d.where}` : d.manual ? `собрано для ${d.where}, выкатка вручную` : `выкачено: ${d.where}`}`);
      }
      if (x.manual) out.push('  – SQL/доки накатываются вручную');
      if (x.pending) out.push('  – часть коммитов ещё не в образе');
      if (x.sessions?.length) {
        const s0 = Math.min(...x.sessions.map(s => parseAuditTime(s.start, fromTs) ?? fromTs));
        const s1 = Math.max(...x.sessions.map(s => parseAuditTime(s.end, fromTs) ?? 0));
        out.push(`  – работа в сессиях: ${fmt(Math.max(s0, fromTs))} → ${fmt(s1)}${x.sessions.length > 1 ? ` (${x.sessions.length})` : ''}`);
      }
      for (const f of au.flags || []) out.push(`  – ⚠ ${f}`);
    }
  }
  if (loose.length) {
    out.push('', 'Без задачи');
    out.push(...loose.sort((a, b) => a.t - b.t).slice(0, 30).map(x => x.text));
    if (loose.length > 30) out.push(`• … ещё ${loose.length - 30}`);
  }
  return { text: out.join('\n'), warnings: [...new Set(warnings)] };
}

// ---------- режим с LLM: фоновая сессия ----------

function llmPrompt({ project, fromTs, mine }) {
  const cfg = REPORT_PROJECTS[project];
  const envs = Object.keys(cfg.envs).join(', ');
  return [
    `Собери отчёт «что сделано» по проекту ${cfg.label} (очередь ${project}) с ${fmt(fromTs)} МСК по текущий момент.`,
    '',
    `Источники: релизы — скилл prod-releases (окружения: ${envs}), статусы и работа по задачам — скилл task-audit,`,
    'плюс сами сессии Claude Code за период (~/.claude/projects): прочитай их итоговые сообщения, чтобы понять, что реально сделано,',
    'что выкачено, что накатано вручную, какие переводы статусов и комментарии были в Трекере и какой следующий шаг.',
    'Окно начинается не с границы суток — отсекай всё, что раньше указанного времени.',
    mine
      ? 'Оставь только мою работу: задачи, где автор коммитов я или работа шла в моих сессиях. Задачи других разработчиков убери.'
      : 'Включи работу всей команды; у чужих задач указывай исполнителя.',
    '',
    'Итог — простой текст для копирования в Telegram, одним блоком кода: заголовок с периодом,',
    'раздел «Релизы» (время МСК, что выехало и куда; если выкатка ручная и подтверждена только сборка — так и скажи; ручные SQL),',
    'раздел «По задачам» (ключ, название, статус; что сделано и что дальше — по 1–3 строки),',
    'строка о переводах статусов в Трекере. После блока — коротко, что не стоит выдавать за готовое.',
    '',
    'Только чтение: ничего не пиши в Трекер, git, базы данных и vault.',
  ].join('\n');
}

// ---------- задания ----------

export function startReport({ project, from, mine = true, mode = 'data' }, { claudeBin, cwd, onLog } = {}) {
  if (!REPORT_PROJECTS[project]) throw new Error('неизвестный проект');
  const fromTs = Date.parse(from);
  if (!Number.isFinite(fromTs)) throw new Error('неверное начало периода');
  if (fromTs > Date.now()) throw new Error('начало периода в будущем');
  if (Date.now() - fromTs > 31 * 86400e3) throw new Error('период длиннее 31 дня');
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > JOB_KEEP_MS) jobs.delete(id);

  const job = { id: randomUUID(), project, fromTs, mine: !!mine, mode, status: 'running', stage: '', startedAt: Date.now() };
  jobs.set(job.id, job);
  const done = patch => { Object.assign(job, patch, { finishedAt: Date.now() }); onLog?.({ event: 'report', mode, project, status: job.status, error: job.error }); };

  if (mode === 'llm') {
    const name = `Отчёт ${REPORT_PROJECTS[project].label} с ${fmt(fromTs)}`;
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // фоновая сессия — по подписке, не по API
    job.stage = 'Запускаю фоновую сессию…';
    pexec(claudeBin || 'claude', ['--bg', '--name', name, llmPrompt(job)], { cwd: cwd || os.homedir(), env, timeout: 60_000 })
      .then(({ stdout, stderr }) => done({ status: 'done', name, output: (stdout || stderr).trim().slice(0, 500) }))
      .catch(e => done({ status: 'error', error: (e.stderr || e.message || '').trim().slice(0, 400) }));
  } else {
    buildDataReport(job, s => { job.stage = s; })
      .then(r => done({ status: 'done', ...r }))
      .catch(e => done({ status: 'error', error: e.message }));
  }
  return job;
}

export const reportJob = id => jobs.get(id) || null;
