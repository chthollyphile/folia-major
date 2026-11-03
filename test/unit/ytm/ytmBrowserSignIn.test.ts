import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmBrowserSignIn.test.ts — the browser sign-in module, without a browser: the
// pipe's message splitting, which cookies are kept and sent, where a browser is looked for, and
// how the end of a browser run is read. The browser is a stand-in process with stand-in pipes.

const require = createRequire(import.meta.url);
const {
    createBrowserSignIn, BrowserSignInError, browserCandidates, cookieHeaderOf, createPipeReader, isSignedIn, youtubeCookies, startedOn, FOLDER_MARK,
} = require('../../../electron/ytm/browserSignIn.cjs');

const cookie = (name: string, value: string, domain: string, cookiePath = '/') => ({ name, value, domain, path: cookiePath });

describe('the pipe reader', () => {
    it('joins a message cut across two chunks', () => {
        const read = createPipeReader();
        expect(read(Buffer.from('{"id":1,"res'))).toEqual([]);
        expect(read(Buffer.from('ult":{}}\0'))).toEqual(['{"id":1,"result":{}}']);
    });

    it('splits two messages that came in one chunk, and keeps the start of a third', () => {
        const read = createPipeReader();
        expect(read(Buffer.from('{"id":1}\0{"id":2}\0{"id"'))).toEqual(['{"id":1}', '{"id":2}']);
        expect(read(Buffer.from(':3}\0'))).toEqual(['{"id":3}']);
    });

    it('keeps a character whole when the cut falls inside it', () => {
        const read = createPipeReader();
        const bytes = Buffer.from('{"name":"音乐"}\0');
        const cut = bytes.indexOf(Buffer.from('乐')) + 1;
        expect(read(bytes.subarray(0, cut))).toEqual([]);
        expect(read(bytes.subarray(cut))).toEqual(['{"name":"音乐"}']);
    });
});

describe('the cookie filter', () => {
    it('keeps youtube.com and its subdomains, and only the four fields', () => {
        const kept = youtubeCookies([
            { name: 'SAPISID', value: 'a', domain: '.youtube.com', path: '/', expires: 1, httpOnly: false, secure: true },
            { name: 'host', value: 'b', domain: 'www.youtube.com', path: '/' },
            { name: 'music', value: 'c', domain: '.music.youtube.com', path: '/' },
            { name: 'bare', value: 'd', domain: 'youtube.com', path: '/' },
        ]);
        expect(kept).toEqual([
            cookie('SAPISID', 'a', '.youtube.com'), cookie('host', 'b', 'www.youtube.com'),
            cookie('music', 'c', '.music.youtube.com'), cookie('bare', 'd', 'youtube.com'),
        ]);
    });

    it('leaves out other domains, also ones that only look like YouTube', () => {
        expect(youtubeCookies([
            cookie('SAPISID', 'a', '.google.com'), cookie('x', 'b', 'notyoutube.com'), cookie('y', 'c', '.youtube.com.example.org'),
            cookie('z', 'd', 'accounts.google.com'), null, { name: 'broken' },
        ])).toEqual([]);
    });

    it('leaves out a cookie that is kept apart for another site', () => {
        expect(youtubeCookies([
            { ...cookie('embedded', 'a', '.youtube.com'), partitionKey: { topLevelSite: 'https://example.org', hasCrossSiteAncestor: true } },
            { ...cookie('older', 'b', '.youtube.com'), partitionKey: 'https://example.org' },
            { ...cookie('own', 'c', '.youtube.com'), partitionKey: { topLevelSite: 'https://youtube.com', hasCrossSiteAncestor: false } },
        ])).toEqual([cookie('own', 'c', '.youtube.com')]);
    });
});

