#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// skills/run-desktop/driver.mjs
// Agent driver for the Folia Electron dev build. `serve` starts Vite (unless one already answers on
// :3000), launches Electron against an isolated profile through Playwright and accepts commands on
// 127.0.0.1; every other invocation is a client that sends one command and prints the reply.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromRepo = createRequire(path.join(REPO, 'package.json'));
const PORT = Number(process.env.FOLIA_DRIVER_PORT || 9230);
const WORK_DIR = path.join(REPO, 'test-results', 'run-desktop');
const USER_DATA = path.join(WORK_DIR, 'userdata');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(WORK_DIR, 'shots');
// electron/main.cjs loadAppEntry() hardcodes this origin when ELECTRON_DEV=true.
const DEV_ORIGIN = 'http://localhost:3000';
const LOG_LIMIT = 2000;

const USAGE = `usage:
  node skills/run-desktop/driver.mjs serve [--keep-profile] [--lang en|zh-CN|in]
  node skills/run-desktop/driver.mjs <command> [args...]

commands:
  status                      windows, current page, profile dir
  ss [name]                   screenshot of the current page -> test-results/run-desktop/shots/<name>.png
  eval <js>                   evaluate an expression in the page (promises are awaited)
  main-eval <js>              evaluate an expression in the main process; \`electron\` is in scope
  click <selector>            Playwright click on the first match
  click-text <text>           click a button by accessible name, else the first element with that text
  fill <selector> <value>     fill an input
  type <text> | press <key>   keyboard input (press takes Playwright names: ControlOrMeta+k = Cmd on macOS, Escape, Enter)
  text [selector]             innerText of the selector (default: body)
  wait <selector> [ms]        wait until the selector is visible (default 10000 ms)
  palette <query>             Ctrl+K (Cmd+K on macOS), type the query, Enter: runs the top command-palette result
  windows | page <index>      list windows / switch the page the other commands act on
  logs [n] | console [n]      last n lines of main-process output / renderer console (default 50)
  reload                      reload the current page
  quit                        close Electron (and the Vite this driver started), stop the driver`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isPortOpen = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

const pushLine = (buffer, line) => {
  buffer.push(line);
  if (buffer.length > LOG_LIMIT) buffer.splice(0, buffer.length - LOG_LIMIT);
};

const lineCollector = (buffer, file, prefix = '') => {
  let pending = '';
  return (chunk) => {
    const text = pending + chunk.toString();
    const lines = text.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      pushLine(buffer, prefix + line);
      if (file) fs.appendFileSync(file, prefix + line + '\n');
    }
  };
};

// ---------------------------------------------------------------------------------------------
// Client: one command per invocation.
// ---------------------------------------------------------------------------------------------

