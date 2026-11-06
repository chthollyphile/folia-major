import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { reviewMotion, motionSchema } from '../../../dev/stylePacks/mcp/motionReview.mjs';
import { validate } from '../../../dev/stylePacks/mcp/validation.mjs';
import { RENDERER_PACK } from '../../../src/stylePacks/code/example';

// Exercise actual stdio discovery and bounded, read-only tools as well as trace diagnostics.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = { kind: 'rendered', artifact: 'actual-preview.webm' };
const phrase = (label: string, shape = 0, translation = 0) => ({ label, context: shape ? 'dense' : 'sparse', reason: 'Phrase follows the observed breath and density.',
    samples: Array.from({ length: 9 }, (_, i) => ({ t: i / 2, x: .7 - i / 20 + translation, y: .4 - Math.sin(i / 8 * Math.PI) * (shape ? -.2 : .2) })) });
describe('Folia aesthetic diagnostics', () => {
    it('flags the same arc even when its emitter is translated and a motif is named', () => {
        const input = { source, phrases: Array.from({ length: 5 }, (_, i) => ({ ...phrase(`line ${i}`, 0, i * .01), motif: 'wind' })) };
        validate(input, motionSchema);
        const result = reviewMotion(input);
        expect(result.metrics.similarPairRatio).toBe(1);
        expect(result.warnings.map((item: { code: string }) => item.code)).toContain('repeated-trajectory');
        expect(result.accepted).toBe(false);
        expect(result.artifactVerified).toBe(false);
    });
    it('distinguishes meaningful direction changes without granting artistic approval', () => {
        const result = reviewMotion({ source, phrases: [phrase('verse'), phrase('lift', 1),
            { ...phrase('sustain'), samples: phrase('sustain').samples.map(p => ({ ...p, x: .6, y: p.t * .1 })) },
            { ...phrase('release', 1), samples: phrase('release').samples.map(p => ({ ...p, x: p.t * .16, y: .2 })) }] });
        expect(result.metrics.similarPairRatio).toBe(0);
        expect(result.warnings.some((item: { code: string }) => item.code === 'repeated-trajectory')).toBe(false);
        expect(result.accepted).toBe(false);
    });
    it('retains temporal envelopes instead of comparing only geometry', () => {
        const a = phrase('a'), b = phrase('b');
        b.samples = b.samples.map(p => ({ ...p, t: (p.t / 4) ** 3 * 4 }));
        expect(reviewMotion({ source, phrases: [a, b] }).metrics.similarPairRatio).toBe(0);
    });
    it('reports missing rendered and contextual evidence', () => {
        const result = reviewMotion({ source: { ...source, kind: 'planned' }, phrases: [phrase('a'), phrase('b')] });
        expect(result.warnings.map((item: { code: string }) => item.code)).toEqual(expect.arrayContaining(['not-rendered', 'limited-sample', 'limited-context']));
    });
    it('rejects degenerate timing, non-finite values and oversized input', () => {
        const a = phrase('a'); a.samples[2].t = a.samples[1].t;
        expect(() => reviewMotion({ source, phrases: [a, phrase('b')] })).toThrow(/strictly increase/);
        const b = phrase('b'); b.samples[0].x = Infinity;
        expect(() => validate({ source, phrases: [a, b] }, motionSchema)).toThrow(/finite/);
        expect(() => validate({ source, phrases: Array.from({ length: 33 }, () => a) }, motionSchema)).toThrow(/2..32/);
    });
});