describe('cookieHeaderOf', () => {
    it('has a name once, and of two the one of .youtube.com, whichever comes first', () => {
        expect(cookieHeaderOf([cookie('PREF', 'host', 'www.youtube.com'), cookie('PREF', 'account', '.youtube.com'), cookie('SID', 's', '.youtube.com')]))
            .toBe('PREF=account; SID=s');
        expect(cookieHeaderOf([cookie('PREF', 'account', '.youtube.com'), cookie('PREF', 'host', 'www.youtube.com')])).toBe('PREF=account');
    });

    it('leaves out what a browser would not send to www.youtube.com/youtubei/', () => {
        expect(cookieHeaderOf([
            cookie('other-host', 'a', 'music.youtube.com'), cookie('other-subdomain', 'b', '.music.youtube.com'), cookie('host-only', 'c', 'youtube.com'),
            cookie('other-path', 'd', '.youtube.com', '/embed'), cookie('', 'e', '.youtube.com'),
            cookie('own-path', 'f', '.youtube.com', '/youtubei'), cookie('www', 'g', '.www.youtube.com'),
        ])).toBe('own-path=f; www=g');
    });

    it('is empty for no cookies', () => {
        expect(cookieHeaderOf([])).toBe('');
    });
});

describe('isSignedIn', () => {
    it('needs the SAPISID cookie of .youtube.com', () => {
        expect(isSignedIn([cookie('SID', 's', '.youtube.com'), cookie('SAPISID', 'a', '.youtube.com')])).toBe(true);
        expect(isSignedIn([cookie('SID', 's', '.youtube.com')])).toBe(false);
        expect(isSignedIn([cookie('SAPISID', 'a', 'music.youtube.com')])).toBe(false);
        expect(isSignedIn([cookie('SAPISID', '', '.youtube.com')])).toBe(false);
        expect(isSignedIn([])).toBe(false);
    });
});