async function runClient(cmd, args) {
  const body = JSON.stringify({ cmd, args });
  const reply = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/cmd', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end(body);
  }).catch((error) => {
    if (error.code === 'ECONNREFUSED') {
      console.error(`driver is not running on 127.0.0.1:${PORT}; start it with: node skills/run-desktop/driver.mjs serve`);
      process.exit(2);
    }
    throw error;
  });
  if (reply.output) console.log(reply.output);
  if (!reply.ok) {
    console.error('ERROR:', reply.error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------
// Server: owns Vite (when it started it), Electron and the page the commands act on.
// ---------------------------------------------------------------------------------------------

async function startVite() {
  if (await isPortOpen(3000)) {
    console.log('vite: reusing the server already on :3000');
    return null;
  }
  const logFile = path.join(WORK_DIR, 'vite.log');
  fs.writeFileSync(logFile, '');
  const vite = spawn(process.execPath, [path.join(REPO, 'node_modules/vite/bin/vite.js'), '--port', '3000', '--strictPort'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const sink = (chunk) => fs.appendFileSync(logFile, chunk);
  vite.stdout.on('data', sink);
  vite.stderr.on('data', sink);
  for (let i = 0; i < 120; i += 1) {
    if (await isPortOpen(3000)) {
      console.log(`vite: started (pid ${vite.pid}), log ${path.relative(REPO, logFile)}`);
      return vite;
    }
    if (vite.exitCode !== null) break;
    await sleep(500);
  }
  vite.kill();
  throw new Error(`vite did not come up on :3000; see ${logFile}`);
}

async function runServer(flags) {
  if (await isPortOpen(PORT)) {
    throw new Error(`port ${PORT} is busy: a driver is already running (send "quit" first)`);
  }
  // The electron package downloads its binary on first require when npm ci --ignore-scripts
  // skipped the postinstall, so the first serve after a fresh install takes longer.
  let electronPath;
  try {
    electronPath = requireFromRepo('electron');
  } catch (error) {
    throw new Error(`Electron binary unavailable: ${error instanceof Error ? error.message : error}`);
  }
  const { _electron } = requireFromRepo('playwright-core');

  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  if (!flags.keepProfile) fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });

  const vite = await startVite();
  const mainLog = path.join(WORK_DIR, 'main.log');
  fs.writeFileSync(mainLog, '');
  const mainLines = [];
  const consoleLines = [];

  const app = await _electron.launch({
    executablePath: electronPath,
    args: [`--user-data-dir=${USER_DATA}`, REPO],
    cwd: REPO,
    env: { ...process.env, ELECTRON_DEV: 'true' },
    timeout: 90_000,
  });
  app.process().stdout.on('data', lineCollector(mainLines, mainLog));
  app.process().stderr.on('data', lineCollector(mainLines, mainLog, '[stderr] '));

  let closing = false;
  const shutdown = async (code) => {
    if (closing) return;
    closing = true;
    await app.close().catch(() => {});
    if (vite && vite.exitCode === null) vite.kill();
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(130));
  app.on('close', () => {
    if (!closing) {
      console.log('electron exited; stopping driver');
      if (vite && vite.exitCode === null) vite.kill();
      process.exit(1);
    }
  });

  // Never drive a window that writes to the real profile (saved accounts, AI keys, settings).
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  if (path.resolve(userData).toLowerCase() !== path.resolve(USER_DATA).toLowerCase()) {
    console.error(`ABORT: Electron is using ${userData}, not the isolated profile`);
    await shutdown(1);
  }

  const watchConsole = (target) => target.on('console', (msg) => pushLine(consoleLines, `[${msg.type()}] ${msg.text()}`));
  let page = null;
  for (let i = 0; i < 120 && !page; i += 1) {
    page = app.windows().find((w) => w.url().startsWith(DEV_ORIGIN)) ?? null;
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('main window never loaded ' + DEV_ORIGIN);
  watchConsole(page);
  app.on('window', watchConsole);

  // First-run gates a fresh profile would show: the ponder onboarding and the library suite picker
  // (same keys test/component/fixtures.ts seeds). They are read at startup, hence the reload.
  const version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(([v, lang]) => {
    localStorage.setItem('folia_last_seen_ponder_onboarding_version', v);
    localStorage.setItem('library_suite_prompt_seen', 'true');
    if (lang) localStorage.setItem('folia_app_language', lang);
  }, [version, flags.lang]);
  await page.reload();
  await page.waitForSelector('#root > *', { timeout: 60_000 });
  await sleep(2000);

  const resolveShot = (name) => path.join(SHOT_DIR, `${(name || `ss-${Date.now()}`).replace(/[^\w.-]+/g, '_')}.png`);
  const stringify = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const commands = {
    async status() {
      return stringify({ profile: userData, page: page.url(), windows: app.windows().map((w) => w.url()) });
    },
    async ss(args) {
      const file = resolveShot(args[0]);
      await page.screenshot({ path: file });
      return path.relative(REPO, file);
    },
    async eval(args) {
      return stringify(await page.evaluate(args.join(' ')));
    },
    async 'main-eval'(args) {
      const fn = new Function('electron', `return (async () => (${args.join(' ')}))();`);
      return stringify(await app.evaluate(fn));
    },
    async click(args) {
      await page.locator(args.join(' ')).first().click({ timeout: 10_000 });
      return 'clicked';
    },
    async 'click-text'(args) {
      const text = args.join(' ');
      const button = page.getByRole('button', { name: text, exact: true });
      const target = (await button.count()) ? button : page.getByText(text, { exact: true });
      const fallback = (await target.count()) ? target : page.getByText(text);
      await fallback.first().click({ timeout: 10_000 });
      return 'clicked';
    },
    async fill(args) {
      await page.locator(args[0]).first().fill(args.slice(1).join(' '), { timeout: 10_000 });
      return 'filled';
    },
    async type(args) {
      await page.keyboard.type(args.join(' '), { delay: 30 });
      return 'typed';
    },
    async press(args) {
      await page.keyboard.press(args[0]);
      return 'pressed';
    },
    async text(args) {
      const selector = args.join(' ') || 'body';
      return page.locator(selector).first().innerText({ timeout: 10_000 });
    },
    async wait(args) {
      await page.locator(args[0]).first().waitFor({ state: 'visible', timeout: Number(args[1]) || 10_000 });
      return 'visible';
    },
    async palette(args) {
      await page.keyboard.press('ControlOrMeta+k');
      await sleep(600);
      await page.keyboard.type(args.join(' '), { delay: 30 });
      await sleep(600);
      await page.keyboard.press('Enter');
      await sleep(1500);
      return 'ran top result';
    },
    async windows() {
      return app.windows().map((w, i) => `${i}${w === page ? '*' : ' '} ${w.url()}`).join('\n');
    },
    async page(args) {
      const next = app.windows()[Number(args[0])];
      if (!next) throw new Error('no window at index ' + args[0]);
      page = next;
      return page.url();
    },
    async logs(args) {
      return mainLines.slice(-(Number(args[0]) || 50)).join('\n');
    },
    async console(args) {
      return consoleLines.slice(-(Number(args[0]) || 50)).join('\n');
    },
    async reload() {
      await page.reload();
      await page.waitForSelector('#root > *', { timeout: 60_000 });
      return page.url();
    },
    async quit() {
      setTimeout(() => shutdown(0), 50);
      return 'bye';
    },
  };

  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', async () => {
      const send = (payload) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      try {
        const { cmd, args = [] } = JSON.parse(data || '{}');
        const handler = commands[cmd];
        if (!handler) return send({ ok: false, error: `unknown command "${cmd}"\n${USAGE}` });
        send({ ok: true, output: await handler(args) });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`profile: ${path.relative(REPO, USER_DATA)}`);
    console.log(`driver ready on 127.0.0.1:${PORT}`);
  });
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(USAGE);
} else if (cmd === 'serve') {
  const langIndex = rest.indexOf('--lang');
  runServer({ keepProfile: rest.includes('--keep-profile'), lang: langIndex >= 0 ? rest[langIndex + 1] : null })
    .catch((error) => {
      console.error('ERROR:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
} else {
  await runClient(cmd, rest);
}