describe('Folia MCP stdio integration', () => {
    let child: ChildProcessWithoutNullStreams, directory: string, sequence = 0;
    let stderr = '';
    const pending = new Map<number, { resolve: (response: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const request = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}; ${stderr}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const call = async (name: string, args: unknown) => (await request('tools/call', { name, arguments: args })).result;
    beforeAll(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'folia-mcp-'));
        // Deliberately use another cwd: resources must resolve against the owning repository.
        child = spawn(process.execPath, [path.join(root, 'dev/stylePacks/mcp/server.mjs')], { cwd: directory, stdio: 'pipe', windowsHide: true });
        child.stderr.on('data', chunk => { stderr += String(chunk); });
        const fail = (error: Error) => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
        child.on('error', fail);
        child.on('exit', code => fail(new Error(`MCP exited ${code}: ${stderr}`)));
        createInterface({ input: child.stdout }).on('line', line => {
            let response;
            try { response = JSON.parse(line); } catch { fail(new Error(`Protocol stdout polluted: ${line}`)); return; }
            const item = pending.get(response.id);
            if (item) { clearTimeout(item.timer); pending.delete(response.id); item.resolve(response); }
        });
    });
    afterAll(async () => {
        if (child && child.exitCode === null) {
            const exit = new Promise<void>(resolve => child.once('exit', () => resolve()));
            child.stdin.end();
            const timer = setTimeout(() => child.kill(), 2000);
            await exit; clearTimeout(timer);
        }
        if (directory) await rm(directory, { recursive: true, force: true });
    });
    it('negotiates only supported versions, advertises guidance and tools', async () => {
        const { result } = await request('initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
        expect(result.protocolVersion).toBe('2025-11-25');
        expect(result.instructions).toContain('folia_style_brief');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const listed = (await request('tools/list')).result.tools;
        expect(listed.map((tool: { name: string }) => tool.name)).toEqual(['folia_style_catalog', 'folia_style_brief', 'folia_style_reference', 'folia_style_review_motion', 'folia_style_check_pack', 'folia_style_read_guide', 'folia_style_status']);
        expect(listed.every((tool: any) => tool.annotations.readOnlyHint && !tool.run)).toBe(true);
    });
    it('loads the actual skill through tools, resources and prompts', async () => {
        const brief = JSON.parse((await call('folia_style_brief', { task: '少女轻快哼唱，流式音符，改善固定轨迹', source: 'wallpaper' })).content[0].text);
        expect(brief.guidance.map((item: { uri: string }) => item.uri)).toContain('folia-style://reconstruction');
        expect(brief.projectRoot.replace(/\\/g, '/')).toBe(root.replace(/\\/g, '/'));
        const listed = (await request('resources/list')).result.resources;
        for (const item of listed) {
            const response = await request('resources/read', { uri: item.uri });
            expect(response.result.contents[0].text.length).toBeGreaterThan(100);
        }
        const prompts = (await request('prompts/list')).result.prompts;
        const prompt = (await request('prompts/get', { name: prompts[0].name, arguments: { task: 'Analyse supplied video', source: 'video' } })).result;
        const guidance = JSON.parse(prompt.messages[0].content.text).guidance;
        expect(guidance.some((item: { uri: string }) => item.uri === 'folia-style://lyric-release')).toBe(true);
        expect((await request('resources/read', { uri: 'file:///private' })).error).toBeDefined();
    });
    it('reads real source with pagination and rejects unexpected inputs', async () => {
        for (const style of ['tempera', 'hanabi', 'lumiere', 'sonnet', 'nebbia']) {
            const result = JSON.parse((await call('folia_style_reference', { style, lineCount: 3 })).content[0].text);
            expect(result.source.split('\n')).toHaveLength(3);
            expect(result.nextLine).toBe(4);
            for (let file = 0; file < result.files.length; file++) {
                expect((await call('folia_style_reference', { style, file })).isError).not.toBe(true);
            }
        }
        for (const args of [{ style: '../../secret' }, { style: 'tempera', lineCount: 161 }, { style: 'sonnet', file: 2 }, { style: 'sonnet', paths: ['/tmp'] }]) {
            expect((await call('folia_style_reference', args)).isError).toBe(true);
        }
        expect((await request('tools/call', { name: 'folia_style_brief', arguments: null })).error).toBeDefined();
        expect((await request('no-such-method')).error.code).toBe(-32601);
    });
    it('diagnoses traces through the protocol and recovers after a tool error', async () => {
        expect((await call('folia_style_review_motion', { source, phrases: [] })).isError).toBe(true);
        const result = JSON.parse((await call('folia_style_review_motion', { source, phrases: [phrase('a'), phrase('b')] })).content[0].text);
        expect(result.metrics.similarPairRatio).toBe(1);
        expect(result.accepted).toBe(false);
    });
    it('uses the real validator, never executes submitted code, and bounds file reads', async () => {
        const file = path.join(directory, 'pack.json');
        await writeFile(file, JSON.stringify({ ...RENDERER_PACK, renderer: { ...RENDERER_PACK.renderer, code: 'throw new Error("must never run")' } }));
        let result = JSON.parse((await call('folia_style_check_pack', { file })).content[0].text);
        expect(result).toMatchObject({ valid: true, accepted: false, execution: 'not run' });
        await writeFile(file, '{"secret":"untrusted", "schemaVersion":99}');
        result = JSON.parse((await call('folia_style_check_pack', { file })).content[0].text);
        expect(result.valid).toBe(false);
        expect(JSON.stringify(result)).not.toContain('untrusted');
        await writeFile(file, 'x'.repeat(4 * 1024 * 1024 + 1));
        expect((await call('folia_style_check_pack', { file })).isError).toBe(true);
        expect((await call('folia_style_check_pack', { file: path.join(directory, 'absent.json') })).isError).toBe(true);
    });
});
