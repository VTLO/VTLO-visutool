#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   VTLO-visutool (/flow) — turn any workflow / pipeline / set of skills into a clickable 3D web app.
   Works with agy (Antigravity CLI), gemini and claude. Zero dependencies, Node >= 18.

   flow list    [--compact|--json] [--type skill,command,script,ref,pipeline]
   flow open    [--load NAME | --items a,b,c | --import FILE.md] [--mode auto|seq|par]
   flow run     (same selectors as open, headless: runs the pipeline in this terminal)
   flow url | status | stop | doctor | install | uninstall | help
   ───────────────────────────────────────────────────────────────────────────── */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';
let LANG = /^en/i.test(process.env.FLOW_LANG || '') ? 'en' : 'fr'; // français par défaut ; anglais : FLOW_LANG=en ou --lang en
const MSG = {
  en: {
    brief_head: '── PROJECT BRIEF (mandatory before choosing items and before every run) ──',
    brief_goal: 'General prompt: what is the project and the expected objective? ', brief_del: 'Expected deliverables after the run? ',
    needbrief: 'Project brief required: pass --goal "<objective>" --deliverables "<expected deliverables>" (asked at every run).',
    briefset: 'brief recorded', brief_run: (g, d) => `RUN BRIEF\n  Objective   : ${g}\n  Deliverables: ${d}`, brief_ok: 'Confirm this brief and launch? [y/N] ',
    ty_skill: 'skill', ty_command: 'command', ty_script: 'script', ty_prompt: 'prompt', ty_ref: 'document',
    plan_head: (n, m, c) => `PLAN PROPOSAL — '${n}' · mode ${m} · ${c} steps   (nothing is built until you validate)`,
    plan_next: 'Validate: flow validate   ·   adjust: flow plan … --mode seq|par   ·   drop a step: flow validate --exclude <id>   ·   cancel: flow cancel',
    why_order: 'given order', why_parallel: 'in parallel', why_context: 'context', why_after: 'after', why_stage: 'stage',
    st_plan: 'plan', st_build: 'build', st_verify: 'verify', st_ship: 'ship', st_report: 'report',
    confirm: 'Validate this plan and build the pipeline? [y/N] ', cancelled: 'plan cancelled', noplan: 'no pending plan — run: flow plan --items …',
    needval: 'Plan not validated yet. Validate in the app, run `flow validate`, or re-run with --yes.', waiting: 'waiting for your validation (in the app, or: flow validate)',
    validated: 'plan validated — pipeline built', tty: 'not a terminal: cannot ask for validation here',
    hint: 'click a node = run it · ▶ = run all · shift-click = run from there', nopipe: 'no pipeline yet — pick items in the app palette (left panel)',
    nodes: 'nodes', unresolved: 'unresolved', didyou: 'did you mean', nobrowser: '(could not open a browser automatically — open the URL above)',
    done: 'Done. Restart your CLI session, then type  /flow', engine: 'engine', removed: 'removed', running: 'running', nosrv: 'no flow server running — run: flow open',
    updated: 'updated from git', noGit: 'not a git checkout: re-download the project, then run `flow install`',
    help: (v) => `VTLO-visutool ${v} — turn any workflow / pipeline / skills into a clickable 3D web app

Easy:
  flow                          open the app (pick items in the palette)
  flow a b "npm run x"          PROPOSE a plan for these skills / scripts / files / commands; you validate it, then it is built
  flow go a b c                 same, and run it right after you validate
  flow install                  add /flow to every CLI found (claude, gemini, agy)
  flow update                   pull the latest version and reinstall

More:
  flow brief  --goal "…" --deliverables "…"   MANDATORY project brief (objective + expected deliverables): before choosing items and at EVERY run
  flow plan   [--items a,b] [--mode auto|seq|par]   propose a plan (mandatory step)  ·  flow validate [--run] [--exclude id,id]  ·  flow cancel
  flow open   [--load NAME] [--items a,b] [--import wf.md] [--mode auto|seq|par] [--name N] [--host H] [--run] [--no-open]
  flow run    [NAME | --items a,b,c] [--approve]      headless, no UI
  flow list   [--compact|--json|--desc] [--type skill,command,script,ref,pipeline]
  flow url | status | stop | doctor | uninstall | serve [--port N]
  --lang fr|en   language (auto from $LANG)

Config (optional): ~/.flow/config.json or <project>/.flow/config.json — see README.`,
  },
  fr: {
    brief_head: '── BRIEF DU PROJET (obligatoire avant de choisir des éléments et à chaque lancement) ──',
    brief_goal: "Prompt général : quel est le projet visé et l'objectif attendu ? ", brief_del: 'Quels livrables attendus après le run ? ',
    needbrief: 'Brief du projet obligatoire : ajoute --goal "<objectif>" --deliverables "<livrables attendus>" (demandé à chaque run).',
    briefset: 'brief enregistré', brief_run: (g, d) => `BRIEF DU RUN\n  Objectif  : ${g}\n  Livrables : ${d}`, brief_ok: 'Confirmer ce brief et lancer ? [o/N] ',
    ty_skill: 'compétence', ty_command: 'commande', ty_script: 'script', ty_prompt: 'consigne', ty_ref: 'document',
    plan_head: (n, m, c) => `PLAN PROPOSÉ — '${n}' · mode ${m} · ${c} étapes   (rien n'est construit avant ta validation)`,
    plan_next: 'Valider : flow validate   ·   ajuster : flow plan … --mode seq|par   ·   retirer une étape : flow validate --exclude <id>   ·   annuler : flow cancel',
    why_order: 'ordre donné', why_parallel: 'en parallèle', why_context: 'contexte', why_after: 'après', why_stage: 'étape',
    st_plan: 'planification', st_build: 'construction', st_verify: 'vérification', st_ship: 'livraison', st_report: 'rapport',
    confirm: 'Valider ce plan et construire le pipeline ? [o/N] ', cancelled: 'plan annulé', noplan: 'aucun plan en attente — lance : flow plan --items …',
    needval: "Plan pas encore validé. Valide dans l'appli, lance `flow validate`, ou relance avec --yes.", waiting: "en attente de ta validation (dans l'appli, ou : flow validate)",
    validated: 'plan validé — pipeline construit', tty: "pas de terminal : impossible de demander la validation ici",
    hint: 'clic sur un nœud = l\'exécuter · ▶ = tout lancer · maj+clic = lancer à partir de là', nopipe: 'aucun pipeline — choisis des éléments dans la palette (panneau de gauche)',
    nodes: 'étapes', unresolved: 'introuvable', didyou: 'tu voulais dire', nobrowser: '(impossible d\'ouvrir un navigateur automatiquement — ouvre l\'URL ci-dessus)',
    done: 'Terminé. Redémarre ta session CLI, puis tape  /flow', engine: 'moteur', removed: 'supprimé', running: 'exécution', nosrv: 'aucun serveur flow actif — lance : flow open',
    updated: 'mis à jour depuis git', noGit: 'pas un dépôt git : retélécharge le projet puis lance `flow install`',
    help: (v) => `VTLO-visutool ${v} — transforme n'importe quel workflow / pipeline / skills en appli web 3D cliquable

Facile :
  flow                          ouvre l'appli (choisis les éléments dans la palette)
  flow a b "npm run x"          PROPOSE un plan pour ces skills / scripts / fichiers / commandes ; tu le valides, puis il est construit
  flow go a b c                 pareil, et le lance juste après ta validation
  flow install                  ajoute /flow à chaque CLI détecté (claude, gemini, agy)
  flow update                   récupère la dernière version et réinstalle

Plus :
  flow brief  --goal "…" --deliverables "…"   brief du projet OBLIGATOIRE (objectif + livrables attendus) : avant de choisir des éléments et À CHAQUE run
  flow plan   [--items a,b] [--mode auto|seq|par]   propose un plan (étape obligatoire)  ·  flow validate [--run] [--exclude id,id]  ·  flow cancel
  flow open   [--load NOM] [--items a,b] [--import wf.md] [--mode auto|seq|par] [--name N] [--host H] [--run] [--no-open]
  flow run    [NOM | --items a,b,c] [--approve]      sans interface (headless)
  flow list   [--compact|--json|--desc] [--type skill,command,script,ref,pipeline]
  flow url | status | stop | doctor | uninstall | serve [--port N]
  --lang fr|en   langue (auto d'après $LANG)

Config (optionnelle) : ~/.flow/config.json ou <projet>/.flow/config.json — voir le README.`,
  },
};
const tr = (k, ...a) => { const v = MSG[LANG][k]; return typeof v === 'function' ? v(...a) : v; };
const NODE_TYPES = ['skill', 'command', 'script', 'prompt', 'ref'];

/* ═══════════════════════════ utils ═══════════════════════════ */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x';
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readText = (p, max = 400_000) => { try { return fs.readFileSync(p, 'utf8').slice(0, max); } catch { return ''; } };
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\r/g;
const stripAnsi = (s) => s.replace(ANSI, '');
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const clip = (s, n) => (s = String(s ?? '')).length > n ? s.slice(0, n - 1) + '…' : s;
const unq = (s) => s.replace(/^(['"])(.*)\1$/, '$2');
const rel = (cwd, p) => { const r = path.relative(cwd, p); return r && !r.startsWith('..') ? r : p.replace(HOME, '~'); };

function which(bin) {
  if (!bin) return null;
  if (bin.includes('/') || bin.includes('\\')) return exists(bin) ? bin : null;
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const e of exts) {
      const f = path.join(dir, bin + e);
      try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* next */ }
    }
  }
  return null;
}

function deepMerge(...objs) {
  const out = {};
  for (const o of objs) {
    for (const [k, v] of Object.entries(o || {})) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k] || {}, v) : v;
    }
  }
  return out;
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const km = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!km) continue;
    const k = km[1];
    const v = km[2].trim();
    if (v === '' || /^[|>][+-]?$/.test(v)) {
      const buf = [];
      let j = i + 1;
      while (j < lines.length && (/^\s+/.test(lines[j]) || lines[j] === '')) { buf.push(lines[j].trim()); j++; }
      meta[k] = buf.length && buf.every((b) => b === '' || b.startsWith('- '))
        ? buf.filter(Boolean).map((b) => unq(b.slice(2).trim()))
        : buf.join(' ').replace(/\s+/g, ' ').trim();
      i = j - 1;
    } else if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v.slice(1, -1).split(',').map((x) => unq(x.trim())).filter(Boolean);
    } else meta[k] = unq(v);
  }
  return { meta, body: m[2] };
}

function listDir(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } }
function walk(dir, { depth = 3, ext = null, max = 400 } = {}, acc = [], base = dir, d = 0) {
  if (d > depth || acc.length >= max) return acc;
  for (const e of listDir(dir)) {
    if (e.name.startsWith('.') && d > 0) continue;
    const f = path.join(dir, e.name);
    let dirLike = e.isDirectory();
    if (e.isSymbolicLink()) dirLike = isDir(f);
    if (dirLike) { if (e.name !== 'node_modules') walk(f, { depth, ext, max }, acc, base, d + 1); }
    else if (!ext || ext.some((x) => e.name.endsWith(x))) acc.push(f);
    if (acc.length >= max) break;
  }
  return acc;
}

