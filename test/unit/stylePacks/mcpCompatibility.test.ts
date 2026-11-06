import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createClientProfiles } from '../../../dev/stylePacks/mcp/clientProfiles.mjs';
import { startHttpServer } from '../../../dev/stylePacks/mcp/http.mjs';
import { diagnose } from '../../../dev/stylePacks/mcp/diagnose.mjs';

// Verify real SDK interop and isolation, not just the spelling of configuration examples.
describe('Folia client profiles', () => {
    const profiles: Record<string, string> = createClientProfiles();
    for (const name of ['claude-code', 'claude-desktop', 'workbuddy', 'generic']) {
        it(`launches the ${name} stdio command via an independent SDK client`, async () => {
            const entry = JSON.parse(profiles[`${name}.stdio.json`]).mcpServers['folia-style'];
            const result = await diagnose({ command: entry.command, args: entry.args });
            expect(result.connected).toBe(true);
            expect(result.apiGuideAvailable).toBe(true);
            expect(result.tools).toHaveLength(7);
        });
    }
    it('serializes distinct HTTP transport conventions and never embeds credentials', () => {
        const claude = JSON.parse(profiles['claude-code.http.json']).mcpServers['folia-style'];
        const buddy = JSON.parse(profiles['workbuddy.http.json']).mcpServers['folia-style'];
        expect(claude.type).toBe('http'); expect(buddy.type).toBe('streamableHttp');
        expect(claude.headers.Authorization).toBe('Bearer ${FOLIA_MCP_TOKEN}');
        expect(profiles['deepseek-harness.http.yaml']).toContain('transport: streamable-http');
        expect(profiles['deepseek-harness.http.yaml']).toContain('process.env.FOLIA_MCP_TOKEN');
        expect(profiles['codex.http.toml']).toContain('bearer_token_env_var = "FOLIA_MCP_TOKEN"');
        expect(profiles['claude-desktop.http.json']).toBeUndefined();
    });
    it('rejects relative launchers and URLs that could leak a bearer token', async () => {
        expect(() => createClientProfiles({ node: 'node' })).toThrow(/absolute/);
        for (const url of ['https://example.com/mcp', 'http://127.0.0.1/mcp?token=x', 'http://user:pass@127.0.0.1/mcp']) {
            expect(() => createClientProfiles({ url })).toThrow();
            await expect(diagnose({ url })).rejects.toThrow();
        }
    });
});

describe('Folia Streamable HTTP', () => {
    const token = randomBytes(32).toString('hex');
    let http: Awaited<ReturnType<typeof startHttpServer>>;
    const clients: Client[] = [];
    const client = async (name: string) => {
        const instance = new Client({ name, version: '1' }, { capabilities: {} });
        clients.push(instance);
        await instance.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
        return instance;
    };
    beforeAll(async () => { http = await startHttpServer({ port: 0, token }); });
    afterAll(async () => { await Promise.all(clients.map(c => c.close())); await http.close(); });
    it('serves concurrent clients with tools-only capability and survives one disconnect', async () => {
        const [a, b] = await Promise.all([client('client-a'), client('client-b')]);
        const responses = await Promise.all([a.callTool({ name: 'folia_style_brief', arguments: { task: 'wallpaper-a', source: 'wallpaper' } }),
            b.callTool({ name: 'folia_style_brief', arguments: { task: 'video-b', source: 'video' } })]);
        const data = responses.map(r => JSON.parse((r.content as { text: string }[])[0].text));
        expect(data[0].task).toBe('wallpaper-a'); expect(data[1].task).toBe('video-b');
        await a.close();
        const guide = await b.callTool({ name: 'folia_style_read_guide', arguments: { topic: 'renderer-api' } });
        expect(JSON.parse((guide.content as { text: string }[])[0].text).text).toContain('FoliaStyle');
        expect((await b.listTools()).tools).toHaveLength(7);
        const report = await diagnose({ url: http.url, token });
        expect(report.apiGuideAvailable).toBe(true);
    });
    it('requires authentication and blocks browser origins and rebinding hosts', async () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
        expect((await fetch(http.url, { method: 'POST', body })).status).toBe(401);
        expect((await fetch(http.url, { method: 'POST', body, headers: { ...headers, Origin: 'https://example.com' } })).status).toBe(403);
        // Node fetch replaces Host; use a raw HTTP request to actually exercise rebinding protection.
        const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
            const request = httpRequest(http.url, { method: 'POST', headers: { ...headers, Host: 'evil.example' } }, response => {
                response.resume(); resolve(response.statusCode);
            });
            request.on('error', reject); request.end(body);
        });
        expect(hostileHostStatus).toBe(403);
        expect((await fetch(http.url, { headers })).status).toBe(405);
        expect((await fetch(http.url, { method: 'POST', headers, body: '{' })).status).toBe(400);
        const response = await fetch(http.url, { method: 'POST', headers, body: 'x'.repeat(2 * 1024 * 1024 + 1) });
        expect(response.status).toBe(413);
        expect((await diagnose({ url: http.url, token })).connected).toBe(true);
    });
    it('rejects unusable HTTP startup configuration', async () => {
        await expect(startHttpServer({ port: -1, token })).rejects.toThrow(/port/);
        await expect(startHttpServer({ port: 0, token: 'short' })).rejects.toThrow(/FOLIA_MCP_TOKEN/);
    });
});
