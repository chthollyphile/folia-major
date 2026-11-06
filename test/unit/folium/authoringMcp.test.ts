import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkFoliumMod } from '../../../dev/folium/check.mjs';
import { root, documents, sources } from '../../../dev/folium/mcp/content.mjs';
import { callTool } from '../../../dev/folium/mcp/tools.mjs';
import { BUILTIN_VISUALIZER_MODES } from '../../../src/types/visualizerModes';

// Exercise the real stdio protocol and compare the MCP checker against Folium's existing implementation.
describe('Folium authoring MCP', () => {
    let directory: string, transport: StdioClientTransport, client: Client;
    const call = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
        return JSON.parse((result.content as { text: string }[])[0].text);
    };
    beforeAll(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'folium-mcp-test-'));
        client = new Client({ name: 'independent-folium-test', version: '1' }, { capabilities: {} });
        transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dev/folium/mcp/server.mjs')], cwd: directory, stderr: 'pipe' });
        await client.connect(transport);
    });
    afterAll(async () => {
        await client?.close(); await transport?.close();
        if (directory && path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('folium-mcp-test-')) {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it('discovers a read-only service tied to the real Folium contract', async () => {
        const listed = await client.listTools();
        expect(listed.tools.map(tool => tool.name)).toContain('folium_check_mod');
        expect(listed.tools).toHaveLength(7);
        expect(listed.tools.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
        const status = await call('folium_status');
        expect(status.projectRoot).toBe(root);
        expect(status.folium).toMatchObject({ major: 1, minor: 8 });
        expect(status.runtime).toContain('not a sandbox');
    });
    it('serves official guides without losing pages or substituting a custom renderer API', async () => {
        for (const topic of Object.keys(documents) as (keyof typeof documents)[]) {
            const chunks: string[] = []; let startLine: number | null = 1;
            while (startLine !== null) {
                const page = await call('folium_read_guide', { topic, startLine, lineCount: 240 });
                chunks.push(page.text); startLine = page.nextLine;
            }
            expect(chunks.join('\n')).toBe(await readFile(path.join(root, documents[topic].path), 'utf8'));
        }
    });
    it('provides equivalent guidance via tools, resources and prompts', async () => {
        const result = await call('folium_brief', { task: '从女孩附近流出真实字形，落定后到 N+2 退场', source: 'wallpaper' });
        expect(result.commands.create).toContain('folium:new');
        expect(result.contract).toBe('folium-authoring://types');
        expect(result.guidance.map((item: { topic: string }) => item.topic)).toContain('lyric-release');
        expect(result.guidance[0].text).toContain('不要因为');
        for (const resource of (await client.listResources()).resources) {
            const response = await client.readResource({ uri: resource.uri });
            const content = response.contents[0];
            expect('text' in content ? content.text : undefined).toBe(await readFile(path.join(root, documents[resource.name as keyof typeof documents].path), 'utf8'));
        }
        const prompt = await client.getPrompt({ name: 'folium_director', arguments: { task: 'Test', source: 'video' } });
        expect(prompt.messages[0].content.type).toBe('text');
        await expect(client.readResource({ uri: 'file:///private' })).rejects.toThrow();
    });
    it('catalogs every existing built-in once and serves real standard mod references', async () => {
        const catalog = await call('folium_catalog');
        expect(catalog.entries.map((item: { id: string }) => item.id).sort()).toEqual([...BUILTIN_VISUALIZER_MODES].sort());
        expect((await call('folium_catalog', { kind: 'personality' })).entries).toHaveLength(6);
        expect((await call('folium_catalog', { kind: 'lyric-template' })).entries).toHaveLength(11);
        for (const [style, files] of Object.entries(sources) as [string, string[]][]) {
            for (let file = 0; file < files.length; file++) {
                const page = await call('folium_reference', { style, file, lineCount: 3 });
                expect(page.text).toBe((await readFile(path.join(root, files[file]), 'utf8')).split('\n').slice(0, 3).join('\n'));
            }
        }
    });
    it('reuses checker findings and does not execute or modify submitted client code', async () => {
        const sentinel = path.join(directory, 'executed.txt');
        await writeFile(path.join(directory, 'mod.json'), JSON.stringify({ folium: 1, id: 'mcp-test', version: '0.1.0', name: 'Test', client: 'client.mjs' }));
        const source = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'bad'); export default function activate(folium) { folium.registries.stageLayers.register({}); }`;
        await writeFile(path.join(directory, 'client.mjs'), source);
        const direct = checkFoliumMod(directory), report = await call('folium_check_mod', { directory });
        expect(report.valid).toBe(direct.ok); expect(report.issues).toEqual(direct.problems);
        expect(report.issues.join(' ')).toContain('stageLayers'); expect(report.accepted).toBe(false);
        await expect(stat(sentinel)).rejects.toThrow();
        expect(await readFile(path.join(directory, 'client.mjs'), 'utf8')).toBe(source);
        await writeFile(path.join(directory, 'client.mjs'), 'export default function activate(folium) { folium.registries.visualizers.register({}); }');
        expect((await call('folium_check_mod', { directory })).valid).toBe(true);
    });
    it('bounds local analysis before invoking the existing scanner', async () => {
        await writeFile(path.join(directory, 'large.bin'), Buffer.alloc(16 * 1024 * 1024));
        const report = await call('folium_check_mod', { directory });
        expect(report.valid).toBe(false); expect(report.issues.join(' ')).toContain('16 MiB');
    });
    it('rejects unknown fields, paths disguised as guide keys and invalid pagination', async () => {
        for (const [name, args] of [
            ['folium_status', { token: 'unwanted' }], ['folium_read_guide', { topic: '../../private' }],
            ['folium_read_guide', { topic: 'api', startLine: 0 }], ['folium_reference', { style: 'still', file: 99 }],
            ['folium_check_mod', { directory: '' }],
        ] as const) expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
    });
    it('diagnoses a translated repeated trajectory without granting visual approval', async () => {
        const phrases = Array.from({ length: 4 }, (_, i) => ({ label: String(i), context: 'verse', reason: 'observed breath',
            samples: Array.from({ length: 5 }, (_, j) => ({ t: j, x: j / 10 + i / 20, y: Math.sin(j) / 10 })) }));
        const result = JSON.parse((await callTool('folium_review_motion', { source: { kind: 'planned', artifact: 'plan' }, phrases })).content[0].text);
        expect(result.metrics.similarPairRatio).toBe(1); expect(result.accepted).toBe(false);
        expect(result.artifactVerified).toBe(false);
    });
});