/* ═══════════════════════════ config ═══════════════════════════ */
const DEFAULTS = {
  host: null,
  concurrency: 3,
  timeoutSec: 900,
  hosts: {
    claude: { bin: 'claude', args: ['-p', '{prompt}'], approve: ['--permission-mode', 'acceptEdits'], extra: [], pty: false, commandInvoke: 'slash' },
    gemini: { bin: 'gemini', args: ['-p', '{prompt}'], approve: ['--yolo'], extra: [], pty: false, commandInvoke: 'expand' },
    agy: { bin: 'agy', args: ['-p', '{prompt}'], approve: ['--dangerously-skip-permissions'], extra: [], pty: 'auto', commandInvoke: 'slash' },
  },
};
const loadConfig = (cwd) => deepMerge(DEFAULTS, readJson(path.join(HOME, '.flow', 'config.json'), {}), readJson(path.join(cwd, '.flow', 'config.json'), {}));

function detectHost(cfg, wanted) {
  if (wanted && cfg.hosts[wanted]) return wanted;
  if (cfg.host && cfg.hosts[cfg.host]) return cfg.host;
  if (process.env.GEMINI_CLI) return 'gemini';
  if (process.env.CLAUDECODE) return 'claude';
  for (const h of ['agy', 'claude', 'gemini']) if (which(cfg.hosts[h].bin)) return h;
  return 'claude';
}

/* ═══════════════════════════ discovery ═══════════════════════════ */
function skillRoots(cwd) {
  return [
    ['claude', path.join(cwd, '.claude/skills')], ['claude', path.join(HOME, '.claude/skills')],
    ['gemini', path.join(cwd, '.gemini/skills')], ['gemini', path.join(HOME, '.gemini/skills')],
    ['agy', path.join(cwd, '.agents/skills')], ['agy', path.join(cwd, '.agent/skills')],
    ['agy', path.join(HOME, '.agents/skills')], ['agy', path.join(HOME, '.gemini/antigravity/skills')],
    ['agy', path.join(HOME, '.gemini/config/skills')],
  ];
}
const workflowRoots = (cwd) => [
  path.join(cwd, '.agents/workflows'), path.join(cwd, '.agent/workflows'),
  path.join(HOME, '.gemini/antigravity/global_workflows'), path.join(HOME, '.gemini/config/workflows'),
  path.join(HOME, '.agents/workflows'), path.join(HOME, '.agent/workflows'),
];

function asList(v) { return Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(/[,\s]+/).filter(Boolean) : []; }

