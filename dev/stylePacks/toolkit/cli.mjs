import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { root } from '../mcp/content.mjs';
import { exportClients } from '../mcp/exportClients.mjs';
import { diagnose } from '../mcp/diagnose.mjs';
import { selfTest } from './selfTest.mjs';
import { runCodex as codex } from './codex.mjs';

// Installed commands use the bundled runtime; client configuration always points at its absolute path.
const server = path.join(root, 'dev/stylePacks/mcp/server.mjs');
const data = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'FoliaStyleTools');
const [command = 'help', ...args] = process.argv.slice(2);
async function backupCodex() {
    const config = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'config.toml');
    const out = path.join(data, 'backups');
    await mkdir(out, { recursive: true });
    try { await copyFile(config, path.join(out, `codex-${Date.now()}.toml`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}
try {
    if (command === 'serve') {
        process.argv = [process.execPath, server, ...args];
        await import('../mcp/server.mjs');
    } else if (command === 'doctor' || command === 'self-test') {
        if (args.length && (args.length !== 2 || args[0] !== '--http')) throw new Error('Usage: doctor|self-test [--http http://127.0.0.1:port/mcp]');
        const options = args.length ? { url: args[1] } : {};
        console.info(JSON.stringify(await (command === 'doctor' ? diagnose(options) : selfTest(options)), null, 2));
    } else if (command === 'configs') {
        if (args.length > 1) throw new Error('Usage: configs [output-directory]');
        const out = path.resolve(args[0] ?? path.join(data, 'client-configs'));
        await exportClients(out);
        console.info(`[FoliaMCP] Client profiles: ${out}`);
    } else if (command === 'connect-codex') {
        await backupCodex();
        console.info(codex(['mcp', 'add', 'folia-style', '--', process.execPath, server]));
    } else if (command === 'disconnect-codex') {
        const entry = JSON.parse(codex(['mcp', 'get', 'folia-style', '--json']));
        const transport = entry.transport;
        if (transport?.command !== process.execPath || transport?.args?.length !== 1 || transport.args[0] !== server) {
            throw new Error('folia-style belongs to another installation; no configuration changed.');
        }
        await backupCodex();
        console.info(codex(['mcp', 'remove', 'folia-style']));
    } else if (command === 'studio') {
        const html = path.join(root, 'studio/StyleStudio.html');
        await readFile(html);
        const child = spawn('explorer.exe', [html], { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', error => console.error('[FoliaMCP] Open Studio failed.', error));
        child.unref();
    } else if (['new', 'pack', 'check'].includes(command)) {
        const entry = path.join(root, `dev/stylePacks/${command}.mjs`);
        process.argv = [process.execPath, entry, ...args];
        await import(`../${command}.mjs`);
    } else if (command === 'help') {
        console.info('Folia Style Tools\n\n  studio\n  doctor | self-test [--http http://127.0.0.1:port/mcp]\n  configs [directory]\n  connect-codex | disconnect-codex\n  serve [--http port]\n  new <directory> [unique.id] [personality|lyric-template]\n  pack <directory> <output.json>\n  check <pack.json>\n\nMCP guidance and validation are read-only; rendering runs in Style Studio.');
    } else throw new Error(`Unknown command: ${command}`);
} catch (error) { console.error('[FoliaMCP] Command failed.', error); process.exitCode = 1; }