describe('where a browser is looked for', () => {
    const windows = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\某人\\AppData\\Local' };
    const finder = (platform: string, env: Record<string, string>, installed: string[]) => createBrowserSignIn({
        platform, env, exists: (candidate: string) => installed.includes(candidate), log: () => {}, warn: () => {},
    }).findBrowser();

    it('lists the four stable browsers first on Windows, every browser under the computer\'s programs folders before any under the person\'s own', () => {
        const candidates = browserCandidates({ platform: 'win32', env: windows });
        // Seven browsers under two programs folders (Chrome Canary is never installed there), then all eight under the person's own.
        expect(candidates).toHaveLength(22);
        expect(candidates.slice(0, 4)).toEqual([
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]);
        expect(candidates[7]).toBe('C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe');
        expect(candidates.slice(14).every((candidate: string) => candidate.startsWith('C:\\Users\\某人\\AppData\\Local\\'))).toBe(true);
        expect(candidates[14]).toBe('C:\\Users\\某人\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
    });

    it('then Chrome Beta, Dev and Helium under the programs folders, and Chrome Canary only under the person\'s own on Windows', () => {
        const candidates = browserCandidates({ platform: 'win32', env: windows });
        expect(candidates.slice(8, 14)).toEqual([
            'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome Beta\\Application\\chrome.exe',
            'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome Dev\\Application\\chrome.exe',
            'C:\\Program Files\\imput\\Helium\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\imput\\Helium\\Application\\chrome.exe',
        ]);
        expect(candidates.slice(18)).toEqual([
            'C:\\Users\\某人\\AppData\\Local\\Google\\Chrome Beta\\Application\\chrome.exe',
            'C:\\Users\\某人\\AppData\\Local\\Google\\Chrome Dev\\Application\\chrome.exe',
            'C:\\Users\\某人\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe',
            'C:\\Users\\某人\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe',
        ]);
        expect(candidates.filter((candidate: string) => candidate.includes('Chrome SxS'))).toHaveLength(1);
    });

    it('takes Chrome before Edge, any browser of the computer before a person\'s own Chrome, and that one when it is all there is', () => {
        const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        const brave = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
        const ownChrome = 'C:\\Users\\某人\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
        expect(finder('win32', windows, [edge, chrome])).toBe(chrome);
        expect(finder('win32', windows, [ownChrome, edge])).toBe(edge);
        expect(finder('win32', windows, [ownChrome, brave])).toBe(brave);
        expect(finder('win32', windows, [ownChrome])).toBe(ownChrome);
        expect(finder('win32', windows, [])).toBeNull();
    });

    it('takes a stable browser before Chrome\'s other channels and Helium, and one of those when it is all there is', () => {
        const beta = 'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe';
        const helium = 'C:\\Program Files\\imput\\Helium\\Application\\chrome.exe';
        const canary = 'C:\\Users\\某人\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe';
        const brave = 'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
        expect(finder('win32', windows, [helium, beta, brave])).toBe(brave);
        expect(finder('win32', windows, [helium, beta])).toBe(beta);
        expect(finder('win32', windows, [canary, helium])).toBe(helium);
        expect(finder('win32', windows, [canary])).toBe(canary);
    });

    it('names the browser it found in the log, also where the file is chrome.exe for several', () => {
        const lines: string[] = [];
        createBrowserSignIn({
            platform: 'win32', env: windows, exists: (candidate: string) => candidate.includes('imput'), log: (line: string) => lines.push(line), warn: () => {},
        }).findBrowser();
        expect(lines).toEqual(['[Ytm] Sign-in can use Helium (chrome.exe)']);
    });

    it('skips a programs folder the computer does not name', () => {
        expect(browserCandidates({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' } })).toHaveLength(7);
    });

    it('looks in the computer\'s applications folder on macOS, then in the person\'s own', () => {
        const candidates = browserCandidates({ platform: 'darwin', env: { HOME: '/Users/someone' } });
        expect(candidates).toHaveLength(16);
        expect(candidates.slice(0, 4)).toEqual([
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        ]);
        expect(candidates[8]).toBe('/Users/someone/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
        expect(finder('darwin', {}, ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']))
            .toBe('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
    });

    it('looks for Chrome\'s other channels and Helium on macOS after the four, under their own application names', () => {
        const candidates = browserCandidates({ platform: 'darwin', env: { HOME: '/Users/someone' } });
        expect(candidates.slice(4, 8)).toEqual([
            '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
            '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Helium.app/Contents/MacOS/Helium',
        ]);
        expect(candidates[15]).toBe('/Users/someone/Applications/Helium.app/Contents/MacOS/Helium');
        expect(finder('darwin', { HOME: '/Users/someone' }, ['/Users/someone/Applications/Helium.app/Contents/MacOS/Helium', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary']))
            .toBe('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary');
    });

    it('looks for the usual names on PATH on Linux, in its absolute folders only', () => {
        const env = { PATH: '/usr/local/bin:/usr/bin' };
        expect(browserCandidates({ platform: 'linux', env }).slice(0, 4)).toEqual([
            '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome-stable', '/usr/bin/google-chrome-stable',
        ]);
        expect(finder('linux', env, ['/usr/bin/chromium-browser', '/usr/bin/brave'])).toBe('/usr/bin/chromium-browser');
        expect(finder('linux', {}, ['/usr/bin/chromium'])).toBeNull();
        // A folder named from wherever the app was started is not looked in.
        expect(browserCandidates({ platform: 'linux', env: { PATH: '.:bin::../tools:/usr/bin' } }).every((candidate: string) => candidate.startsWith('/usr/bin/'))).toBe(true);
        expect(finder('linux', { PATH: '.:bin' }, ['google-chrome', 'bin/google-chrome'])).toBeNull();
    });

    it('looks for Chrome\'s other channels and Helium on Linux by their command names, after the stable four', () => {
        const env = { PATH: '/usr/bin' };
        expect(browserCandidates({ platform: 'linux', env }).slice(8)).toEqual([
            '/usr/bin/google-chrome-beta', '/usr/bin/google-chrome-unstable', '/usr/bin/google-chrome-canary', '/usr/bin/helium', '/usr/bin/helium-browser',
        ]);
        // The reporter of issue 812: Chrome Beta and Dev from the AUR, and helium-browser-bin.
        expect(finder('linux', env, ['/usr/bin/helium-browser', '/usr/bin/google-chrome-unstable', '/usr/bin/google-chrome-beta'])).toBe('/usr/bin/google-chrome-beta');
        expect(finder('linux', env, ['/usr/bin/helium-browser', '/usr/bin/google-chrome-unstable'])).toBe('/usr/bin/google-chrome-unstable');
        expect(finder('linux', env, ['/usr/bin/helium-browser'])).toBe('/usr/bin/helium-browser');
        expect(finder('linux', env, ['/usr/bin/helium-browser', '/usr/bin/chromium'])).toBe('/usr/bin/chromium');
    });
});

// A stand-in for the browser process. `answer` is called with each message the module writes to
// the pipe and says what the browser does about it.
const fakeBrowser = (answer: (message: { id: number; method: string }, browser: any) => void = () => {}) => {
    const browser: any = new EventEmitter();
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    const read = createPipeReader();
    browser.pid = 4242;
    browser.stdio = [null, null, null, toBrowser, fromBrowser];
    browser.asked = [] as string[];
    browser.say = (value: unknown) => fromBrowser.write(typeof value === 'string' ? value : `${JSON.stringify(value)}\0`);
    browser.kill = vi.fn(() => { setImmediate(() => browser.emit('exit', null, 'SIGKILL')); return true; });
    toBrowser.on('data', chunk => {
        for (const text of read(chunk)) {
            const message = JSON.parse(text);
            browser.asked.push(message.method);
            answer(message, browser);
        }
    });
    const spawn = vi.fn((_path: string, _args: string[], _options: Record<string, unknown>) => browser);
    return { browser, spawn };
};

const BROWSER = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = 'C:\\Users\\某人\\AppData\\Roaming\\folia app\\ytm-browser';
const quiet = { log: () => {}, warn: () => {} };

describe('openSignIn', () => {
    // The folder is not made here: `mark` is a stand-in.
    const open = (elapsed: { ms: number }, spawn: unknown, mark: unknown = () => {}) => createBrowserSignIn({ spawn, mark, now: () => elapsed.ms, ...quiet }).openSignIn(BROWSER, PROFILE);

    it('puts the app\'s mark into the folder before the browser is started, and starts none on a folder it could not mark', async () => {
        const { spawn } = fakeBrowser();
        const mark = vi.fn();
        open({ ms: 0 }, spawn, mark);
        expect(mark).toHaveBeenCalledWith(PROFILE);
        expect(mark.mock.invocationCallOrder[0]).toBeLessThan(spawn.mock.invocationCallOrder[0]);

        const unmarked = fakeBrowser();
        const run = open({ ms: 0 }, unmarked.spawn, () => { throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${PROFILE}'`), { code: 'EPERM' }); });
        await expect(run.closed).resolves.toBe('at-once');
        expect(unmarked.spawn).not.toHaveBeenCalled();

        // The mark as it is really made: a file of the app's own in a folder that may not exist yet.
        const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ytm-mark-')), 'ytm-sign-in');
        createBrowserSignIn({ spawn: fakeBrowser().spawn, ...quiet }).openSignIn(BROWSER, folder);
        expect(fs.readdirSync(folder)).toEqual([FOLDER_MARK]);
        fs.rmSync(path.dirname(folder), { recursive: true, force: true });
    });

    it('starts an ordinary browser: the folder as one argument, no shell, no debugging switch', () => {
        const { spawn } = fakeBrowser();
        open({ ms: 0 }, spawn);
        const [file, args, options] = spawn.mock.calls[0];
        expect(file).toBe(BROWSER);
        expect(args).toEqual([
            `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
            'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F',
        ]);
        expect(args.some(arg => /debug|headless|automation/i.test(arg))).toBe(false);
        expect(options).toMatchObject({ shell: false, stdio: 'ignore', detached: true });
    });

    it('reads an end after a while as the window being closed', async () => {
        const elapsed = { ms: 0 };
        const { browser, spawn } = fakeBrowser();
        const run = open(elapsed, spawn);
        elapsed.ms = 48_000;
        browser.emit('exit', 0, null);
        await expect(run.closed).resolves.toBe('closed');
    });

    it('never reads an end within two seconds as the window being closed', async () => {
        const elapsed = { ms: 0 };
        const { browser, spawn } = fakeBrowser();
        const run = open(elapsed, spawn);
        elapsed.ms = 380;
        browser.emit('exit', 0, null);
        await expect(run.closed).resolves.toBe('at-once');
    });

    it('reads a browser that never started as an end at once, whenever the news comes', async () => {
        const elapsed = { ms: 0 };
        const { browser, spawn } = fakeBrowser();
        browser.pid = undefined;
        const run = open(elapsed, spawn);
        elapsed.ms = 5000;
        browser.emit('error', Object.assign(new Error(`spawn ${BROWSER} ENOENT`), { code: 'ENOENT' }));
        await expect(run.closed).resolves.toBe('at-once');

        const refused = open({ ms: 0 }, () => { throw new Error('spawn UNKNOWN'); });
        await expect(refused.closed).resolves.toBe('at-once');
    });

    it('reads an end after stop() as stopped, also within two seconds', async () => {
        const { browser, spawn } = fakeBrowser();
        const run = open({ ms: 0 }, spawn);
        run.stop();
        run.stop();
        expect(browser.kill).toHaveBeenCalledTimes(1);
        await expect(run.closed).resolves.toBe('stopped');
    });
});

describe('readCookies', () => {
    const profileCookies = [
        { name: 'SAPISID', value: 'secret-value-1', domain: '.youtube.com', path: '/', expires: 1, secure: true },
        { name: 'SID', value: 'secret-value-2', domain: '.google.com', path: '/' },
    ];
    const reader = (spawn: unknown, lines: string[] = []) => createBrowserSignIn({
        spawn, log: (line: string) => lines.push(line), warn: (line: string) => lines.push(line),
    });

    it('starts the browser headless on the pipe, with no page to open', async () => {
        const { spawn } = fakeBrowser((message, browser) => {
            if (message.method === 'Storage.getCookies') browser.say({ id: message.id, result: { cookies: [] } });
            else browser.emit('exit', 0, null);
        });
        await reader(spawn).readCookies(BROWSER, PROFILE);
        const [file, args, options] = spawn.mock.calls[0];
        expect(file).toBe(BROWSER);
        expect(args).toEqual(expect.arrayContaining(['--headless=new', '--remote-debugging-pipe', '--no-startup-window', `--user-data-dir=${PROFILE}`]));
        expect(args.some(arg => /^(https?:|about:)/.test(arg) || /debugging-port/.test(arg))).toBe(false);
        expect(options).toMatchObject({ shell: false, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    });

    it('gives the cookies of YouTube after the browser has closed, and logs no value', async () => {
        const lines: string[] = [];
        const { browser, spawn } = fakeBrowser((message, self) => {
            if (message.method === 'Storage.getCookies') {
                // The browser's own news first, then the answer cut in two.
                self.say({ method: 'Target.targetCreated', params: {} });
                const answer = `${JSON.stringify({ id: message.id, result: { cookies: profileCookies } })}\0`;
                self.say(answer.slice(0, 30));
                self.say(answer.slice(30));
            } else {
                self.say({ id: message.id, result: {} });
                self.emit('exit', 0, null);
            }
        });
        const cookies = await reader(spawn, lines).readCookies(BROWSER, PROFILE);
        expect(cookies).toEqual([{ name: 'SAPISID', value: 'secret-value-1', domain: '.youtube.com', path: '/' }]);
        expect(browser.asked).toEqual(['Storage.getCookies', 'Browser.close']);
        expect(browser.kill).not.toHaveBeenCalled();
        expect(lines.join('\n')).toContain('2 cookies, 1 of YouTube, signed in: true');
        expect(lines.join('\n')).not.toContain('secret-value');
    });

    it('ends a browser that does not answer and fails with a fixed sentence', async () => {
        const { browser, spawn } = fakeBrowser();
        const failure = await reader(spawn).readCookies(BROWSER, PROFILE, { timeoutMs: 15 }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(BrowserSignInError);
        expect(failure).toMatchObject({ code: 'timeout', message: 'The browser did not answer in time' });
        expect(browser.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('fails when the browser ends without an answer, as it does on a folder another browser holds', async () => {
        const { spawn } = fakeBrowser((_message, browser) => browser.emit('exit', 0, null));
        await expect(reader(spawn).readCookies(BROWSER, PROFILE)).rejects.toMatchObject({ name: 'BrowserSignInError', code: 'exited' });
    });

    it('puts nothing the pipe said into the error or the log', async () => {
        for (const said of ['SAPISID=secret-value-1 is not JSON\0', { id: 1, error: { message: 'secret-value-1' } }]) {
            const lines: string[] = [];
            const { browser, spawn } = fakeBrowser((_message, self) => self.say(said));
            const failure = await reader(spawn, lines).readCookies(BROWSER, PROFILE).catch((error: unknown) => error);
            expect(failure).toMatchObject({ name: 'BrowserSignInError', code: 'protocol' });
            expect(`${String(failure)} ${JSON.stringify(failure)} ${lines.join(' ')}`).not.toContain('secret-value');
            expect(browser.kill).toHaveBeenCalledTimes(1);
        }
    });

    it('fails as not started when the browser cannot be started', async () => {
        const { browser, spawn } = fakeBrowser();
        browser.pid = undefined;
        const reading = reader(spawn).readCookies(BROWSER, PROFILE);
        browser.emit('error', Object.assign(new Error(`spawn ${BROWSER} ENOENT`), { code: 'ENOENT' }));
        await expect(reading).rejects.toMatchObject({ code: 'not-started' });
        await expect(reader(() => { throw new Error('spawn UNKNOWN'); }).readCookies(BROWSER, PROFILE)).rejects.toMatchObject({ code: 'not-started' });
    });

    // Out of file handles, Node gives a child without pipes and reports the failure a moment
    // later; an 'error' event nobody listens to is an uncaught exception.
    it('listens for the failure of a browser that came without pipes', async () => {
        const { browser, spawn } = fakeBrowser();
        Object.assign(browser, { pid: undefined, stdio: undefined });
        const reading = reader(spawn).readCookies(BROWSER, PROFILE);
        expect(browser.listenerCount('error')).toBe(1);
        browser.emit('error', Object.assign(new Error(`spawn ${BROWSER} EMFILE`), { code: 'EMFILE' }));
        await expect(reading).rejects.toMatchObject({ code: 'not-started' });
    });
});

describe('removeProfile', () => {
    it('removes a profile folder with what is in it', async () => {
        const { removeProfile } = createBrowserSignIn(quiet);
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ytm-profile-'));
        fs.writeFileSync(path.join(folder, 'Local State'), '{}');
        fs.mkdirSync(path.join(folder, 'Default'));
        fs.writeFileSync(path.join(folder, 'Default', 'Cookies'), 'x');
        expect(await removeProfile(folder)).toBe(true);
        expect(fs.existsSync(folder)).toBe(false);
        expect(await removeProfile(folder)).toBe(true);
    });

    // The remover is a stand-in here: a guard that let one of these through must not reach a real folder.
    it('refuses, and removes nothing, when the path is not a profile folder of its own', async () => {
        const remove = vi.fn(async () => {});
        const { removeProfile } = createBrowserSignIn({ ...quiet, remove });
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ytm-other-'));
        const profile = path.join(folder, 'profile');
        fs.mkdirSync(profile);
        fs.writeFileSync(path.join(profile, 'Local State'), '{}');
        fs.writeFileSync(path.join(folder, 'notes.txt'), 'x');
        for (const refused of ['profile', '', path.parse(folder).root, folder, `${profile}${path.sep}..`, `${profile}/../profile`]) {
            expect(await removeProfile(refused)).toBe(false);
        }
        expect(remove).not.toHaveBeenCalled();
        expect(await removeProfile(profile)).toBe(true);
        expect(remove).toHaveBeenCalledWith(profile);
        // A folder with other content and neither the app's mark nor "Local State" is nobody's profile.
        fs.rmSync(path.join(profile, 'Local State'));
        fs.writeFileSync(path.join(profile, 'Preferences'), '{}');
        expect(await removeProfile(profile)).toBe(false);
        fs.writeFileSync(path.join(profile, FOLDER_MARK), '');
        expect(await removeProfile(profile)).toBe(true);
        expect(remove).toHaveBeenCalledTimes(2);
        fs.rmSync(folder, { recursive: true, force: true });
    });

    // A clock that only the waits of the removal move.
    const waited = () => {
        const clock = { ms: 0, waits: [] as number[] };
        return { clock, now: () => clock.ms, wait: async (ms: number) => { clock.waits.push(ms); clock.ms += ms; } };
    };

    it('still takes the folder for its own after a removal that failed half-way, and then removes it', async () => {
        // As a version that set no mark left it: the removal itself marks it before it deletes anything.
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ytm-half-'));
        fs.writeFileSync(path.join(folder, 'Local State'), '{}');
        fs.mkdirSync(path.join(folder, 'Default'));
        fs.writeFileSync(path.join(folder, 'Default', 'Cookies'), 'x');
        // A running browser holds its databases: here everything under Default.
        const rm = fs.promises.rm;
        const held = vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
            if (path.basename(String(target)) === 'Default') throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
            return rm(target, options);
        });
        const warn = vi.fn();
        try {
            const { clock, now, wait } = waited();
            expect(await createBrowserSignIn({ log: () => {}, warn, now, wait }).removeProfile(folder)).toBe(false);
            expect(clock.ms).toBeLessThanOrEqual(4000);
        } finally {
            held.mockRestore();
        }
        // "Local State" went with the first pass; the mark is what is left to know the folder by.
        expect(fs.readdirSync(folder).sort()).toEqual(['Default', FOLDER_MARK].sort());
        expect(String(warn.mock.calls.at(-1))).toMatch(/could not be removed in \d+ pass\(es\) \(EBUSY\)/);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(path.basename(folder));
        // The last step fails: the folder itself stays (a file was written into it meanwhile). The mark is put back.
        const stays = vi.spyOn(fs.promises, 'rmdir').mockRejectedValue(Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' }));
        try {
            expect(await createBrowserSignIn({ ...quiet, ...waited() }).removeProfile(folder)).toBe(false);
        } finally {
            stays.mockRestore();
        }
        expect(fs.readdirSync(folder)).toEqual([FOLDER_MARK]);
        expect(await createBrowserSignIn(quiet).removeProfile(folder)).toBe(true);
        expect(fs.existsSync(folder)).toBe(false);
    });

    it('answers within its time limit while the folder is held, and tries nothing after it has answered', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ytm-held-'));
        const { clock, now, wait } = waited();
        const remove = vi.fn(async (_dir: string): Promise<void> => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); });
        expect(await createBrowserSignIn({ ...quiet, remove, now, wait }).removeProfile(folder)).toBe(false);
        expect(clock.ms).toBeLessThanOrEqual(4000);
        expect(clock.waits.every(ms => ms === clock.waits[0])).toBe(true);
        expect(remove).toHaveBeenCalledTimes(clock.waits.length + 1);
        const passes = remove.mock.calls.length;
        await new Promise(resolve => { setImmediate(resolve); });
        expect(remove).toHaveBeenCalledTimes(passes);

        // A pass that succeeds ends it at once.
        remove.mockReset();
        remove.mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' })).mockResolvedValue(undefined);
        expect(await createBrowserSignIn({ ...quiet, remove, ...waited() }).removeProfile(folder)).toBe(true);
        expect(remove).toHaveBeenCalledTimes(2);
        fs.rmSync(folder, { recursive: true, force: true });
    });
});

describe('a browser an earlier run left on the folder', () => {
    const NODE_QUOTED = `"${BROWSER}" "--user-data-dir=${PROFILE}" --no-first-run`;
    const HELPER = `"${BROWSER}" --type=renderer --user-data-dir="${PROFILE}" --lang=en`;

    it('is known by its command line giving exactly this folder as its user data folder', () => {
        for (const own of [NODE_QUOTED, HELPER, `chrome --user-data-dir=${PROFILE}`, `/opt/chrome/chrome --headless=new --user-data-dir=/home/a b/ytm-sign-in --no-first-run`]) {
            expect(startedOn(own, own.includes('/home/') ? '/home/a b/ytm-sign-in' : PROFILE)).toBe(true);
        }
        for (const other of [
            `"${BROWSER}" "--user-data-dir=${PROFILE}-other" --no-first-run`, `"${BROWSER}" --user-data-dir="${PROFILE}\\Default"`,
            `"${BROWSER}" --user-data-dir="C:\\elsewhere" --disk-cache-dir="${PROFILE}"`, `notepad "${PROFILE}\\notes.txt"`, `"${BROWSER}"`, '',
            // A folder beside this one whose name goes on after a space, bare as `ps` prints it and in quotes.
            `chrome --user-data-dir=${PROFILE} - Copy --no-first-run`, `"${BROWSER}" "--user-data-dir=${PROFILE} - Copy" --no-first-run`,
        ]) {
            expect(startedOn(other, PROFILE)).toBe(false);
        }
    });

    // `listed` is what the system's list of processes prints; `running` the processes that are there.
    const leftBrowsers = (platform: string, listed: string | Error, running: number[], survives: number[] = []) => {
        const execFile = vi.fn((_file: string, _args: string[], _options: any, done: (error: Error | null, stdout?: string) => void) => {
            if (listed instanceof Error) done(listed);
            else done(null, listed);
        });
        const kill = vi.fn((pid: number, signal: string | number) => {
            if (!running.includes(pid)) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
            if (signal !== 0 && !survives.includes(pid)) running.splice(running.indexOf(pid), 1);
        });
        const clock = { ms: 0 };
        const lines: string[] = [];
        const browser = createBrowserSignIn({ platform, env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\planted' }, execFile, kill, now: () => clock.ms,
            wait: async (ms: number) => { clock.ms += ms; }, log: (line: string) => lines.push(line), warn: (line: string) => lines.push(line) });
        return { browser, execFile, kill, clock, lines, ended: () => kill.mock.calls.filter(([, signal]) => signal !== 0).map(([pid]) => pid) };
    };

    it('ends the processes started on the folder and no other, on Windows through the system\'s own PowerShell', async () => {
        const listed = [`4242 ${NODE_QUOTED}`, `  4250 ${HELPER}`, `5000 "${BROWSER}" "--user-data-dir=${PROFILE}-other"`, `5001 notepad "${PROFILE}\\notes.txt"`, '', 'not a line'].join('\r\n');
        const { browser, execFile, ended, lines } = leftBrowsers('win32', listed, [4242, 4250, 5000, 5001]);
        expect(await browser.endLeftBrowsers(PROFILE)).toBe(true);
        expect(ended()).toEqual([4242, 4250]);
        const [file, args, options] = execFile.mock.calls[0];
        expect(file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
        // The folder reaches PowerShell in its environment and is no part of the command.
        expect(args.join(' ')).not.toContain(PROFILE);
        expect(args.join(' ')).toContain('$env:FOLIA_SIGN_IN_FOLDER');
        expect(options.env.FOLIA_SIGN_IN_FOLDER).toBe(PROFILE);
        expect(lines.join('\n')).toContain('was ended (2 process(es))');
        expect(lines.join('\n')).not.toContain(PROFILE);
    });

    it('reads the list of `ps` elsewhere, and ends nothing when no process is on the folder', async () => {
        const folder = '/home/someone/.config/folia app/ytm-sign-in';
        const mac = leftBrowsers('darwin', `  812 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${folder} --no-first-run\n  900 grep ${folder}\n`, [812, 900]);
        expect(await mac.browser.endLeftBrowsers(folder)).toBe(true);
        expect(mac.ended()).toEqual([812]);
        expect(mac.execFile.mock.calls[0].slice(0, 2)).toEqual(['/bin/ps', ['-axww', '-o', 'pid=,command=']]);

        const none = leftBrowsers('linux', `  1 /sbin/init\n  77 /usr/bin/chromium --user-data-dir=${folder}-2\n`, [1, 77]);
        expect(await none.browser.endLeftBrowsers(folder)).toBe(true);
        expect(none.kill).not.toHaveBeenCalled();
    });

    it('says so when a process on the folder is still there afterwards, and goes on when the processes cannot be listed', async () => {
        const stuck = leftBrowsers('win32', `4242 ${NODE_QUOTED}`, [4242], [4242]);
        expect(await stuck.browser.endLeftBrowsers(PROFILE)).toBe(false);
        expect(stuck.clock.ms).toBeLessThanOrEqual(2000);
        expect(stuck.lines.at(-1)).toContain('could not be ended');

        const unlisted = leftBrowsers('win32', Object.assign(new Error(`spawn powershell.exe ENOENT ${PROFILE}`), { code: 'ENOENT' }), [4242]);
        expect(await unlisted.browser.endLeftBrowsers(PROFILE)).toBe(true);
        expect(unlisted.kill).not.toHaveBeenCalled();
        expect(unlisted.lines.join('\n')).toContain('could not be listed (ENOENT)');
        expect(unlisted.lines.join('\n')).not.toContain(PROFILE);
    });
});