function scanItems(cwd) {
  const items = new Map();
  const add = (it) => {
    const key = `${it.type}:${it.name}`;
    const cur = items.get(key);
    if (cur) { cur.hosts = [...new Set([...cur.hosts, ...(it.hosts || [])])]; cur.paths.push(...(it.paths || [])); if (!cur.desc) cur.desc = it.desc; return; }
    items.set(key, { key, hosts: [], paths: [], desc: '', ...it });
  };

  // skills
  const skillFiles = [];
  for (const [host, dir] of skillRoots(cwd)) {
    for (const e of listDir(dir)) {
      const f = path.join(dir, e.name, 'SKILL.md');
      if (exists(f)) skillFiles.push([host, f, e.name]);
    }
  }
  for (const f of walk(path.join(HOME, '.claude/plugins'), { depth: 6, ext: ['SKILL.md'], max: 300 })) {
    skillFiles.push(['claude', f, path.basename(path.dirname(f))]);
  }
  for (const [host, f, dirName] of skillFiles) {
    const { meta } = frontmatter(readText(f, 20_000));
    const name = String(meta.name || dirName);
    if (name === 'flow') continue;
    add({ type: 'skill', name, desc: String(meta.description || ''), hosts: [host], paths: [f], deps: asList(meta.after || meta.needs || meta.requires || meta.depends) });
  }

  // commands
  const cmdDirs = [['claude', path.join(cwd, '.claude/commands'), '.md'], ['claude', path.join(HOME, '.claude/commands'), '.md'],
    ['gemini', path.join(cwd, '.gemini/commands'), '.toml'], ['gemini', path.join(HOME, '.gemini/commands'), '.toml']];
  for (const [host, dir, ext] of cmdDirs) {
    for (const f of walk(dir, { depth: 3, ext: [ext], max: 300 })) {
      const name = path.relative(dir, f).slice(0, -ext.length).split(path.sep).join(':');
      if (name === 'flow') continue;
      const text = readText(f, 20_000);
      let desc = '';
      if (ext === '.md') { const fm = frontmatter(text); desc = String(fm.meta.description || fm.body.split('\n').find((l) => l.trim()) || ''); }
      else { const m = /^description\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/m.exec(text); desc = m ? (m[1] ?? m[2]) : ''; }
      add({ type: 'command', name, desc, hosts: [host], paths: [f] });
    }
  }

  // scripts
  const pkg = readJson(path.join(cwd, 'package.json'));
  if (pkg?.scripts) {
    const pm = exists(path.join(cwd, 'pnpm-lock.yaml')) ? 'pnpm run' : exists(path.join(cwd, 'yarn.lock')) ? 'yarn' : (exists(path.join(cwd, 'bun.lockb')) || exists(path.join(cwd, 'bun.lock'))) ? 'bun run' : 'npm run';
    for (const [k, v] of Object.entries(pkg.scripts)) add({ type: 'script', name: `npm:${k}`, desc: String(v), command: `${pm} ${k}`, hosts: [] });
  }
  const mk = readText(path.join(cwd, 'Makefile'));
  for (const m of mk.matchAll(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/gm)) add({ type: 'script', name: `make:${m[1]}`, desc: 'Makefile target', command: `make ${m[1]}`, hosts: [] });
  for (const e of listDir(path.join(cwd, 'scripts'))) {
    const runner = { '.sh': 'bash', '.py': 'python3', '.mjs': 'node', '.js': 'node', '.ts': 'npx tsx' }[path.extname(e.name)];
    if (runner && e.isFile()) add({ type: 'script', name: `sh:scripts/${e.name}`, desc: 'script', command: `${runner} scripts/${e.name}`, hosts: [] });
  }

  // refs
  const refFiles = ['README.md', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md'].map((n) => path.join(cwd, n)).filter(exists);
  refFiles.push(...walk(path.join(cwd, 'docs'), { depth: 3, ext: ['.md'], max: 40 }), ...walk(path.join(cwd, '.flow/refs'), { depth: 2, max: 40 }));
  for (const f of refFiles) {
    const first = readText(f, 600).split('\n').find((l) => l.trim()) || '';
    add({ type: 'ref', name: rel(cwd, f), desc: first.replace(/^#+\s*/, ''), path: f, hosts: [] });
  }

  // pipelines (native json + agy workflow markdown)
  const pipelines = [];
  for (const dir of [path.join(cwd, '.flow/pipelines'), path.join(HOME, '.flow/pipelines')]) {
    for (const e of listDir(dir)) {
      if (!e.name.endsWith('.json')) continue;
      const p = readJson(path.join(dir, e.name));
      if (p?.nodes) pipelines.push({ key: `pipeline:${p.name || e.name}`, type: 'pipeline', name: p.name || e.name.replace(/\.json$/, ''), nodes: p.nodes.length, source: 'flow', path: path.join(dir, e.name) });
    }
  }
  for (const dir of workflowRoots(cwd)) {
    for (const e of listDir(dir)) {
      if (!e.name.endsWith('.md')) continue;
      const name = e.name.slice(0, -3);
      if (name === 'flow' || pipelines.some((p) => p.name === name)) continue;
      pipelines.push({ key: `pipeline:${name}`, type: 'pipeline', name, nodes: 0, source: 'workflow', path: path.join(dir, e.name) });
    }
  }
  return { items: [...items.values()], pipelines };
}

/* ═══════════════════════════ workflow markdown → pipeline ═══════════════════════════ */
function parseWorkflowMd(text, name, items) {
  const { meta, body } = frontmatter(text);
  const known = new Map(items.filter((i) => ['skill', 'command'].includes(i.type)).map((i) => [i.name.toLowerCase(), i]));
  const steps = [];
  let cur = null;
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const sm = !fence && (/^\s{0,3}(\d+)[.)]\s+(.*)$/.exec(line) || /^#{2,4}\s+(?:Step\s*)?(\d+)?[:.)-]?\s*(.+)$/i.exec(line));
    if (sm) { cur = { title: (sm[2] || '').trim(), lines: [] }; steps.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  const nodes = [];
  const used = new Set();
  const uid = (b) => { let id = slug(b), n = 2; while (used.has(id)) id = `${slug(b)}-${n++}`; used.add(id); return id; };
  for (const st of steps) {
    const whole = [st.title, ...st.lines].join('\n');
    const fences = [...whole.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1].replace(/^\/\/\s*turbo.*$/gm, '').trim()).filter(Boolean);
    const prose = whole.replace(/```[\s\S]*?```/g, ' ');
    let ref = null;
    for (const m of prose.matchAll(/(?:^|[\s(`])\/([a-z0-9][\w:-]*)/gi)) { if (known.has(m[1].toLowerCase())) { ref = known.get(m[1].toLowerCase()); break; } }
    if (!ref) for (const [n, it] of known) { if (n.length > 3 && new RegExp(`\\b${n.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(prose)) { ref = it; break; } }
    const label = clip(st.title.replace(/[*`_]/g, '').replace(/^\W+/, '') || 'step', 42);
    if (ref) {
      nodes.push({ id: uid(ref.name), type: ref.type, name: ref.name, label: ref.name, desc: clip(st.title, 120), needs: [], path: ref.paths?.[0] });
    } else if (fences.length) {
      nodes.push({ id: uid(label), type: 'script', name: label, label, desc: clip(st.title, 120), needs: [], command: fences.join('\n') });
    } else {
      nodes.push({ id: uid(label), type: 'prompt', name: label, label, desc: '', needs: [], prompt: whole.trim() });
    }
  }
  nodes.forEach((n, i) => { if (i) n.needs = [nodes[i - 1].id]; });
  return { name, source: 'workflow', description: String(meta.description || ''), nodes };
}

/* ═══════════════════════════ orchestration ═══════════════════════════ */
const STAGES = [
  /\b(plan|research|spec|analy[sz]e|discover|brainstorm|scope|design|architect|investigate|outline)/,
  /\b(build|implement|code|generate|scaffold|create|develop|refactor|migrate|compile|bundle|install|fix|convert)/,
  /\b(lint|format|test|check|verify|review|audit|scan|secur|validate|typecheck|qa|benchmark|e2e|coverage)/,
  /\b(deploy|release|publish|ship|package|tag|push|rollout|upload)/,
  /\b(report|notify|document|docs|summar|changelog|notes|announce|post|email|slack|write)/,
];
function stageOf(n) {
  const nm = `${n.name} ${n.label}`.toLowerCase().replace(/[:_-]/g, ' ');
  for (let i = 0; i < STAGES.length; i++) if (STAGES[i].test(nm)) return i;
  const ds = (n.desc || '').toLowerCase();
  for (let i = 0; i < STAGES.length; i++) if (STAGES[i].test(ds)) return i;
  return null;
}

function isDag(nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const n of nodes) for (const d of n.needs) if (ids.has(d)) indeg.set(n.id, indeg.get(n.id) + 1);
  const q = [...indeg].filter(([, v]) => v === 0).map(([k]) => k);
  let seen = 0;
  while (q.length) {
    const id = q.pop(); seen++;
    for (const n of nodes) if (n.needs.includes(id)) { indeg.set(n.id, indeg.get(n.id) - 1); if (indeg.get(n.id) === 0) q.push(n.id); }
  }
  return seen === nodes.length;
}

/** Wire `needs` edges. mode: auto (stage inference) | seq (given order) | par (no edges between work nodes). */
function wire(nodes, mode = 'auto') {
  const refs = nodes.filter((n) => n.type === 'ref');
  const work = nodes.filter((n) => n.type !== 'ref');
  nodes.forEach((n) => { n.needs = []; });
  const explicit = new Set();
  for (const n of work) {
    for (const d of n.deps || []) {
      const t = work.find((w) => w !== n && (w.name === d || w.id === slug(d)));
      if (t && !n.needs.includes(t.id)) { n.needs.push(t.id); explicit.add(n.id); n.why = `after:${t.name}`; }
    }
  }
  if (!isDag(nodes)) { work.forEach((n) => { n.needs = []; }); explicit.clear(); }

  if (mode === 'par') work.forEach((n) => { if (!n.why) n.why = 'parallel'; });
  if (mode === 'seq') {
    work.forEach((n, i) => { if (!explicit.has(n.id)) n.why = 'order'; if (i && !explicit.has(n.id)) n.needs.push(work[i - 1].id); });
  } else if (mode === 'auto') {
    const st = work.map(stageOf);
    if (st.every((s) => s === null)) {
      work.forEach((n, i) => { if (!explicit.has(n.id)) n.why = 'order'; if (i && !explicit.has(n.id)) n.needs.push(work[i - 1].id); });
    } else {
      // unknown stages inherit from the previous known item (else next known, else 0)
      const eff = st.slice();
      for (let i = 0; i < eff.length; i++) if (eff[i] === null) { let j = i - 1; while (j >= 0 && st[j] === null) j--; eff[i] = j >= 0 ? st[j] : (st.find((s) => s !== null) ?? 0); }
      const stages = [...new Set(eff)].sort((a, b) => a - b);
      const SN = ['plan', 'build', 'verify', 'ship', 'report'];
      work.forEach((n, i) => {
        if (explicit.has(n.id)) return;
        n.why = `stage:${SN[eff[i]]}`;
        const k = stages.indexOf(eff[i]);
        if (k === 0) return;
        const prev = stages[k - 1];
        work.forEach((p, pi) => { if (eff[pi] === prev) n.needs.push(p.id); });
      });
    }
  }
  // references feed the roots
  refs.forEach((r) => { r.why = 'context'; });
  for (const n of work) if (!n.needs.length) n.needs.push(...refs.map((r) => r.id));
  if (!work.length) refs.forEach((r, i) => { if (i) r.needs = [refs[i - 1].id]; });
  nodes.forEach((n) => { delete n.deps; });
  return nodes;
}

function layersOf(nodes) {
  const by = new Map(nodes.map((n) => [n.id, n])), d = new Map();
  const depth = (id) => { if (d.has(id)) return d.get(id); d.set(id, 0); let v = 0; for (const q of by.get(id).needs) if (by.has(q)) v = Math.max(v, depth(q) + 1); d.set(id, v); return v; };
  nodes.forEach((n) => depth(n.id));
  const out = Array.from({ length: Math.max(-1, ...d.values()) + 1 }, () => []);
  nodes.forEach((n) => out[d.get(n.id)].push(n.id));
  return out;
}

function normalizePipeline(p, fallbackName = 'pipeline') {
  const used = new Set();
  const nodes = (p.nodes || []).filter((n) => NODE_TYPES.includes(n.type)).map((n) => {
    let id = slug(n.id || n.name || n.label), k = 2;
    while (used.has(id)) id = `${slug(n.id || n.name)}-${k++}`;
    used.add(id);
    const o = { id, type: n.type, name: String(n.name || id).slice(0, 120), label: String(n.label || n.name || id).slice(0, 60), desc: String(n.desc || '').slice(0, 300), needs: [] };
    for (const k2 of ['command', 'prompt', 'path', 'url', 'args', 'invoke', 'why']) if (typeof n[k2] === 'string' && n[k2]) o[k2] = n[k2];
    o._needs = Array.isArray(n.needs) ? n.needs.map(String) : [];
    if (Array.isArray(n.deps)) o.deps = n.deps;
    return o;
  });
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) { n.needs = n._needs.filter((d) => ids.has(d) && d !== n.id); delete n._needs; }
  if (!isDag(nodes)) throw new Error('pipeline contains a cycle');
  return { name: slug(p.name || fallbackName), host: p.host || null, source: p.source || 'manual', description: p.description || '', created: p.created || Date.now(), nodes };
}

/* ═══════════════════════════ prompts & command specs ═══════════════════════════ */
function expandCommand(node, hostName) {
  const text = readText(node.path || '', 60_000);
  if (!text) return null;
  const args = node.args || '';
  if (node.path.endsWith('.toml')) {
    const m = /^prompt\s*=\s*"""([\s\S]*?)"""/m.exec(text) || /^prompt\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(text);
    if (!m) return null;
    return m[1].replace(/\{\{args\}\}/g, args).replace(/!\{[^}]*\}/g, '(shell output omitted)').replace(/@\{([^}]*)\}/g, 'the file $1').trim();
  }
  const { body } = frontmatter(text);
  const parts = args.split(/\s+/);
  return body.replace(/\$ARGUMENTS/g, args).replace(/\$(\d)/g, (_, d) => parts[+d - 1] ?? '').replace(/^!`[^`]*`$/gm, '(shell output omitted)').trim();
}

function ancestors(pipeline, id, pick) {
  const by = new Map(pipeline.nodes.map((n) => [n.id, n]));
  const out = [], seen = new Set();
  const go = (i) => { for (const d of by.get(i)?.needs || []) { if (seen.has(d)) continue; seen.add(d); go(d); const n = by.get(d); if (n && pick(n)) out.push(n); } };
  go(id);
  return out;
}

function nodePrompt(node, hostCfg, pipeline, outFiles, brief) {
  const args = node.args ? String(node.args) : '';
  let prompt = node.prompt;
  let withContext = true;
  if (!prompt) {
    if (node.type === 'skill') prompt = `Use the "${node.name}" skill${args ? ` (arguments: ${args})` : ''}. Carry out what it describes for this project, then summarize the outcome in a few lines.`;
    else if (node.type === 'command') {
      const mode = node.invoke || hostCfg.commandInvoke;
      const expanded = mode === 'expand' ? expandCommand(node, hostCfg.name) : null;
      if (expanded) prompt = expanded;
      else { prompt = `/${node.name}${args ? ' ' + args : ''}`; withContext = false; }
    } else prompt = node.label;
  }
  if (withContext && pipeline) {
    const refs = ancestors(pipeline, node.id, (n) => n.type === 'ref').map((n) => n.path || n.url || n.name);
    const ups = (node.needs || []).map((d) => [d, outFiles[d]]).filter(([, f]) => f && exists(f));
    if (refs.length || ups.length) {
      prompt += '\n\n[flow context]';
      if (refs.length) prompt += `\nReference documents to consult: ${refs.join(', ')}`;
      if (ups.length) prompt += `\nOutput of earlier pipeline steps (read if relevant):\n${ups.map(([d, f]) => `- ${d}: ${f}`).join('\n')}`;
    }
    if (brief) prompt += `\n\n[project brief]\nOverall project / objective: ${brief.goal}\nExpected deliverables after the run: ${brief.deliverables}\nWork toward this objective; produce the deliverables that belong to your step, and say in your final summary which ones you produced.`;
  }
  return prompt;
}

function hostArgv(hostCfg, prompt, autoApprove) {
  const args = hostCfg.args.map((a) => a.replace('{prompt}', prompt));
  if (!hostCfg.args.some((a) => a.includes('{prompt}'))) args.push(prompt);
  return [...(autoApprove ? hostCfg.approve : []), ...(hostCfg.extra || []), ...args];
}

function buildSpec(node, app) {
  const hostCfg = app.hostCfg();
  if (node.type === 'script') {
    return node.command ? { kind: 'shell', command: node.command, display: `$ ${node.command}` } : { kind: 'none', error: 'script node has no command' };
  }
  if (node.type === 'ref') return { kind: 'none', display: `ref  ${node.path || node.url || node.name}` };
  const prompt = nodePrompt(node, hostCfg, app.pipeline, app.outFiles, app.runBrief);
  const argv = hostArgv(hostCfg, prompt, app.autoApprove);
  let pty = hostCfg.pty === true || (hostCfg.pty === 'auto' && !!which('script') && !IS_WIN);
  return { kind: 'host', bin: hostCfg.bin, argv, pty, display: `$ ${hostCfg.bin} ${argv.map((a) => (/[\s"'`$]/.test(a) ? JSON.stringify(clip(a, 140)) : a)).join(' ')}` };
}

/* ═══════════════════════════ runner ═══════════════════════════ */
class Runner extends EventEmitter {
  constructor(app) {
    super();
    this.app = app;
    this.states = {};
    this.procs = new Map();
    this.batch = null;
    this.stopping = false;
  }
  busy() { return Object.values(this.states).some((s) => s.status === 'running' || s.status === 'queued'); }
  set(id, patch) { this.states[id] = { ...(this.states[id] || {}), ...patch }; this.emit('state', { node: id, ...this.states[id] }); }
  log(id, s, t) { this.emit('log', { n: id, s, t, ts: Date.now() }); }

  begin() {
    if (this.batch) return;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const dir = path.join(this.app.cwd, '.flow', 'runs', `${stamp}-${this.app.pipeline?.name || 'run'}`);
    fs.mkdirSync(dir, { recursive: true });
    this.batch = { dir, started: Date.now(), nodes: {}, brief: this.app.runBrief };
    try { const b = this.app.runBrief; if (b) fs.writeFileSync(path.join(dir, 'brief.md'), `# Brief du run\n\n## Objectif\n${b.goal}\n\n## Livrables attendus\n${b.deliverables}\n`); } catch { /* best effort */ }
    if (this.app.runBrief) { this.log('flow', 'sys', `Objectif : ${clip(this.app.runBrief.goal, 200)}`); this.log('flow', 'sys', `Livrables attendus : ${clip(this.app.runBrief.deliverables, 200)}`); }
    this.stopping = false;
    this.emit('run', { status: 'start' });
  }
  finish() {
    if (!this.batch || this.busy()) return;
    const b = this.batch; this.batch = null;
    const nodes = b.nodes;
    const ok = Object.values(nodes).every((n) => n.status === 'done' || n.status === 'skipped-ok');
    const summary = { brief: b.brief, pipeline: this.app.pipeline?.name, host: this.app.host, started: b.started, ms: Date.now() - b.started, ok, nodes, dir: b.dir };
    try { writeJson(path.join(b.dir, 'summary.json'), summary); writeJson(path.join(this.app.cwd, '.flow', 'last-run.json'), summary); } catch { /* best effort */ }
    this.log('flow', 'sys', `Livrables attendus : ${clip(b.brief?.deliverables || '', 200)} — résultats et brief : ${path.relative(this.app.cwd, b.dir)}`);
    this.emit('run', { status: 'end', ok, ms: summary.ms });
  }

  /** Run a set of node ids; respectDeps wires them as a DAG, otherwise they all start independently. */
  runSet(ids, respectDeps) {
    const p = this.app.pipeline;
    if (!p) throw new Error('no pipeline loaded');
    this.app.consumeArm(); // every launch needs a freshly confirmed project brief
    ids = ids.filter((id) => p.nodes.some((n) => n.id === id) && !['running', 'queued'].includes(this.states[id]?.status));
    if (!ids.length) return Promise.resolve();
    this.begin();
    const by = new Map(p.nodes.map((n) => [n.id, n]));
    const set = new Set(ids);
    ids.forEach((id) => this.set(id, { status: 'queued', code: null, started: null, ended: null }));
    const ok = new Set(), bad = new Set();
    return new Promise((resolve) => {
      const pump = () => {
        let running = ids.filter((id) => this.states[id]?.status === 'running').length;
        for (const id of ids) {
          if (this.states[id]?.status !== 'queued') continue;
          const deps = respectDeps ? by.get(id).needs.filter((d) => set.has(d)) : [];
          if (deps.some((d) => bad.has(d))) { this.set(id, { status: 'skipped' }); bad.add(id); this.batch && (this.batch.nodes[id] = { status: 'skipped' }); continue; }
          if (deps.every((d) => ok.has(d)) && running < this.app.cfg.concurrency) {
            running++;
            this.exec(by.get(id)).then((good) => { (good ? ok : bad).add(id); pump(); });
          }
        }
        if (!ids.some((id) => ['queued', 'running'].includes(this.states[id]?.status))) { this.finish(); resolve(); }
      };
      pump();
    });
  }
  runAll() { return this.runSet(this.app.pipeline.nodes.map((n) => n.id), true); }
  runOne(id) { return this.runSet([id], false); }
  runFrom(id) {
    const p = this.app.pipeline;
    const keep = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const n of p.nodes) if (!keep.has(n.id) && n.needs.some((d) => keep.has(d))) { keep.add(n.id); grew = true; } }
    return this.runSet(p.nodes.filter((n) => keep.has(n.id)).map((n) => n.id), true);
  }

  stop(id) {
    this.stopping = !id;
    const targets = id ? [id] : Object.keys(this.states);
    for (const t of targets) {
      const st = this.states[t]?.status;
      if (st === 'queued') this.set(t, { status: 'stopped' });
      const proc = this.procs.get(t);
      if (proc) {
        proc.stopped = true;
        try { IS_WIN ? spawn('taskkill', ['/pid', String(proc.child.pid), '/T', '/F']) : process.kill(-proc.child.pid, 'SIGTERM'); } catch { /* gone */ }
        setTimeout(() => { try { process.kill(-proc.child.pid, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
      }
    }
  }

  exec(node) {
    return new Promise((resolve) => {
      const done = (status, code, extra = {}) => {
        const now = Date.now();
        this.set(node.id, { status, code, ended: now, ...extra });
        if (this.batch) this.batch.nodes[node.id] = { status, code, ms: now - (this.states[node.id].started || now) };
        this.procs.delete(node.id);
        resolve(status === 'done');
      };
      const spec = buildSpec(node, this.app);
      this.set(node.id, { status: 'running', started: Date.now(), ended: null, code: null });
      this.log(node.id, 'sys', spec.display || node.name);
      if (spec.kind === 'none') {
        if (spec.error) { this.log(node.id, 'err', spec.error); return done('error', 1); }
        return setTimeout(() => done('done', 0), 250);
      }
      let cmd, argv, shell = false;
      if (spec.kind === 'shell') { cmd = spec.command; argv = []; shell = true; }
      else {
        const bin = which(spec.bin);
        if (!bin) {
          this.log(node.id, 'err', `'${spec.bin}' not found on PATH. Set hosts.${this.app.host}.bin in .flow/config.json or switch the host in the header.`);
          return done('error', 127);
        }
        if (spec.pty) {
          if (process.platform === 'linux') { cmd = 'script'; argv = ['-qefc', [bin, ...spec.argv].map(shq).join(' '), '/dev/null']; }
          else { cmd = 'script'; argv = ['-q', '/dev/null', bin, ...spec.argv]; }
        } else { cmd = bin; argv = spec.argv; }
      }
      const outFile = path.join(this.batch?.dir || path.join(this.app.cwd, '.flow'), `${node.id}.out.txt`);
      const out = fs.createWriteStream(outFile);
      const env = { ...process.env, FLOW_NODE: node.id, FLOW_PIPELINE: this.app.pipeline.name, FLOW_RUN_DIR: this.batch?.dir || '', FORCE_COLOR: '0', NO_COLOR: '1' };
      let child;
      try {
        child = spawn(cmd, argv, { cwd: this.app.cwd, env, shell, detached: !IS_WIN, stdio: [spec.pty ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      } catch (e) { this.log(node.id, 'err', String(e.message || e)); out.end(); return done('error', 1); }
      const proc = { child, stopped: false };
      this.procs.set(node.id, proc);
      const bufs = { out: '', err: '' };
      const feed = (kind, chunk) => {
        const text = stripAnsi(String(chunk));
        out.write(text);
        bufs[kind] += text;
        let i;
        while ((i = bufs[kind].indexOf('\n')) >= 0) { this.log(node.id, kind, bufs[kind].slice(0, i)); bufs[kind] = bufs[kind].slice(i + 1); }
      };
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (c) => feed('out', c));
      child.stderr.on('data', (c) => feed('err', c));
      const timer = setTimeout(() => { this.log(node.id, 'err', `timeout after ${this.app.cfg.timeoutSec}s — stopping`); proc.timedOut = true; this.stop(node.id); }, this.app.cfg.timeoutSec * 1000);
      let closed = false;
      const end = (code, sig) => {
        if (closed) return; closed = true;
        clearTimeout(timer);
        for (const k of ['out', 'err']) if (bufs[k]) this.log(node.id, k, bufs[k]);
        out.end();
        this.app.outFiles[node.id] = outFile;
        if (proc.stopped) return done(proc.timedOut ? 'error' : 'stopped', code ?? 143);
        done(code === 0 ? 'done' : 'error', code ?? (sig ? 1 : 0));
      };
      child.on('error', (e) => { this.log(node.id, 'err', String(e.message || e)); end(127); });
      child.on('close', (code, sig) => end(code, sig));
    });
  }
}

/* ═══════════════════════════ app (state + operations) ═══════════════════════════ */
class App extends EventEmitter {
  constructor(cwd, { host } = {}) {
    super();
    this.cwd = cwd;
    this.cfg = loadConfig(cwd);
    this.host = detectHost(this.cfg, host);
    this.pinned = !!host; // an explicitly requested host wins over the one stored in a pipeline
    this.autoApprove = false;
    this.pipeline = null;
    this.proposal = null; // pending plan awaiting validation
    { const b = readJson(path.join(cwd, '.flow', 'brief.json')); this.brief = b?.goal ? { goal: b.goal, deliverables: b.deliverables || '', confirmed: false } : null; } // prefilled, must be confirmed each session
    this.armed = false; this.runBrief = null;
    this.outFiles = {};
    this.logs = [];
    this._scan = null;
    this.runner = new Runner(this);
    this.runner.on('state', (s) => this.emit('state', s));
    this.runner.on('run', (s) => this.emit('run', s));
    this.runner.on('log', (l) => { this.logs.push(l); if (this.logs.length > 3000) this.logs.splice(0, 500); this.emit('log', l); });
    const cur = readText(path.join(cwd, '.flow', 'current')).trim();
    if (cur) { try { this.load(cur, true); } catch { /* stale pointer */ } }
  }
  hostCfg() { return { name: this.host, ...this.cfg.hosts[this.host] }; }
  scan(force) {
    if (force || !this._scan || Date.now() - this._scan.at > 4000) this._scan = { at: Date.now(), ...scanItems(this.cwd) };
    return this._scan;
  }

  setHost(h) {
    if (!this.cfg.hosts[h]) throw new Error(`unknown host ${h}`);
    this.host = h; this.pinned = true;
    if (this.pipeline) { this.pipeline.host = h; this.save(); }
    this.emit('pipeline', this.pub());
    this.emit('settings', this.settings());
  }
  setAutoApprove(v) { this.autoApprove = !!v; this.emit('pipeline', this.pub()); this.emit('settings', this.settings()); }
  settings() {
    return { host: this.host, autoApprove: this.autoApprove, hosts: Object.fromEntries(Object.entries(this.cfg.hosts).map(([k, v]) => [k, { bin: v.bin, found: !!which(v.bin) }])) };
  }

  pub() {
    if (!this.pipeline) return null;
    return { ...this.pipeline, nodes: this.pipeline.nodes.map((n) => ({ ...n, preview: buildSpec(n, this).display || '' })) };
  }
  snapshot() {
    const { items, pipelines } = this.scan();
    return {
      v: VERSION, cwd: this.cwd, ...this.settings(), pipeline: this.pub(), states: this.runner.states,
      items: items.map((i) => ({ key: i.key, type: i.type, name: i.name, desc: clip(i.desc, 140), hosts: i.hosts })),
      pipelines, logs: this.logs.slice(-500), running: this.runner.busy(), proposal: this.pubProposal(), brief: this.pubBrief(),
    };
  }

  save() {
    if (!this.pipeline) return;
    writeJson(path.join(this.cwd, '.flow', 'pipelines', `${this.pipeline.name}.json`), this.pipeline);
    fs.writeFileSync(path.join(this.cwd, '.flow', 'current'), this.pipeline.name);
  }
  set(p, { persist = true } = {}) {
    this.pipeline = p;
    this.runner.states = {};
    if (p.host && this.cfg.hosts[p.host] && !this.pinned) this.host = p.host;
    if (this.pinned) p.host = this.host;
    if (persist) this.save();
    this.emit('pipeline', this.pub());
    this.emit('settings', this.settings());
    return this.pub();
  }
  replace(p) {
    const np = normalizePipeline({ ...p, created: this.pipeline?.created, source: this.pipeline?.source }, this.pipeline?.name || 'pipeline');
    np.host = this.pipeline?.host || null;
    this.pipeline = np;
    this.save();
    this.emit('pipeline', this.pub());
    return this.pub();
  }

  load(name, silent) { return this.set(this.readPipeline(name), { persist: !silent }); }
  readPipeline(name) {
    const { items, pipelines } = this.scan(true);
    const meta = pipelines.find((p) => p.name === name || p.key === name);
    let p = null;
    if (meta?.source === 'workflow') {
      const jsonPath = path.join(this.cwd, '.flow', 'pipelines', `${slug(meta.name)}.json`);
      const fresh = exists(jsonPath) && fs.statSync(jsonPath).mtimeMs >= fs.statSync(meta.path).mtimeMs;
      p = fresh ? readJson(jsonPath) : parseWorkflowMd(readText(meta.path), meta.name, items);
    } else if (meta?.path) p = readJson(meta.path);
    else p = readJson(path.join(this.cwd, '.flow', 'pipelines', `${slug(name)}.json`));
    if (!p) throw new Error(`pipeline '${name}' not found`);
    return normalizePipeline(p, name);
  }

  /** Resolve a selector (token string or descriptor object) into a node. */
  resolveOne(sel, items, pipelines) {
    if (sel && typeof sel === 'object') {
      if (sel.key) { const it = items.find((i) => i.key === sel.key); if (it) return { node: nodeFromItem(it) }; }
      if (sel.type === 'script' && sel.command) return { node: { type: 'script', name: clip(sel.command, 40), label: clip(sel.command, 28), desc: 'custom command', command: sel.command, needs: [] } };
      if (sel.type === 'prompt' && sel.prompt) return { node: { type: 'prompt', name: clip(sel.prompt, 40), label: clip(sel.prompt, 28), desc: '', prompt: sel.prompt, needs: [] } };
      if (sel.type === 'ref' && (sel.path || sel.url)) return { node: { type: 'ref', name: sel.path || sel.url, label: path.basename(sel.path || sel.url), desc: '', path: sel.path, url: sel.url, needs: [] } };
      return { error: JSON.stringify(sel) };
    }
    const tok = String(sel).trim();
    if (!tok) return { error: '(empty)' };
    const lc = tok.toLowerCase();
    const prio = ['skill', 'command', 'script', 'ref'];
    const byName = items.filter((i) => i.key.toLowerCase() === lc || i.name.toLowerCase() === lc).sort((a, b) => prio.indexOf(a.type) - prio.indexOf(b.type));
    if (byName.length) return { node: nodeFromItem(byName[0]) };
    const pl = pipelines.find((p) => p.name.toLowerCase() === lc);
    if (pl) return { pipeline: pl.name };
    if (/^https?:\/\//i.test(tok)) return { node: { type: 'ref', name: tok, label: tok.replace(/^https?:\/\//, '').slice(0, 28), desc: 'link', url: tok, needs: [] } };
    const file = path.resolve(this.cwd, tok);
    if (!/\s/.test(tok) && exists(file) && !isDir(file)) {
      const runner = { '.sh': 'bash', '.py': 'python3', '.mjs': 'node', '.js': 'node' }[path.extname(file)];
      if (runner) return { node: { type: 'script', name: tok, label: path.basename(tok), desc: 'script', command: `${runner} ${shq(file)}`, needs: [] } };
      return { node: { type: 'ref', name: tok, label: path.basename(tok), desc: '', path: file, needs: [] } };
    }
    const fuzzy = items.filter((i) => i.name.toLowerCase().includes(lc));
    if (fuzzy.length === 1) return { node: nodeFromItem(fuzzy[0]) };
    if (/\s/.test(tok) && !/^[a-z0-9:_./-]+$/i.test(tok)) return { node: { type: 'script', name: clip(tok, 40), label: clip(tok, 28), desc: 'custom command', command: tok, needs: [] } };
    return { error: tok, suggestions: fuzzy.slice(0, 5).map((i) => i.name) };
  }

  /** Main entry used by the UI and the CLI. */
  open(spec = {}) {
    const { items, pipelines } = this.scan(true);
    if (spec.host) { if (!this.cfg.hosts[spec.host]) throw new Error(`unknown host ${spec.host}`); this.host = spec.host; this.pinned = true; }
    const unresolved = [];
    if (spec.import) {
      const f = path.resolve(this.cwd, spec.import);
      if (!exists(f)) throw new Error(`file not found: ${spec.import}`);
      return { pipeline: this.set(normalizePipeline(parseWorkflowMd(readText(f), path.basename(f).replace(/\.md$/, ''), items))), unresolved };
    }
    if (spec.load) return { pipeline: this.load(spec.load), unresolved };
    const sels = spec.items || [];
    if (!sels.length) return { pipeline: this.pub(), unresolved };
    if (sels.length === 1) { const r = this.resolveOne(sels[0], items, pipelines); if (r.pipeline) return { pipeline: this.load(r.pipeline), unresolved }; }
    // Selecting items never builds directly: a plan is PROPOSED and must be validated first.
    return { proposal: this.plan(spec), pipeline: this.pub(), unresolved };
  }

  /** Project brief: general prompt + expected objective + expected deliverables. Mandatory before items are chosen and at every run. */
  setBrief(b) {
    const goal = String(b?.goal ?? '').trim(), deliverables = String(b?.deliverables ?? '').trim();
    if (!goal || !deliverables) throw new Error('brief_required: describe the project/objective AND the expected deliverables');
    this.brief = { goal, deliverables, confirmed: true, at: Date.now() };
    try { writeJson(path.join(this.cwd, '.flow', 'brief.json'), { goal, deliverables, at: this.brief.at }); } catch { /* best effort */ }
    this.emit('brief', this.pubBrief());
    return this.pubBrief();
  }
  pubBrief() { return this.brief ? { goal: this.brief.goal, deliverables: this.brief.deliverables, confirmed: !!this.brief.confirmed } : null; }
  /** Called by every run entry point: the brief must be (re)confirmed for THIS launch. */
  armRun(b) {
    if (b) this.setBrief(b);
    if (!this.brief?.goal || !this.brief?.deliverables) throw new Error('brief_required: confirm the project brief (objective + expected deliverables) before running');
    if (!b) throw new Error('brief_required: confirm the project brief for this run');
    this.armed = true; this.runBrief = { goal: this.brief.goal, deliverables: this.brief.deliverables };
  }
  consumeArm() { if (!this.armed) throw new Error('brief_required: confirm the project brief (objective + expected deliverables) before every run'); this.armed = false; }

  plan(spec = {}) {
    if (spec.brief) this.setBrief(spec.brief);
    if (!this.brief?.confirmed) throw new Error('brief_required: describe the project first (objective + expected deliverables), then choose items');
    const { items, pipelines } = this.scan(true);
    if (spec.host) { if (!this.cfg.hosts[spec.host]) throw new Error(`unknown host ${spec.host}`); this.host = spec.host; this.pinned = true; }
    const sels = spec.items || [];
    if (!sels.length) throw new Error('no items to plan');
    const unresolved = [], nodes = [];
    for (const s of sels) {
      const r = this.resolveOne(s, items, pipelines);
      if (r.pipeline) { nodes.push(...this.readPipeline(r.pipeline).nodes.map((n) => ({ ...n }))); continue; }
      if (r.error) unresolved.push({ item: r.error, suggestions: r.suggestions || [] }); else nodes.push(r.node);
    }
    if (!nodes.length) throw new Error(`nothing matched: ${unresolved.map((u) => u.item).join(', ')}`);
    const used = new Set(spec.append && this.pipeline ? this.pipeline.nodes.map((n) => n.id) : []);
    for (const n of nodes) { let id = n.id || slug(n.name), k = 2; const base = id; while (used.has(id)) id = `${base}-${k++}`; used.add(id); n.id = id; }
    wire(nodes, spec.mode || 'auto');
    const fresh = nodes.map((n) => n.id);
    let p;
    if (spec.append && this.pipeline) {
      const sinks = this.pipeline.nodes.filter((n) => !this.pipeline.nodes.some((m) => m.needs.includes(n.id))).map((n) => n.id);
      nodes.filter((n) => !n.needs.length || n.needs.every((d) => !nodes.some((m) => m.id === d))).forEach((n) => n.needs.push(...sinks));
      p = { ...this.pipeline, nodes: [...this.pipeline.nodes, ...nodes] };
    } else {
      const base = spec.name || nodes.filter((n) => n.type !== 'ref').slice(0, 2).map((n) => n.label || n.name).join('-') + (nodes.length > 2 ? `-plus${nodes.length - 2}` : '');
      p = { name: base, host: this.host, source: `auto:${spec.mode || 'auto'}`, nodes };
    }
    this.proposal = { id: crypto.randomBytes(4).toString('hex'), mode: spec.mode || 'auto', append: !!spec.append, run: !!spec.run, sources: sels, name: spec.name || null, pipeline: normalizePipeline(p, 'pipeline'), fresh, unresolved, at: Date.now() };
    const pub = this.pubProposal();
    this.emit('proposal', pub);
    return pub;
  }
  pubProposal() {
    const pr = this.proposal;
    return pr ? { id: pr.id, mode: pr.mode, append: pr.append, run: pr.run, sources: pr.sources, name: pr.name, fresh: pr.fresh, unresolved: pr.unresolved, pipeline: { name: pr.pipeline.name, nodes: pr.pipeline.nodes }, layers: layersOf(pr.pipeline.nodes) } : null;
  }
  /** The mandatory gate: only here does a proposal become a real pipeline. `exclude` drops steps the user rejected. */
  validate({ exclude = [] } = {}) {
    const pr = this.proposal;
    if (!pr) throw new Error('no pending plan to validate');
    const p = JSON.parse(JSON.stringify(pr.pipeline));
    for (const id of exclude.filter((x) => pr.fresh.includes(x))) {
      const gone = p.nodes.find((n) => n.id === id); if (!gone) continue;
      for (const m of p.nodes) if (m.needs.includes(id)) m.needs = [...new Set([...m.needs.filter((d) => d !== id), ...gone.needs])];
      p.nodes = p.nodes.filter((n) => n.id !== id);
    }
    if (!p.nodes.length) throw new Error('the plan has no step left');
    this.proposal = null;
    this.emit('proposal', null);
    return this.set(normalizePipeline(p, 'pipeline'));
  }
  cancel() { this.proposal = null; this.emit('proposal', null); }
}

function nodeFromItem(it) {
  const n = { type: it.type, name: it.name, label: it.name.replace(/^(npm|make|sh):/, '').replace(/^scripts\//, ''), desc: it.desc || '', needs: [], deps: it.deps || [] };
  if (it.type === 'script') n.command = it.command;
  if (it.type === 'ref') n.path = it.path;
  if (it.type === 'skill' || it.type === 'command') n.path = it.paths?.[0];
  return n;
}

/* ═══════════════════════════ http server ═══════════════════════════ */
const lockFile = (cwd) => path.join(cwd, '.flow', 'server.json');

function serve(app, { port = 0 } = {}) {
  const token = crypto.randomBytes(18).toString('base64url');
  const clients = new Set();
  let actualPort = 0;
  const cookieName = () => `flow_t_${actualPort}`;
  const same = (a) => { const x = Buffer.from(String(a || '')), y = Buffer.from(token); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  // token accepted from header (UI fetches), query (?t=, EventSource + first page load) or cookie (reload fallback)
  const okToken = (req, url) => {
    const m = new RegExp(`(?:^|;\\s*)${cookieName()}=([^;]+)`).exec(req.headers.cookie || '');
    return same(req.headers['x-flow-token']) || same(url.searchParams.get('t')) || !!(m && same(m[1]));
  };
  const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const bcast = (event, data) => { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const r of clients) r.write(msg); };
  app.on('pipeline', (p) => bcast('pipeline', p));
  app.on('state', (s) => bcast('state', s));
  app.on('log', (l) => bcast('log', l));
  app.on('run', (r) => bcast('run', r));
  app.on('settings', (s) => bcast('settings', s));
  app.on('proposal', (p) => bcast('proposal', p));
  app.on('brief', (b) => bcast('brief', b));

  const readBody = (req) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 1_000_000) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('invalid json')); } });
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const host = req.headers.host || '';
      if (![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`].includes(host)) return send(res, 403, 'bad host', 'text/plain');

      if (url.pathname === '/') {
        if (!okToken(req, url)) {
          res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          return res.end('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="background:#06080b;color:#cfd9e2;font:14px/1.6 ui-monospace,monospace;padding:28px"><b style="color:#35e8f5">VTLO-visutool</b><p>Access token missing or expired.</p><p>In your terminal run <code style="color:#35e8f5">flow url</code> (or <code style="color:#35e8f5">flow open</code>) and open the full URL it prints, including <code>?t=…</code>.</p>');
        }
        const html = fs.readFileSync(path.join(HERE, 'ui.html'), 'utf8').replace('<head>', `<head><meta name="flow-token" content="${token}">`);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax` });
        return res.end(html);
      }
      if (url.pathname === '/splash.png') { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }); return res.end(fs.readFileSync(path.join(HERE, 'splash.png'))); }
      if (url.pathname === '/bg.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' }); return res.end(fs.readFileSync(path.join(HERE, 'bg.jpg'))); }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, 'not found', 'text/plain');
      if (!okToken(req, url)) return send(res, 401, { error: 'unauthorized' });
      const route = url.pathname.slice(5);

      if (req.method === 'GET') {
        if (route === 'ping') return send(res, 200, { ok: true, pid: process.pid, cwd: app.cwd });
        if (route === 'state') return send(res, 200, app.snapshot());
        if (route === 'events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          res.write(': hi\n\n');
          clients.add(res);
          const hb = setInterval(() => res.write(': hb\n\n'), 20000);
          req.on('close', () => { clearInterval(hb); clients.delete(res); });
          return;
        }
        if (route === 'ref') {
          const want = url.searchParams.get('path') || '';
          const allowed = new Set([...(app.pipeline?.nodes || []).map((n) => n.path).filter(Boolean), ...app.scan().items.flatMap((i) => i.paths || []), ...app.scan().items.map((i) => i.path).filter(Boolean)]);
          if (!allowed.has(want)) return send(res, 403, { error: 'not a known reference' });
          return send(res, 200, { path: want, text: readText(want, 60_000) });
        }
        return send(res, 404, { error: 'unknown route' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      if (req.headers['x-flow'] !== '1') return send(res, 403, { error: 'missing x-flow header' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'bad origin' });
      const body = await readBody(req);

      switch (route) {
        case 'open': return send(res, 200, app.open(body));
        case 'brief': { if (body && (body.goal !== undefined || body.deliverables !== undefined)) app.setBrief(body); return send(res, 200, { brief: app.pubBrief() }); }
        case 'plan': return send(res, 200, { proposal: app.plan(body) });
        case 'validate': { if (body.run) app.armRun(body.brief); const pub = app.validate(body); if (body.run) app.runner.runAll().catch(() => {}); return send(res, 200, { pipeline: pub }); }
        case 'cancel': app.cancel(); return send(res, 200, { cancelled: true });
        case 'pipeline': return send(res, 200, { pipeline: app.replace(body.pipeline) });
        case 'host': app.setHost(body.host); return send(res, 200, app.settings());
        case 'approve': app.setAutoApprove(body.on); return send(res, 200, app.settings());
        case 'rescan': return send(res, 200, { ok: (app.scan(true), true), ...(() => { const s = app.snapshot(); return { items: s.items, pipelines: s.pipelines }; })() });
        case 'run': {
          if (!app.pipeline) return send(res, 400, { error: 'no pipeline loaded' });
          app.armRun(body.brief);
          const r = app.runner;
          const p = body.all ? r.runAll() : body.from ? r.runFrom(String(body.from)) : body.node ? r.runOne(String(body.node)) : null;
          if (!p) return send(res, 400, { error: 'specify node, from or all' });
          p.catch(() => {});
          return send(res, 200, { started: true });
        }
        case 'stop': app.runner.stop(body.node || null); return send(res, 200, { stopped: true });
        case 'shutdown': send(res, 200, { bye: true }); setTimeout(() => process.exit(0), 100); return;
        default: return send(res, 404, { error: 'unknown route' });
      }
    } catch (e) {
      send(res, 400, { error: String(e.message || e) });
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      actualPort = server.address().port;
      writeJson(lockFile(app.cwd), { pid: process.pid, port: actualPort, token, cwd: app.cwd, started: Date.now() });
      const cleanup = () => { try { fs.unlinkSync(lockFile(app.cwd)); } catch { /* ok */ } };
      process.on('exit', cleanup);
      for (const sg of ['SIGINT', 'SIGTERM']) process.on(sg, () => { app.runner.stop(); cleanup(); process.exit(0); });
      resolve({ port: actualPort, token, url: `http://127.0.0.1:${actualPort}/?t=${token}` });
    });
  });
}

/* ═══════════════════════════ client side helpers (CLI → server) ═══════════════════════════ */
function callServer(lock, method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: lock.port, path: `/api/${route}`, method, timeout: 8000,
      headers: { 'x-flow-token': lock.token, 'x-flow': '1', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let j; try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch { j = {}; } res.statusCode < 300 ? resolve(j) : reject(new Error(j.error || `HTTP ${res.statusCode}`)); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}
async function liveLock(cwd) {
  const lock = readJson(lockFile(cwd));
  if (!lock) return null;
  try { await callServer(lock, 'GET', 'ping'); return lock; } catch { try { fs.unlinkSync(lockFile(cwd)); } catch { /* ok */ } return null; }
}
async function ensureServer(cwd, args) {
  let lock = await liveLock(cwd);
  if (lock) return lock;
  const childArgs = [fileURLToPath(import.meta.url), 'serve', '--cwd', cwd, ...(args.host ? ['--host', args.host] : [])];
  const child = spawn(process.execPath, childArgs, { detached: true, stdio: 'ignore', cwd });
  child.unref();
  for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 100)); lock = await liveLock(cwd); if (lock) return lock; }
  throw new Error('server did not start (try `flow serve` in the foreground to see errors)');
}
function openBrowser(url) {
  const tries = process.env.BROWSER ? [[process.env.BROWSER]]
    : process.platform === 'darwin' ? [['open']] : IS_WIN ? [['cmd', '/c', 'start', '']] : [['termux-open-url'], ['xdg-open'], ['sensible-browser']];
  for (const [bin, ...a] of tries) if (which(bin)) { try { spawn(bin, [...a, url], { detached: true, stdio: 'ignore' }).unref(); return bin; } catch { /* next */ } }
  return null;
}

/* ═══════════════════════════ CLI ═══════════════════════════ */
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq > 0) a[t.slice(2, eq)] = t.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !['compact', 'json', 'desc', 'no-open', 'run', 'append', 'yes', 'approve', 'headless'].includes(t.slice(2))) a[t.slice(2)] = argv[++i];
      else a[t.slice(2)] = true;
    } else a._.push(t);
  }
  return a;
}
const splitItems = (v) => (v === undefined || v === true ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));

