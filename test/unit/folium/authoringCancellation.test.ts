import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../../../dev/folium/mcp/http.mjs';

// Hold work until its server-side signal fires: natural checker completion cannot satisfy this regression.
const pending = vi.hoisted(() => new Map<string, { signal: AbortSignal; finish: () => void }>());
vi.mock('../../../dev/folium/mcp/tools.mjs', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../dev/folium/mcp/tools.mjs')>();
    return { ...actual, callTool: async (name: string, args: { directory: string }, context: { signal: AbortSignal }) => {
        if (name !== 'folium_check_mod') return actual.callTool(name, args, context);
        await new Promise<void>(resolve => {
            pending.set(args.directory, { signal: context.signal, finish: resolve });
            context.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { content: [{ type: 'text', text: '{}' }] };
    } };
});

it('routes SDK cancellation to the original session without cancelling an equal request ID in another client', async () => {
    const token = 'c'.repeat(64), http = await startHttpServer({ port: 0, token });
    const clients: Client[] = [];
    try {
        for (const name of ['a', 'b']) {
            const client = new Client({ name, version: '1' }, { capabilities: {} }); clients.push(client);
            await client.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
        }
        const controller = new AbortController();
        const a = clients[0].callTool({ name: 'folium_check_mod', arguments: { directory: 'a' } }, undefined, { signal: controller.signal });
        const rejected = expect(a).rejects.toThrow();
        const b = clients[1].callTool({ name: 'folium_check_mod', arguments: { directory: 'b' } });
        await vi.waitFor(() => expect(pending.size).toBe(2));
        controller.abort(); await rejected;
        await vi.waitFor(() => expect(pending.get('a')?.signal.aborted).toBe(true));
        expect(pending.get('b')?.signal.aborted).toBe(false);
        pending.get('b')!.finish(); await b;
    } finally {
        for (const job of pending.values()) job.finish(); pending.clear();
        await Promise.all(clients.map(client => client.close())); await http.close();
    }
});
