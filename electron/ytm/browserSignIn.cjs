const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// electron/ytm/browserSignIn.cjs
// Google refuses a sign-in typed into an Electron window, so the person signs in to YouTube Music
// in a browser that is installed on the computer, started on a profile folder of our own. Two
// separate runs of that browser are used, never one:
//   openSignIn  - an ordinary window with no debugging switch at all (with one, the page can tell
//                 that the browser is driven by a program, and Google is to see a person);
//   readCookies - later, the same browser headless on the same folder, asked for the profile's
//                 cookies over the debugging pipe. It opens no page.
// Plain Node, no Electron: the trial script and the unit tests load it as it is.
//
// Secrets. A cookie value is never logged, never put into an error and never written to a file
// here. Nothing the pipe says goes into an error or a log line either; a failure carries one of
// four fixed codes. The profile folder holds the person's whole Google session (all of Google,
// not only YouTube), so `removeProfile` exists and says whether it could remove it, and
// `endLeftBrowsers` ends a browser that a run of the app left running on it.
//
// What was measured, and what was not (2026-10-08):
//   - Only Chrome on Windows was measured for "the process ends when its last window is closed".
//     Edge, Brave and Chromium are started the same way on the assumption that they behave alike.
//     So are Chrome's Beta, Dev and Canary channels and Helium (2026-10-22, none of them run):
//     they are the same Chromium. Helium is built on ungoogled-chromium; none of its patches
//     (imputnet/helium patches/series) takes out headless mode or the debugging pipe, and the
//     `--no-first-run` given here also keeps it from opening its own onboarding page in place of
//     the sign-in (patches/helium/core/onboarding-page.patch).
//   - macOS: a browser outlives its last window, so `closed` does not resolve when the window is
//     closed. The caller either tells the person to quit that browser (`closed` then resolves
//     'closed'), or offers a "done" button that calls `stop()` (`closed` resolves 'stopped') and
//     reads the cookies after it. `stop()` asks the browser to end (SIGTERM) before it forces it;
//     that the cookies are on disk by then was not measured.
//   - Windows: `stop()` ends the browser at once, without letting it save. Cookies it had not yet
//     written (it writes them every half minute or so) are lost, so there it is for cancelling,
//     and for a sign-in whose time ran out: what was written before is read then (webSignIn.cjs).
//   - Linux: a snap or flatpak browser cannot use a folder outside its sandbox. `findBrowser`
//     does not tell such a browser from another; the start is expected to end 'at-once'. The
//     caller chooses both the browser path and the folder, so it can pass others. The commands
//     of the AUR's Chrome Beta and Dev and of helium-browser-bin are scripts that put the
//     person's own flags file (chrome-beta-flags.conf, chrome-dev-flags.conf,
//     helium-browser-flags.conf) before the arguments given here and then `exec` the browser, so
//     the process keeps its id and the command line still holds `--user-data-dir`; where that
//     file names a folder too, Chromium takes the later switch, which is the one given here.
//   - 2026-10-09, `removeProfile` and `endLeftBrowsers`: on Windows only, with stand-in processes
//     (node scripts) and never a real browser; not run on macOS or Linux. A folder a process
//     held: the removal answered false after 3.8 s and 16 passes, the mark was still in the
//     folder, and nothing was deleted after the answer. Of four stand-ins, the two started on the
//     folder were ended (the argument quoted as Node quotes it, and as Chromium quotes it for its
//     helpers; the path held a space and non-ASCII characters) and the two whose command lines
//     only came close were not; listing the processes took a third of a second. Whether every
//     helper process of a real browser names the folder was not looked at: one that does not
//     ends with its browser, and the removal waits for it up to REMOVE_LIMIT_MS.