function printList(snap, args) {
  const types = args.type ? String(args.type).split(',') : ['pipeline', 'skill', 'command', 'script', 'ref'];
  if (args.json) return console.log(JSON.stringify({ items: snap.items.filter((i) => types.includes(i.type)), pipelines: types.includes('pipeline') ? snap.pipelines : [] }, null, 2));
  const show = (name, desc) => (args.desc ? `${name}${desc ? ` — ${clip(desc, 70)}` : ''}` : name);
  const lines = [`# flow items  (host: ${snap.host}, cwd: ${snap.cwd})`];
  const section = (label, arr, max = 90) => {
    if (!arr.length) return;
    const shown = arr.slice(0, max).map((x) => show(x.name, x.desc));
    lines.push(`${label} (${arr.length}): ${shown.join(args.desc ? '\n  ' : ' · ')}${arr.length > max ? ` · … +${arr.length - max} more (flow list --type ${label.toLowerCase().replace(/s$/, '')})` : ''}`);
  };
  if (types.includes('pipeline')) section('PIPELINES', snap.pipelines.map((p) => ({ name: p.name, desc: p.nodes ? `${p.nodes} steps` : p.source })));
  for (const [label, t] of [['SKILLS', 'skill'], ['COMMANDS', 'command'], ['SCRIPTS', 'script'], ['REFS', 'ref']]) if (types.includes(t)) section(label, snap.items.filter((i) => i.type === t));
  if (lines.length === 1) lines.push('(nothing discovered — you can still pass shell commands, file paths or URLs to `flow open --items`)');
  console.log(lines.join('\n'));
}

