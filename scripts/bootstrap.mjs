#!/usr/bin/env node
/**
 * Notes_MJ first-run bootstrap — the single documented command:
 *
 *     npm run first-run
 *
 * It is deliberately dependency-free (Node built-ins only) so that it can run
 * in a freshly cloned repository *before* `npm install` has ever happened.
 *
 * Steps:
 *   1. verify Node / Rust / cargo are new enough
 *   2. create `.env` from `.env.example` if it is missing
 *   3. create the local data directory
 *   4. install npm dependencies if `node_modules` is absent or stale
 *   5. launch the desktop app with `tauri dev`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const E = '\u001b[';
const c = {
  reset: `${E}0m`, dim: `${E}2m`, red: `${E}31m`,
  green: `${E}32m`, yellow: `${E}33m`, cyan: `${E}36m`, bold: `${E}1m`,
};
const step = (n, msg) => console.log(`${c.cyan}${c.bold}[${n}/5]${c.reset} ${msg}`);
const ok = (msg) => console.log(`      ${c.green}ok${c.reset} ${c.dim}${msg}${c.reset}`);
const warn = (msg) => console.log(`      ${c.yellow}!${c.reset}  ${msg}`);
const die = (msg, hint) => {
  console.error(`\n${c.red}${c.bold}Nelze pokračovat:${c.reset} ${msg}`);
  if (hint) console.error(`${c.dim}${hint}${c.reset}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWindows, ...opts });
}
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: isWindows });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

console.log(`\n${c.bold}Notes_MJ${c.reset} ${c.dim}- lokální plánovač. Připravuji.${c.reset}\n`);

// 1. Prerequisites -----------------------------------------------------------
step(1, 'Kontroluji předpoklady');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 18) {
  die(`Node ${process.versions.node} je příliš starý, potřeba je alespoň 18.`, 'Stáhněte z https://nodejs.org');
}
ok(`node ${process.versions.node}`);

const cargoVersion = capture('cargo', ['--version']);
if (!cargoVersion) {
  die(
    'cargo (Rust) nebyl nalezen v PATH.',
    'Notes_MJ má backend v Rustu. Nainstalujte Rust z https://rustup.rs a otevřete terminál znovu.\n' +
    (isWindows ? 'Na Windows je navíc potřeba komponenta "Desktop development with C++" z Visual Studio Build Tools.' : ''),
  );
}
ok(cargoVersion);

if (isWindows) {
  // Tauri renders with WebView2, which ships with Windows 11 but can be absent
  // on a stripped-down image. Warn rather than fail: the installer adds it too.
  const wv = capture('reg', [
    'query',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    '/v', 'pv',
  ]);
  if (wv) ok('WebView2 je nainstalován');
  else warn('WebView2 nenalezen - stáhněte z https://developer.microsoft.com/microsoft-edge/webview2/');
}

// 2. .env --------------------------------------------------------------------
step(2, 'Připravuji konfiguraci');
const envPath = join(root, '.env');
const envExample = join(root, '.env.example');
if (existsSync(envPath)) {
  ok('.env už existuje, nechávám beze změny');
} else if (existsSync(envExample)) {
  copyFileSync(envExample, envPath);
  ok('.env vytvořen z .env.example (ignorován gitem, žádné heslo není potřeba)');
} else {
  warn('.env.example chybí - přeskakuji');
}

// 3. Data directory ----------------------------------------------------------
step(3, 'Připravuji složku s daty');
const configuredDataDir = process.env.NOTES_MJ_DATA_DIR ?? process.env.T3_DATA_DIR;
const dataDir = configuredDataDir && configuredDataDir.trim()
  ? resolve(configuredDataDir.trim())
  : join(homedir(), '.notes_mj', 'userdata');
for (const d of [dataDir, join(dataDir, 'attachments'), join(dataDir, 'backups')]) {
  mkdirSync(d, { recursive: true });
}
ok(dataDir);

// 4. Dependencies ------------------------------------------------------------
step(4, 'Instaluji npm závislosti');
const modules = join(root, 'node_modules');
const lock = join(root, 'package-lock.json');
let needsInstall = !existsSync(modules);
if (!needsInstall && existsSync(lock)) {
  try {
    needsInstall = statSync(lock).mtimeMs > statSync(modules).mtimeMs;
  } catch { needsInstall = true; }
}
if (needsInstall) {
  const useCi = existsSync(lock);
  const r = run('npm', useCi ? ['ci'] : ['install']);
  if (r.status !== 0) die('npm install selhal. Důvod najdete výše.');
  ok('závislosti nainstalovány');
} else {
  ok('node_modules je aktuální, přeskakuji');
}

// 5. Launch ------------------------------------------------------------------
step(5, 'Spouštím Notes_MJ (první spuštění kompiluje Rust backend - pár minut)');
console.log(`${c.dim}      Ukončete stiskem Ctrl+C v tomto terminálu.${c.reset}\n`);
const r = run('npm', ['run', 'app']);
process.exit(r.status ?? 0);