const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F';
// A browser started on a folder that a running browser holds hands the start over to that one
// and ends within a fraction of a second; so does one that cannot start. Nobody signs in and
// closes a window this fast, so a run this short is never "the person closed the window".
const AT_ONCE_MS = 2000;
// The pipe answered in about a quarter of a second when measured; a cold start on a slow disk
// takes longer.
const READ_LIMIT_MS = 15000;
// How long a browser that was asked to end is given before it is forced.
const STOP_GRACE_MS = 5000;
// The file the app puts into the sign-in folder before a browser is started on it, and takes out
// last: by it the folder is known as the app's own, also after a removal that stopped half-way.
const FOLDER_MARK = 'folia-sign-in-folder';
// One removal takes this long in all. A pass that fails is tried again after a short wait: the
// helper processes of a browser that has just ended let go of their files a moment later.
const REMOVE_LIMIT_MS = 4000;
const REMOVE_AGAIN_MS = 250;
// How long the list of processes is waited for, and how long processes that were ended are
// given to be gone.
const LIST_LIMIT_MS = 10000;
const ENDED_LIMIT_MS = 2000;
const ENDED_CHECK_MS = 100;
// Windows: the processes whose command line holds the folder, one a line as "<id> <command line>".
// The folder is read from an environment variable and is no part of this text.
const LIST_ON_WINDOWS = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process'
  + ' | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:FOLIA_SIGN_IN_FOLDER) }'
  + ' | ForEach-Object { [string]$_.ProcessId + [char]32 + $_.CommandLine }';