function whyText(w) {
  if (!w) return '';
  if (w.startsWith('after:')) return `${tr('why_after')} ${w.slice(6)}`;
  if (w.startsWith('stage:')) return `${tr('why_stage')} ${tr('st_' + w.slice(6))}`;
  return tr('why_' + w) || w;
}
function renderPlan(pr) {
  const by = new Map(pr.pipeline.nodes.map((n) => [n.id, n]));
  const lines = [tr('plan_head', pr.pipeline.name, pr.mode, pr.pipeline.nodes.filter((n) => n.type !== 'ref').length)];
  pr.layers.forEach((ids, i) => ids.forEach((id, j) => {
    const n = by.get(id);
    lines.push(` ${j === 0 ? String(i + 1).padStart(2) : '  '}. ${ids.length > 1 ? '∥' : ' '} ${n.label} (${tr('ty_' + n.type)})${n.why ? `  — ${whyText(n.why)}` : ''}${pr.fresh.includes(id) ? '' : '  [existing]'}`);
  }));
  for (const u of pr.unresolved || []) lines.push(` ?  ${tr('unresolved')}: ${u.item}${u.suggestions?.length ? `  (${tr('didyou')}: ${u.suggestions.join(', ')})` : ''}`);
  lines.push(tr('plan_next'));
  return lines.join('\n');
}
function askYes(q) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(/^(y|yes|o|oui)$/i.test(a.trim())); }));
}
function askLine(q, def) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(def ? `${q}[${clip(def, 60)}] ` : q, (a) => { rl.close(); resolve(a.trim() || def || ''); }));
}
/** Brief from flags, or asked in the terminal (previous brief offered as default). Refuses in non-interactive mode. */
async function resolveBrief(args, cur) {
  const g = args.goal ?? args.objectif, d = args.deliverables ?? args.livrables;
  if (g && d && g !== true && d !== true) return { goal: String(g), deliverables: String(d) };
  if (!process.stdin.isTTY) throw new Error(tr('needbrief'));
  console.log('\n' + tr('brief_head'));
  const goal = await askLine(tr('brief_goal'), g && g !== true ? g : cur?.goal);
  const deliverables = await askLine(tr('brief_del'), d && d !== true ? d : cur?.deliverables);
  if (!goal || !deliverables) throw new Error(tr('needbrief'));
  return { goal, deliverables };
}
const currentBrief = async (lock) => (await callServer(lock, 'POST', 'brief', {}).catch(() => ({}))).brief;
function itemsFromArgs(args) { return [...splitItems(args.items), ...args._.slice(1).flatMap((x) => (/\s/.test(x) ? [x] : splitItems(x)))]; }

