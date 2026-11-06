import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './content.mjs';

// SDK interoperability probe, independent of model accounts or API keys; never render submitted code.
export async function diagnose({ url = '', command = process.execPath, args = [path.join(root, 'dev/folium/mcp/server.mjs')], token = process.env.FOLIUM_MCP_TOKEN } = {}) {
    if (url) {
        const endpoint = new URL(url);
        if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error('Doctor only connects to http://127.0.0.1:<port>/mcp.');
        if (!token) throw new Error('FOLIUM_MCP_TOKEN is required for HTTP diagnosis.');
    }
    const client = new Client({ name: 'folia-compatibility-doctor', version: '1.0.0' }, { capabilities: {} });
    const transport = url ? new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
        : new StdioClientTransport({ command, args, stderr: 'pipe' });
    const timeout = setTimeout(() => { void client.close(); void transport.close(); }, 15000);
    try {
        await client.connect(transport);
        const definitions = await client.listTools();
        const status = await client.callTool({ name: 'folium_status', arguments: {} });
        const guide = await client.callTool({ name: 'folium_read_guide', arguments: { topic: 'api' } });
        if (status.isError || guide.isError) throw new Error('Folia status/API tools returned an error.');
        return { connected: true, transport: url ? 'streamable-http' : 'stdio', server: client.getServerVersion(),
            tools: definitions.tools.map(tool => tool.name), status: JSON.parse(status.content[0].text),
            apiGuideAvailable: JSON.parse(guide.content[0].text).text.includes('Folium'),
            scope: 'SDK transport and tool calls verified; not a model-turn or visual-quality test.' };
    } finally { clearTimeout(timeout); await client.close(); await transport.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2);
        if (args.length && (args.length !== 2 || args[0] !== '--http')) throw new Error('Usage: diagnose.mjs [--http http://127.0.0.1:<port>/mcp]');
        console.info(JSON.stringify(await diagnose(args.length ? { url: args[1] } : {}), null, 2));
    } catch (error) {
        console.error('[FoliumMCP] Connection diagnosis failed.', error);
        console.error(JSON.stringify({ connected: false, error: error.message }));
        process.exitCode = 1;
    }
}