// In the order they are looked for: the four stable browsers, then Chrome's other channels, then
// Helium. `name` is what the log calls it. `win` is the path under a programs folder, and
// `ownOnly` marks one that Windows installs only for one person (Chrome Canary: under
// LOCALAPPDATA, never under the computer's programs folders). `mac` is the name of the
// application, which is also the name of its executable inside it; `linux` the names it goes by
// on PATH.
//
// Where the places of the later four come from (looked up 2026-10-22):
//   - Chrome Beta, Dev, Canary on Windows: Chromium's chrome/install_static/
//     google_chrome_install_modes.h gives the install suffixes " Beta", " Dev" and " SxS" to
//     Google\Chrome, and Canary "does not support system-level installs". On macOS,
//     chrome/installer/mac/signing/modification.py renames the application and its executable
//     with the channel ("Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"). Puppeteer
//     (packages/browsers/src/browser-data/chrome.ts) looks at the same places. On Linux,
//     chrome/installer/linux/common/installer.py makes the command google-chrome-<channel>,
//     where the Dev channel is called "unstable"; Google's apt repository
//     (dl.google.com/linux/chrome/deb) holds google-chrome-beta, -unstable and -canary, and the
//     AUR packages google-chrome-beta and google-chrome-dev install /usr/bin/google-chrome-beta
//     and /usr/bin/google-chrome-unstable.
//   - Helium: on Windows its installer (imputnet/helium-windows installer/helium.nsi) puts
//     imput\Helium\Application\chrome.exe under Program Files for all users or under LOCALAPPDATA
//     for one. On macOS it is Helium.app with Contents/MacOS/Helium (imputnet/helium-macos
//     sign_and_package_app.sh and dev.sh). On Linux the project's own .deb and .rpm
//     (imputnet/helium-linux package/helium-bin.spec) link /usr/bin/helium, and the AUR package
//     helium-browser-bin links /usr/bin/helium-browser. The AppImage and the archives have no
//     fixed place and are not looked for. On macOS the name is also that of an older, unrelated
//     WebKit browser (JadenGeller/Helium, archived): on a Mac with only that one it is started
//     with Chromium's switches and the sign-in fails on the wait instead of saying no browser was
//     found. Helium comes last, so this needs a Mac with none of the Chromium browsers above.
const BROWSERS = Object.freeze([
  { name: 'Chrome', win: ['Google', 'Chrome', 'Application', 'chrome.exe'], mac: 'Google Chrome', linux: ['google-chrome', 'google-chrome-stable'] },
  { name: 'Edge', win: ['Microsoft', 'Edge', 'Application', 'msedge.exe'], mac: 'Microsoft Edge', linux: ['microsoft-edge', 'microsoft-edge-stable'] },
  { name: 'Chromium', win: ['Chromium', 'Application', 'chrome.exe'], mac: 'Chromium', linux: ['chromium', 'chromium-browser'] },
  { name: 'Brave', win: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'], mac: 'Brave Browser', linux: ['brave-browser', 'brave'] },
  { name: 'Chrome Beta', win: ['Google', 'Chrome Beta', 'Application', 'chrome.exe'], mac: 'Google Chrome Beta', linux: ['google-chrome-beta'] },
  { name: 'Chrome Dev', win: ['Google', 'Chrome Dev', 'Application', 'chrome.exe'], mac: 'Google Chrome Dev', linux: ['google-chrome-unstable'] },
  { name: 'Chrome Canary', win: ['Google', 'Chrome SxS', 'Application', 'chrome.exe'], ownOnly: true, mac: 'Google Chrome Canary', linux: ['google-chrome-canary'] },
  { name: 'Helium', win: ['imput', 'Helium', 'Application', 'chrome.exe'], mac: 'Helium', linux: ['helium', 'helium-browser'] },
]);

// The requests the cookies are for go to this host and under this path.
const REQUEST_HOST = 'www.youtube.com';
const REQUEST_PATH = '/youtubei/';
const ACCOUNT_DOMAIN = '.youtube.com';

const FAILURES = Object.freeze({
  'not-started': 'The browser could not be started',
  exited: 'The browser ended before it answered',
  timeout: 'The browser did not answer in time',
  protocol: 'The browser gave an answer that could not be used',
});

// Why the cookies could not be read. The message is one of the fixed sentences above: nothing
// the browser said is in it.
class BrowserSignInError extends Error {
  constructor(code) {
    super(FAILURES[code]);
    this.name = 'BrowserSignInError';
    this.code = code;
  }
}

// Every place a supported browser is installed to on this kind of computer, best first. A browser
// is installed for the whole computer or, without administrator rights, for one person. The
// places of the whole computer come first, for all browsers: a file put under a browser's name
// into a person's own folder is not taken while any browser is installed for the computer.
// Each place is { name, file }: the browser's name for the log, and the path of its executable.
function browserPlaces({ platform = process.platform, env = process.env } = {}) {
  const under = (roots, place, browsers = BROWSERS) => browsers.flatMap(browser => roots.map(root => ({ name: browser.name, file: place(root, browser) })));
  if (platform === 'win32') {
    const place = (root, browser) => path.win32.join(root, ...browser.win);
    const shared = [...new Set([env.ProgramW6432 ?? env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean))];
    return [...under(shared, place, BROWSERS.filter(browser => !browser.ownOnly)), ...under([env.LOCALAPPDATA].filter(Boolean), place)];
  }
  if (platform === 'darwin') {
    const place = (root, browser) => path.posix.join(root, `${browser.mac}.app`, 'Contents', 'MacOS', browser.mac);
    return [...under(['/Applications'], place), ...under(env.HOME ? [path.posix.join(env.HOME, 'Applications')] : [], place)];
  }
  // A PATH entry that is not absolute names a folder under whichever folder the app was started in.
  const folders = (env.PATH ?? '').split(':').filter(folder => path.posix.isAbsolute(folder));
  return BROWSERS.flatMap(browser => browser.linux.flatMap(command => folders.map(folder => ({ name: browser.name, file: path.posix.join(folder, command) }))));
}

// The paths of `browserPlaces` alone, in the same order.
function browserCandidates(options) {
  return browserPlaces(options).map(place => place.file);
}

// Whether a command line is that of a browser started on exactly this folder: it gives the
// folder as its `--user-data-dir`, and the folder's name ends there. In quotes (the value's own,
// or the whole argument's, as Node writes one that holds a space on Windows) the name ends at
// the closing quote; bare, at the end of the line or before the next switch. A space alone is no
// end: `ps` prints no quotes, and a folder beside this one may be named "<this one> - Copy".
const startedOn = (commandLine, dir) => [...commandLine.matchAll(/("?)--user-data-dir=("?)/g)].some(match => {
  const rest = commandLine.slice(match.index + match[0].length);
  if (!rest.startsWith(dir)) return false;
  const after = rest.slice(dir.length);
  return match[1] || match[2] ? after.startsWith('"') : /^(?:\s*$|\s+--)/.test(after);
});

// One pass over the sign-in folder: everything in it but the app's mark, then the mark, then the
// folder. A pass that fails half-way so leaves a folder that is still known as the app's own.
// Nothing is tried a second time here, and every deletion has ended when this answers: Node's
// own retries are per folder level and multiply (a held file three levels down took minutes).
async function removeFolderOnce(dir) {
  // Not there, or a link in the folder's place: a link is taken away as a link, and what it
  // points to is not gone through.
  if (!(await fs.promises.lstat(dir).catch(() => null))?.isDirectory()) {
    await fs.promises.rm(dir, { force: true });
    return;
  }
  const names = await fs.promises.readdir(dir);
  // A folder known by its "Local State" alone (a version that set no mark left it) gets the mark
  // before anything is deleted: "Local State" goes with the first pass.
  if (!names.includes(FOLDER_MARK)) await fs.promises.writeFile(path.join(dir, FOLDER_MARK), '');
  const passes = await Promise.allSettled(names.filter(name => name !== FOLDER_MARK)
    .map(name => fs.promises.rm(path.join(dir, name), { recursive: true, force: true })));
  const failed = passes.find(pass => pass.status === 'rejected');
  if (failed) throw failed.reason;
  // The mark comes back when the folder then stays: something was written into it meanwhile.
  const mark = path.join(dir, FOLDER_MARK);
  await fs.promises.rm(mark, { force: true });
  await fs.promises.rmdir(dir).catch(async error => {
    await fs.promises.writeFile(mark, '').catch(() => {});
    throw error;
  });
}

// Splits the pipe's stream into its messages. A message ends with a NUL byte and arrives cut
// anywhere, also in the middle of a character of several bytes, so the cut is made on bytes.
function createPipeReader() {
  let pending = Buffer.alloc(0);
  return chunk => {
    const messages = [];
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    for (let end = pending.indexOf(0); end !== -1; end = pending.indexOf(0)) {
      messages.push(pending.toString('utf8', 0, end));
      pending = pending.subarray(end + 1);
    }
    return messages;
  };
}

const isYoutubeHost = host => host === 'youtube.com' || host.endsWith('.youtube.com');

// A cookie that a page set while it was shown inside another site is kept apart for that site,
// and a browser does not send it to YouTube's own pages.
const keptForAnotherSite = cookie => {
  const site = typeof cookie.partitionKey === 'string' ? cookie.partitionKey : cookie.partitionKey?.topLevelSite;
  return typeof site === 'string' && site !== '' && !isYoutubeHost(site.replace(/^https?:\/\//, '').toLowerCase());
};

// Of everything the profile holds, the cookies of youtube.com and its subdomains, reduced to the
// four fields the requests need.
function youtubeCookies(cookies) {
  return cookies
    .filter(cookie => cookie && typeof cookie.name === 'string' && typeof cookie.value === 'string' && typeof cookie.domain === 'string'
      && isYoutubeHost(cookie.domain.replace(/^\./, '').toLowerCase()) && !keptForAnotherSite(cookie))
    .map(cookie => ({ name: cookie.name, value: cookie.value, domain: cookie.domain, path: typeof cookie.path === 'string' ? cookie.path : '/' }));
}

// Whether a browser would send the cookie with a request to www.youtube.com/youtubei/. A domain
// with a leading dot covers its subdomains; one without is for that host alone.
const sentWithRequests = cookie => {
  const domain = cookie.domain.toLowerCase();
  const folder = cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`;
  return (domain.startsWith('.') ? `.${REQUEST_HOST}`.endsWith(domain) : domain === REQUEST_HOST) && REQUEST_PATH.startsWith(folder);
};

// One Cookie header for requests to www.youtube.com. The library that makes the requests takes
// the first cookie of a name it finds, so each name is there once; of two, the account's own
// (domain .youtube.com) is the one kept.
function cookieHeaderOf(cookies) {
  const chosen = new Map();
  for (const cookie of cookies) {
    if (!cookie.name || !sentWithRequests(cookie)) continue;
    const held = chosen.get(cookie.name);
    if (!held || (held.domain !== ACCOUNT_DOMAIN && cookie.domain === ACCOUNT_DOMAIN)) chosen.set(cookie.name, cookie);
  }
  return [...chosen.values()].map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

// The requests are signed with SAPISID; the library sends any cookie string as "signed in", so
// this is the test.
const isSignedIn = cookies => cookies.some(cookie => cookie.name === 'SAPISID' && cookie.domain === ACCOUNT_DOMAIN && cookie.value !== '');

function createBrowserSignIn({
  spawn = childProcess.spawn, exists = fs.existsSync, platform = process.platform, env = process.env, now = Date.now,
  log = (...args) => console.log(...args), warn = (...args) => console.warn(...args),
  // `mark(dir)` makes the folder and puts the app's mark into it; `remove(dir)` is one pass of
  // its removal. `execFile` and `kill` are Node's, for the processes an earlier run left.
  mark = dir => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, FOLDER_MARK), ''); },
  remove = removeFolderOnce, wait = ms => new Promise(resolve => { setTimeout(resolve, ms); }),
  execFile = childProcess.execFile, kill = (pid, signal) => process.kill(pid, signal),
} = {}) {
  // The path of an installed browser: Chrome, then Edge, Chromium, Brave, then Chrome Beta, Dev,
  // Canary and Helium. null when there is none. The log names the browser: on Windows Chrome's
  // channels, Chromium and Helium are all chrome.exe.
  // A file name is cut from its path by the rules of `platform`, not of the computer this runs on.
  const fileName = file => (platform === 'win32' ? path.win32 : path.posix).basename(file);
  const findBrowser = () => {
    const found = browserPlaces({ platform, env }).find(place => exists(place.file)) ?? null;
    if (found) log(`[Ytm] Sign-in can use ${found.name} (${fileName(found.file)})`);
    else warn('[Ytm] No Chrome (of any channel), Edge, Chromium, Brave or Helium was found for the sign-in');
    return found?.file ?? null;
  };

  // Arguments go as a list and without a shell: the paths hold spaces and non-ASCII characters.
  // Only a few failures are thrown by `spawn` itself; the rest arrive as an 'error' event.
  const start = (browserPath, args, options) => {
    try {
      return spawn(browserPath, args, { shell: false, ...options });
    } catch (error) {
      warn(`[Ytm] The browser could not be started (${error?.code ?? 'unknown'})`);
      return null;
    }
  };

  // Opens the sign-in window. `closed` resolves, and never rejects, with how the run ended:
  //   'closed'  - the browser ended after the person had used it: the cookies can be read now;
  //   'at-once' - it ended within AT_ONCE_MS, or never started: a running browser holds the
  //               folder, or the browser cannot start. The person did not close anything;
  //   'stopped' - `stop()` was called.
  // The browser is started detached: an ordinary child is ended together with this process on
  // Windows, at once and before it has written its cookies. So it is not ended when the app
  // quits; the caller calls `stop()` for that.
  // The folder gets the app's mark before a browser puts anything into it (see removeProfile);
  // where it cannot be marked, no browser is started.
  const openSignIn = (browserPath, profileDir) => {
    const startedAt = now();
    let stopping = false;
    let ended = false;
    let force;
    let finish;
    const closed = new Promise(resolve => {
      finish = outcome => {
        if (ended) return;
        ended = true;
        clearTimeout(force);
        log(`[Ytm] The sign-in browser ended after ${now() - startedAt}ms: ${outcome}`);
        resolve(outcome);
      };
    });
    let child = null;
    try {
      mark(profileDir);
      child = start(browserPath, [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', SIGN_IN_URL], { stdio: 'ignore', detached: true });
    } catch (error) {
      warn(`[Ytm] The sign-in folder could not be marked as the app's own (${error?.code ?? 'unknown'}); no browser was started`);
    }
    if (!child) {
      finish('at-once');
      return { closed, stop() {} };
    }
    log(`[Ytm] The sign-in window was opened with ${fileName(browserPath)}`);
    child.on('error', error => {
      warn(`[Ytm] The sign-in browser reported an error (${error?.code ?? 'unknown'})`);
      // Without a process id the browser never started; with one, the process is still there
      // and its end is waited for.
      if (child.pid === undefined) finish(stopping ? 'stopped' : 'at-once');
    });
    child.once('exit', () => finish(stopping ? 'stopped' : now() - startedAt < AT_ONCE_MS ? 'at-once' : 'closed'));
    return {
      closed,
      stop() {
        if (ended || stopping) return;
        stopping = true;
        child.kill();
        force = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
        force.unref?.();
      },
    };
  };

  // Reads the cookies of the profile: starts the browser headless with the debugging pipe (it
  // reads at fd 3 and writes at fd 4), asks for all cookies, asks it to close and waits for its
  // end. `--no-startup-window` keeps it from opening any page, so nothing is loaded as the
  // account by a browser that pages can tell is driven. Resolves with the cookies of YouTube as
  // { name, value, domain, path }; rejects with a BrowserSignInError:
  //   'not-started' - the browser could not be started;
  //   'exited'      - it ended without answering: a running browser holds the folder (the start
  //                   was handed over to it), or the browser cannot run;
  //   'timeout'     - no answer within `timeoutMs`; the process was ended by force;
  //   'protocol'    - what came over the pipe was not an answer to the question.
  const readCookies = (browserPath, profileDir, { timeoutMs = READ_LIMIT_MS } = {}) => new Promise((resolve, reject) => {
    const startedAt = now();
    const refuse = code => {
      warn(`[Ytm] The browser profile could not be read after ${now() - startedAt}ms: ${code}`);
      reject(new BrowserSignInError(code));
    };
    const child = start(browserPath, [
      '--headless=new', '--remote-debugging-pipe', '--no-startup-window', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
    // Listened to from the start, before the pipes are looked at: a browser that could not be
    // started for want of file handles comes without pipes and says so a moment later, and an
    // 'error' nobody listens to ends the app as an uncaught exception. What `notStarted` does
    // is set below, once there are pipes.
    let notStarted = () => {};
    child?.on('error', () => {
      if (child.pid === undefined) notStarted();
    });
    const toBrowser = child?.stdio?.[3];
    const fromBrowser = child?.stdio?.[4];
    if (!toBrowser || !fromBrowser) {
      child?.kill();
      refuse('not-started');
      return;
    }

    const read = createPipeReader();
    let cookies = null;
    let failure = null;
    let settled = false;
    const send = (id, method) => toBrowser.write(`${JSON.stringify({ id, method })}\0`);
    // A browser that failed is not asked to close: this run changes nothing it would have to save.
    const fail = code => {
      if (failure || cookies) return;
      failure = code;
      child.kill('SIGKILL');
    };
    const limit = setTimeout(() => {
      if (!cookies) {
        fail('timeout');
        return;
      }
      warn('[Ytm] The browser gave its cookies but did not close; it was ended by force');
      child.kill('SIGKILL');
    }, timeoutMs);
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      if (!cookies) {
        refuse(failure ?? 'exited');
        return;
      }
      const kept = youtubeCookies(cookies);
      log(`[Ytm] The browser profile was read in ${now() - startedAt}ms: ${cookies.length} cookies, ${kept.length} of YouTube, signed in: ${isSignedIn(kept)}`);
      resolve(kept);
    };

    // A pipe whose other end is gone reports an error of its own; the end of the process says the same.
    toBrowser.on('error', () => {});
    fromBrowser.on('error', () => {});
    fromBrowser.on('data', chunk => {
      for (const text of read(chunk)) {
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          // The parser's own error quotes what it read, so it is dropped here.
          fail('protocol');
          return;
        }
        // Anything but the answer to the first question is the browser's own news.
        if (message?.id !== 1 || cookies || failure) continue;
        if (!Array.isArray(message.result?.cookies)) {
          fail('protocol');
          return;
        }
        cookies = message.result.cookies;
        send(2, 'Browser.close');
      }
    });
    notStarted = () => {
      failure = 'not-started';
      settle();
    };
    child.once('exit', settle);
    send(1, 'Storage.getCookies');
  });

  // Whether the folder is the app's own sign-in folder: it holds the app's mark, or (one left by
  // a version that set no mark) the "Local State" a browser writes on its first run, or it is
  // empty, or it is not there at all. A removal deletes "Local State" early and the mark last,
  // so it is the mark that still tells after a removal that stopped half-way.
  const holdsOnlyAProfile = dir => {
    try {
      const names = fs.readdirSync(dir);
      return names.length === 0 || names.includes(FOLDER_MARK) || names.includes('Local State');
    } catch (error) {
      return error?.code === 'ENOENT';
    }
  };

  // Removes the profile folder, and with it the Google session the browser keeps there. false
  // when it is still there afterwards: a browser that still runs on the folder holds its files.
  // It answers within REMOVE_LIMIT_MS and one pass, and deletes nothing after it has answered.
  const removeProfile = async profileDir => {
    // The folder is removed with everything in it, so a path that could be anything but a
    // browser's profile folder is refused: a relative one, a drive's root, one that goes up
    // through "..", and a folder that holds something other than a profile.
    const isOwnFolder = typeof profileDir === 'string' && path.isAbsolute(profileDir) && path.dirname(profileDir) !== profileDir
      && !profileDir.split(/[\\/]/).includes('..') && holdsOnlyAProfile(profileDir);
    if (!isOwnFolder) {
      warn('[Ytm] The browser profile was not removed: its path is not a profile folder of its own');
      return false;
    }
    const startedAt = now();
    for (let passes = 1; ; passes += 1) {
      try {
        await remove(profileDir);
        log(`[Ytm] The browser profile was removed (${passes} pass(es), ${now() - startedAt}ms)`);
        return true;
      } catch (error) {
        if (now() - startedAt + REMOVE_AGAIN_MS > REMOVE_LIMIT_MS) {
          warn(`[Ytm] The browser profile could not be removed in ${passes} pass(es) (${error?.code ?? 'unknown'}); it still holds the sign-in`);
          return false;
        }
        await wait(REMOVE_AGAIN_MS);
      }
    }
  };

  // The processes whose command line names the folder, as [process id, command line] pairs.
  // Windows: PowerShell is the system's own, by its full path, and is given the folder in an
  // environment variable (`wmic` is gone from current Windows). Elsewhere `ps` lists every
  // process, and the folder is looked for here.
  const processesNaming = dir => new Promise((resolve, reject) => {
    const [file, args, extra] = platform === 'win32'
      ? [path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', LIST_ON_WINDOWS], { env: { ...env, FOLIA_SIGN_IN_FOLDER: dir } }]
      : ['/bin/ps', ['-axww', '-o', 'pid=,command='], {}];
    execFile(file, args, { ...extra, windowsHide: true, timeout: LIST_LIMIT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout).split(/\r?\n/).map(line => /^\s*(\d+)\s(.*)$/.exec(line)).filter(Boolean).map(([, pid, commandLine]) => [Number(pid), commandLine]));
    });
  });

  // Ends a browser that still runs on the folder: one left by a run of the app that ended
  // without quitting. Its processes are found by one look at the command lines of all processes,
  // not by a process id kept from that run: an id proves nothing by itself (ids are given out
  // again), so the command line has to be read either way, and the look also finds that
  // browser's helper processes and needs nothing stored. Only a process whose command line
  // gives exactly this folder as its `--user-data-dir` is ended, and at once: nothing in the
  // folder is read any more. false when such a process is still there afterwards.
  const endLeftBrowsers = async profileDir => {
    let pids;
    try {
      pids = (await processesNaming(profileDir)).filter(([, commandLine]) => startedOn(commandLine, profileDir)).map(([pid]) => pid);
    } catch (error) {
      // Not knowing is not a browser being there: the removal that follows tells whether the folder is held.
      warn(`[Ytm] The running processes could not be listed (${error?.code ?? 'unknown'}); a sign-in browser an earlier run left was not looked for`);
      return true;
    }
    if (pids.length === 0) return true;
    for (const pid of pids) {
      try {
        kill(pid, 'SIGKILL');
      } catch { /* gone by itself, or not ours to end: the look below tells which */ }
    }
    const runs = pid => {
      try {
        kill(pid, 0);
        return true;
      } catch (error) {
        return error?.code !== 'ESRCH';
      }
    };
    const startedAt = now();
    while (pids.some(runs)) {
      if (now() - startedAt >= ENDED_LIMIT_MS) {
        warn(`[Ytm] A sign-in browser an earlier run left could not be ended (${pids.length} process(es) were found)`);
        return false;
      }
      await wait(ENDED_CHECK_MS);
    }
    log(`[Ytm] A sign-in browser an earlier run left was ended (${pids.length} process(es)) after ${now() - startedAt}ms`);
    return true;
  };

  return { findBrowser, openSignIn, readCookies, removeProfile, endLeftBrowsers };
}

module.exports = {
  createBrowserSignIn, BrowserSignInError, browserCandidates, cookieHeaderOf, createPipeReader, isSignedIn, youtubeCookies, startedOn,
  FOLDER_MARK, SIGN_IN_URL,
};