async function cmdPlan(args, { openUi = false } = {}) {
  const cwd = path.resolve(args.cwd || process.cwd());
  const items = itemsFromArgs(args);
  if (!items.length) throw new Error('flow plan: give the items to plan (--items a,b,c)');
  const lock = await ensureServer(cwd, args);
  const cur = await currentBrief(lock);
  const brief = (args.goal || args.objectif) ? await resolveBrief(args, cur) : cur?.confirmed ? undefined : await resolveBrief(args, cur);
  const r = await callServer(lock, 'POST', 'plan', { items, mode: args.mode || 'auto', name: args.name, host: args.host, append: !!args.append, run: !!args.run, brief });
  console.log(renderPlan(r.proposal));
  if (openUi) { const url = `http://127.0.0.1:${lock.port}/?t=${lock.token}`; console.log(`\nflow ▸ ${url}\n${tr('waiting')}`); if (!args['no-open']) openBrowser(url); }
  return { lock, proposal: r.proposal };
}
/** Run launch gate: the brief is re-confirmed at every launch (flags count as confirmation; terminal asks; otherwise refuse). */
async function runBrief(args, lock) {
  const cur = await currentBrief(lock);
  if ((args.goal || args.objectif) && (args.deliverables || args.livrables)) return resolveBrief(args, cur);
  if (process.stdin.isTTY && cur?.goal) { console.log('\n' + tr('brief_run', cur.goal, cur.deliverables)); if (await askYes(tr('brief_ok'))) return { goal: cur.goal, deliverables: cur.deliverables }; }
  return resolveBrief({ ...args, goal: undefined, deliverables: undefined }, cur);
}
async function cmdBrief(args) {
  const lock = await ensureServer(path.resolve(args.cwd || process.cwd()), args);
  const cur = await currentBrief(lock);
  if (!args.goal && !args.objectif && !args.deliverables && !args.livrables && !process.stdin.isTTY) { console.log(cur?.goal ? tr('brief_run', cur.goal, cur.deliverables) : tr('needbrief')); return; }
  const b = await resolveBrief(args, cur);
  await callServer(lock, 'POST', 'brief', b); console.log(tr('briefset'));
}
async function cmdValidate(args) {
  const cwd = path.resolve(args.cwd || process.cwd());
  const lock = await liveLock(cwd);
  if (!lock) throw new Error(tr('nosrv'));
  const brief = args.run ? await runBrief(args, lock) : undefined;
  const r = await callServer(lock, 'POST', 'validate', { exclude: splitItems(args.exclude), run: !!args.run, brief }).catch((e) => { throw new Error(/no pending/.test(e.message) ? tr('noplan') : e.message); });
  const url = `http://127.0.0.1:${lock.port}/?t=${lock.token}`;
  console.log(`${tr('validated')}: '${r.pipeline.name}'  ${r.pipeline.nodes.length} ${tr('nodes')}  ${pipelineShape(r.pipeline)}\nflow ▸ ${url}`);
  if (!args['no-open']) openBrowser(url);
  console.log(tr('hint'));
}
async function cmdCancel(args) {
  const lock = await liveLock(path.resolve(args.cwd || process.cwd()));
  if (!lock) throw new Error(tr('nosrv'));
  await callServer(lock, 'POST', 'cancel', {}); console.log(tr('cancelled'));
}
/** flow go: plan → ask in the terminal → validate + run. Never skips validation unless --yes is given explicitly. */
async function cmdGo(args) {
  const { lock } = await cmdPlan({ ...args, run: true }, { openUi: false });
  const ok = args.yes ? true : await askYes('\n' + tr('confirm'));
  if (!ok) { console.log(process.stdin.isTTY ? tr('cancelled') : tr('needval')); if (process.stdin.isTTY) await callServer(lock, 'POST', 'cancel', {}); return; }
  await cmdValidate({ ...args, run: true });
}

