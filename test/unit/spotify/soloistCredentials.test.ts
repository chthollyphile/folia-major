import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

// Exercise trusted IPC against real temporary files; no Spotify service or real credentials are used.
const require = createRequire(import.meta.url);
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function harness(directory?: string, backend = 'kwallet6') {
    const dir = directory || fs.mkdtempSync(path.join(os.tmpdir(), 'folia-soloist-test-'));
    if (!directory) directories.push(dir);
    const defaultBinary = path.join(dir, '.local/share/spotify-soloist/soloist');
    fs.mkdirSync(path.dirname(defaultBinary), { recursive: true });
    fs.writeFileSync(defaultBinary, 'test executable');
    let running = false;
    let available = true;
    const handlers = new Map<string, (...args: any[]) => any>();
    class Socket extends EventEmitter {
        constructor() { super(); queueMicrotask(() => running ? this.emit('message', JSON.stringify({ type: 'auth_state', logged_in: true })) : this.emit('error', Error('offline'))); }
        terminate() {}
    }
    const exports = { exports: {} as any };
    const childProcess = {
        execFile: (_file: string, _args: string[], _options: unknown, callback: (error: unknown, result: unknown) => void) => callback(null, `soloist test build ${Math.floor(Date.now() / 1000)} (linux/x86_64)`),
        spawn: () => {
            running = true;
            const child: any = new EventEmitter(); child.exitCode = null;
            child.kill = () => { running = false; child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); };
            return child;
        },
    };
    Object.assign(childProcess.execFile, { [promisify.custom]: async () => ({ stdout: `soloist test build ${Math.floor(Date.now() / 1000)} (linux/x86_64)`, stderr: '' }) });
    const customRequire = (name: string) => name === 'node:child_process' ? childProcess : name === 'ws' ? Socket : name === './soloistVersion.cjs' ? require('../../../electron/spotify/soloistVersion.cjs') : require(name);
    vm.runInNewContext(fs.readFileSync(new URL('../../../electron/spotify/soloist.cjs', import.meta.url), 'utf8'), {
        require: customRequire, module: exports, process: { env: {}, argv: [] }, console: { info() {} }, setTimeout, clearTimeout,
    });
    // Match Node's execFile promisify contract without starting an executable.
    const app: any = new EventEmitter();
    app.getPath = (which: string) => which === 'home' ? dir : dir;
    app.whenReady = () => new Promise(() => {});
    const trusted = {};
    const api = exports.exports.install({
        app, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler), on() {} },
        safeStorage: {
            isEncryptionAvailable: () => available,
            getSelectedStorageBackend: () => backend,
            encryptString: (key: string) => Buffer.from('sealed:' + key.split('').reverse().join('')),
            decryptString: (value: Buffer) => value.toString().slice(7).split('').reverse().join(''),
        },
        shell: { openExternal() {} }, dialog: { showOpenDialog: async () => ({ canceled: true }) },
        isTrustedMainWindowContents: (sender: unknown) => sender === trusted,
    });
    return { dir, api, setAvailable: (value: boolean) => { available = value; }, request: (operation: string, value?: unknown, sender = trusted) => handlers.get('soloist-local-' + operation)!({ sender }, value) };
}
describe('Soloist encrypted key persistence', () => {
    it('rejects untrusted and malformed requests before creating a key file', async () => {
        const h = harness();
        expect(await h.request('save', 'test-only-key', {})).toMatchObject({ ok: false, message: 'untrusted' });
        expect(await h.request('save', 'bad')).toMatchObject({ ok: false, message: 'invalidKey' });
        expect(fs.existsSync(path.join(h.dir, 'soloist-api-key.enc'))).toBe(false);
    });
    it('rejects Linux basic_text storage instead of claiming secure persistence', async () => {
        const h = harness(undefined, 'basic_text');
        expect(await h.request('save', 'test-only-key')).toMatchObject({ ok: false, message: 'locked' });
        expect(fs.existsSync(path.join(h.dir, 'soloist-api-key.enc'))).toBe(false);
    });
    it('saves mode 0600 and exposes only availability after a fresh manager starts', async () => {
        const h = harness();
        const saved = await h.request('save', 'test-only-key');
        expect(saved).toMatchObject({ saved: true, ok: true });
        const file = path.join(h.dir, 'soloist-api-key.enc');
        expect(fs.readFileSync(file).includes(Buffer.from('test-only-key'))).toBe(false);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        const fresh = harness(h.dir);
        const status = await fresh.request('status');
        expect(status).toMatchObject({ configured: true, keyState: 'available' });
        expect(JSON.stringify(status)).not.toContain('test-only-key');
        await h.api.shutdown();
    });
    it('preserves the existing key when the system keyring is locked', async () => {
        const h = harness();
        await h.request('save', 'test-only-key');
        const file = path.join(h.dir, 'soloist-api-key.enc'), before = fs.readFileSync(file);
        const fresh = harness(h.dir); fresh.setAvailable(false);
        expect(await fresh.request('status')).toMatchObject({ configured: true, keyState: 'locked' });
        expect(await fresh.request('save', 'another-test-key')).toMatchObject({ ok: false, message: 'locked' });
        expect(fs.readFileSync(file)).toEqual(before);
        await h.api.shutdown();
    });
});