async function cmdOpen(args) {
  const cwd = path.resolve(args.cwd || process.cwd());
  const spec = { host: args.host, mode: args.mode || 'auto', name: args.name, append: !!args.append };
  if (args.load) spec.load = args.load;
  else if (args.import) spec.import = args.import;
  else spec.items = itemsFromArgs(args);
  if (spec.items?.length && !spec.load) { await cmdPlan(args, { openUi: true }); return; } // items → plan first, validated in the app
  const lock = await ensureServer(cwd, args);
  const r = await callServer(lock, 'POST', 'open', spec);
  if (args.run && r.pipeline) await callServer(lock, 'POST', 'run', { all: true, brief: await runBrief(args, lock) });
  const url = `http://127.0.0.1:${lock.port}/?t=${lock.token}`;
  const opened = args['no-open'] ? null : openBrowser(url);
  const p = r.pipeline;
  console.log(`flow ▸ ${url}`);
  if (p) {
    const layers = pipelineShape(p);
    console.log(`pipeline '${p.name}'  ${p.nodes.length} ${tr('nodes')}  ${layers}`);
  } else console.log(tr('nopipe'));
  for (const u of r.unresolved || []) console.log(`${tr('unresolved')}: ${u.item}${u.suggestions?.length ? `  (${tr('didyou')}: ${u.suggestions.join(', ')})` : ''}`);
  if (!opened && !args['no-open']) console.log(tr('nobrowser'));
  console.log(tr('hint'));
}
function pipelineShape(p) {
  const by = new Map(p.nodes.map((n) => [n.id, n]));
  const lay = new Map();
  const depth = (id) => { if (lay.has(id)) return lay.get(id); lay.set(id, 0); const d = Math.max(-1, ...(by.get(id).needs || []).filter((x) => by.has(x)).map(depth)) + 1; lay.set(id, d); return d; };
  p.nodes.forEach((n) => depth(n.id));
  const L = Math.max(0, ...lay.values()) + 1;
  const cols = Array.from({ length: L }, () => []);
  p.nodes.forEach((n) => cols[lay.get(n.id)].push(n.label || n.name));
  return cols.map((c) => (c.length > 1 ? `[${c.length}× ∥]` : c[0])).join(' → ');
}

async function cmdRun(args) {
  const cwd = path.resolve(args.cwd || process.cwd());
  const app = new App(cwd, { host: args.host });
  const spec = { mode: args.mode || 'auto', name: args.name, host: args.host };
  if (args.load) spec.load = args.load;
  else if (args.import) spec.import = args.import;
  else spec.items = itemsFromArgs(args);
  if (args.approve) app.autoApprove = true;
  let brief0 = null;
  if (spec.items?.length) { brief0 = await resolveBrief(args, app.brief); app.setBrief(brief0); } // brief first, then items
  let r = app.open(spec);
  if (r.proposal) { // items were selected: the plan must be validated before anything is built or run
    console.log(renderPlan(r.proposal));
    const ok = args.yes ? true : await askYes('\n' + tr('confirm'));
    if (!ok) { console.log(process.stdin.isTTY ? tr('cancelled') : tr('needval')); process.exit(process.stdin.isTTY ? 0 : 2); }
    r = { pipeline: app.validate({}) };
  }
  if (!r.pipeline) throw new Error('nothing to run');
  { // every run needs the project brief (objective + deliverables)
    const cur = app.brief; if (!args.goal && !args.objectif && process.stdin.isTTY && cur?.goal) console.log('\n' + tr('brief_run', cur.goal, cur.deliverables));
    app.armRun(brief0 || await resolveBrief(args, cur));
  }
  console.log(`flow ▸ running '${r.pipeline.name}' via ${app.host}  ${pipelineShape(r.pipeline)}`);
  app.on('log', (l) => process.stdout.write(l.s === "sys" ? `\x1b[36m[${l.n}] ${l.t}\x1b[0m\n` : l.s === "err" ? `\x1b[31m[${l.n}] ${l.t}\x1b[0m\n` : `[${l.n}] ${l.t}\n`));
  app.on('state', (s) => { if (['done', 'error', 'skipped', 'stopped'].includes(s.status)) console.log(`  ${s.status === 'done' ? '✓' : '✗'} ${s.node} ${s.status}`); });
  await app.runner.runAll();
  const bad = Object.values(app.runner.states).some((s) => s.status !== 'done');
  process.exit(bad ? 1 : 0);
}

async function cmdStatus(args) {
  const cwd = path.resolve(args.cwd || process.cwd());
  const last = readJson(path.join(cwd, '.flow', 'last-run.json'));
  const lock = await liveLock(cwd);
  if (lock) {
    const s = await callServer(lock, 'GET', 'state');
    const st = Object.entries(s.states || {});
    console.log(`server up at http://127.0.0.1:${lock.port}  pipeline: ${s.pipeline?.name || '—'}  host: ${s.host}  running: ${s.running}`);
    for (const [id, v] of st) console.log(`  ${v.status.padEnd(8)} ${id}${v.code != null && v.code !== 0 ? ` (exit ${v.code})` : ''}`);
  } else console.log('no flow server running for this directory');
  if (last) { console.log(`last run: ${last.pipeline} — ${last.ok ? 'ok' : 'failed'} in ${Math.round(last.ms / 1000)}s  (${last.dir})`); for (const [id, v] of Object.entries(last.nodes)) console.log(`  ${v.status.padEnd(8)} ${id}`); }
}

function cmdDoctor(args) {
  const cwd = path.resolve(args.cwd || process.cwd());
  const cfg = loadConfig(cwd);
  console.log(`flow ${VERSION}  node ${process.version}  ${process.platform}`);
  for (const [h, c] of Object.entries(cfg.hosts)) {
    const bin = which(c.bin);
    let ver = '';
    if (bin) { const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 }); ver = clip((r.stdout || r.stderr || '').trim().split('\n')[0], 60); }
    console.log(`  ${h.padEnd(7)} ${bin ? '✓ ' + bin + '  ' + ver : '✗ not on PATH (' + c.bin + ')'}${c.pty === 'auto' ? `   pty wrapper: ${which('script') ? 'script ✓' : 'script ✗'}` : ''}`);
  }
  const { items, pipelines } = scanItems(cwd);
  const count = (t) => items.filter((i) => i.type === t).length;
  console.log(`  discovered: ${count('skill')} skills, ${count('command')} commands, ${count('script')} scripts, ${count('ref')} refs, ${pipelines.length} pipelines`);
  console.log(`  ui: ${exists(path.join(HERE, 'ui.html')) ? '✓' : '✗ missing ui.html next to flow.mjs'}`);
}

/* ─── installer: slash command for each CLI ─── */
function agentBody(host, F) {
  const cmd = `${F} open --host ${host}`;
  return [
    'You are the launcher for **/flow**, a visual orchestrator. It shows any workflow, pipeline or group of skills / commands / scripts / references as a clickable 3D web app, and every node click runs the real command through the CLI. You only *open* the app; do not execute the pipeline steps yourself.',
    '',
    `CLI: \`${F}\``,
    '',
    'LANGUAGE: always answer the user in French, with simple everyday words (no jargon): say "étapes" for nodes, "enchaînement" for pipeline, "en même temps" for parallel, "assistant IA" for host CLI. Assume the user is a beginner.',
    '1. Read the user request (below).',
    `1b. MANDATORY PROJECT BRIEF, FIRST (before listing or choosing any item, and again before EVERY run, even a single skill or an existing pipeline): ask the user in chat (a) the general prompt of the target project and the expected objective, (b) the deliverables expected after the run. Never invent or reuse them silently: if a previous brief exists (\`${F} brief\` prints it), show it and ask to confirm or edit. Pass the answers with \`--goal \"…\" --deliverables \"…\"\` on EVERY \`plan\`, \`validate --run\`, \`open --load … --run\`, \`go\` and \`run\` command (they are refused without it).`,
    `2. It names an existing, already-orchestrated pipeline (see PIPELINES in the list) → run \`${cmd} --load "<name>"\` (shown exactly as saved or as the workflow file defines it). No plan needed.`,
    `3. It names items (skills, commands, scripts, references, file paths, URLs or raw shell commands) → FIRST propose a plan: run \`${F} plan --host ${host} --items "a,b,c" --mode auto\`. This builds NOTHING; it prints the proposed plan (steps, parallel groups, why each is placed there).`,
    '   - Use `--mode seq` when the user gave an order or says "then"; `--mode par` for "in parallel"; otherwise `auto` (infers plan → build → verify → ship → report, parallel inside a stage).',
    '4. MANDATORY VALIDATION: show the plan to the user in chat (compact: numbered steps, ∥ for parallel, one-line reason) and ask them to validate it (use the ask-the-user tool if you have one: Validate / Change order or mode / Remove a step / Cancel). Do NOT build, open or run anything before an explicit yes. If they want changes, re-run step 3 with adjusted items or mode (or pass `--exclude <step-id>` at validation), and show the new plan.',
    `5. Only after the explicit yes: run \`${F} validate --host ${host}\` (add \`--run --goal \"…\" --deliverables \"…\"\` only if they asked to run it right away). It builds the pipeline and opens the app. If they decline: \`${F} cancel\`.`,
    '6. The request is empty or vague → show the list above grouped by type (names only, compact) and ask which skills / scripts / references or which existing pipeline to use, then continue at step 3. If they prefer to pick in the app, run `' + cmd + '` (the app also requires validating the plan).',
    '7. After validation, reply in at most 3 lines: the URL, the pipeline shape it printed, and (in French) "clique sur une étape pour la lancer · « Tout lancer » lance tout · Maj+clic lance à partir d\'une étape".',
    `8. If asked later what happened, run \`${F} status\`.`,
    '',
    'Answer in the user\'s language (French if they write French). Never invent item names: use the list. Quote the --items value. Do not wait for the server (the command returns immediately).',
  ].join('\n');
}

function installTargets(scope, cwd, hosts) {
  const root = scope === 'project' ? cwd : HOME;
  const t = [];
  if (hosts.includes('claude')) t.push({ host: 'claude', file: path.join(root, '.claude/commands/flow.md'), kind: 'claude' });
  if (hosts.includes('gemini')) t.push({ host: 'gemini', file: path.join(root, '.gemini/commands/flow.toml'), kind: 'gemini' });
  if (hosts.includes('agy')) {
    const skillRoot = scope === 'project' ? path.join(cwd, '.agents/skills') : (isDir(path.join(HOME, '.agents')) && !isDir(path.join(HOME, '.gemini/antigravity')) ? path.join(HOME, '.agents/skills') : path.join(HOME, '.gemini/antigravity/skills'));
    const wfRoot = scope === 'project' ? path.join(cwd, '.agents/workflows') : path.join(HOME, '.gemini/antigravity/global_workflows');
    t.push({ host: 'agy', file: path.join(skillRoot, 'flow/SKILL.md'), kind: 'agy-skill' });
    t.push({ host: 'agy', file: path.join(wfRoot, 'flow.md'), kind: 'agy-workflow' });
  }
  return t;
}
function renderCommand(kind, F, host) {
  const body = agentBody(host, F);
  const listing = `${F} list --compact --host ${host}`;
  switch (kind) {
    case 'claude':
      return `---\ndescription: Visual orchestrator — open any workflow, pipeline or group of skills as a clickable 3D app\nargument-hint: [pipeline | skill, script, ref, …]\nallowed-tools: Bash(node:*)\n---\nAvailable items (live scan):\n!\`${listing}\`\n\n${body}\n\nUser request: $ARGUMENTS\n`;
    case 'gemini':
      return `description = "Visual orchestrator — open any workflow, pipeline or group of skills as a clickable 3D app"\nprompt = """\nAvailable items (live scan):\n!{${listing}}\n\n${body}\n\nUser request: {{args}}\n"""\n`;
    case 'agy-skill':
      return `---\nname: flow\ndescription: Visual orchestrator. Use when the user types /flow or asks to visualize, group or orchestrate workflows, pipelines, skills, scripts or references as a clickable app.\n---\n# flow\nFirst run \`${listing}\` to see the available items.\n\n${body}\n`;
    default:
      return `---\ndescription: Visual orchestrator — open any workflow, pipeline or group of skills as a clickable 3D app\n---\nFirst run \`${listing}\` to see the available items, then follow the instructions.\n\n${body}\n\nThe user request is whatever followed /flow.\n`;
  }
}
function cmdInstall(args, uninstall = false) {
  const cwd = path.resolve(args.cwd || process.cwd());
  const scope = args.scope === 'project' ? 'project' : 'user';
  const found = ['claude', 'gemini', 'agy'].filter((h) => which(loadConfig(cwd).hosts[h].bin) || isDir(path.join(HOME, h === 'claude' ? '.claude' : '.gemini')));
  const hosts = args.host === 'all' ? ['claude', 'gemini', 'agy'] : args.host ? String(args.host).split(',') : (found.length ? found : ['claude', 'gemini', 'agy']);
  const engineDir = scope === 'project' ? path.join(cwd, '.flow', 'bin') : path.join(HOME, '.flow');
  const F = `node "${path.join(engineDir, 'flow.mjs')}"`;
  if (!uninstall) {
    fs.mkdirSync(engineDir, { recursive: true });
    fs.copyFileSync(fileURLToPath(import.meta.url), path.join(engineDir, 'flow.mjs'));
    for (const a of ['ui.html', 'bg.jpg', 'splash.png']) fs.copyFileSync(path.join(HERE, a), path.join(engineDir, a));
    console.log(`${tr('engine')} → ${engineDir}`);
  }
  for (const t of installTargets(scope, cwd, hosts)) {
    if (uninstall) { try { fs.unlinkSync(t.file); console.log(`${tr('removed')} ${t.file}`); } catch { /* absent */ } continue; }
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    fs.writeFileSync(t.file, renderCommand(t.kind, F, t.host));
    console.log(`${t.host.padEnd(7)} → ${t.file}`);
  }
  if (!uninstall) console.log('\n' + tr('done'));
}

function cmdUpdate(args) {
  if (!isDir(path.join(HERE, '.git'))) { console.log(tr('noGit')); return; }
  const r = spawnSync('git', ['-C', HERE, 'pull', '--ff-only'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('git pull failed');
  console.log(tr('updated'));
  spawnSync(process.execPath, [path.join(HERE, 'flow.mjs'), 'install', ...(args.host ? ['--host', args.host] : []), ...(args.lang ? ['--lang', args.lang] : [])], { stdio: 'inherit' });
}

const KNOWN = new Set(['list', 'open', 'go', 'brief', 'plan', 'validate', 'cancel', 'run', 'status', 'doctor', 'install', 'uninstall', 'update', 'stop', 'serve', 'url', 'help']);
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.lang === 'fr' || args.lang === 'en') LANG = args.lang;
  if (args.help || args.h) args._.unshift('help');
  let cmd = args._[0];
  if (!cmd) { cmd = 'open'; args._.unshift('open'); }
  else if (!KNOWN.has(cmd)) { cmd = 'open'; args._.unshift('open'); } // `flow a b c` = open a pipeline of a, b, c
  const cwd = path.resolve(args.cwd || process.cwd());
  switch (cmd) {
    case 'list': { const app = new App(cwd, { host: args.host }); printList(app.snapshot(), args); break; }
    case 'open': await cmdOpen(args); break;
    case 'go': await cmdGo(args); break;
    case 'brief': await cmdBrief(args); break;
    case 'plan': await cmdPlan(args); break;
    case 'validate': await cmdValidate(args); break;
    case 'cancel': await cmdCancel(args); break;
    case 'run': await cmdRun(args); break;
    case 'status': await cmdStatus(args); break;
    case 'doctor': cmdDoctor(args); break;
    case 'install': cmdInstall(args); break;
    case 'uninstall': cmdInstall(args, true); break;
    case 'update': cmdUpdate(args); break;
    case 'url': { const l = await liveLock(cwd); if (!l) { console.log(tr('nosrv')); break; } const u = `http://127.0.0.1:${l.port}/?t=${l.token}`; console.log(u); if (!args['no-open']) openBrowser(u); break; }
    case 'stop': { const l = await liveLock(cwd); if (l) { await callServer(l, 'POST', 'shutdown', {}).catch(() => {}); console.log('stopped'); } else console.log(tr('nosrv')); break; }
    case 'serve': { const app = new App(cwd, { host: args.host }); const s = await serve(app, { port: Number(args.port) || 0 }); if (process.stdout.isTTY) console.log(s.url); break; }
    default: console.log(tr('help', VERSION));
  }
}
main().catch((e) => { console.error(`flow: ${e.message || e}`); process.exit(1); });
