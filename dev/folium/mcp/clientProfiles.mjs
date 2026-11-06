import path from 'node:path';
import { root } from './content.mjs';

// Client-specific serialization stays outside the MCP service and never edits a user's config.
export function createClientProfiles({ node = process.execPath, server = path.join(root, 'dev/folium/mcp/server.mjs'), url = 'http://127.0.0.1:43197/mcp' } = {}) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
        throw new Error('Use a local http://127.0.0.1:<port>/mcp URL.');
    }
    if (!path.isAbsolute(node) || !path.isAbsolute(server)) throw new Error('Node and server paths must be absolute.');
    const command = { command: node, args: [server] };
    const headers = { Authorization: 'Bearer ${FOLIUM_MCP_TOKEN}' };
    const wrap = entry => ({ mcpServers: { 'folium-authoring': entry } });
    const json = value => JSON.stringify(value, null, 2) + '\n';
    // JSON quoted strings are valid YAML scalars and TOML basic strings, including Windows paths.
    const quote = value => JSON.stringify(value);
    const dsh = transport => '- id: mcp-folium-authoring\n  name: "@deepseek-ai/dsh-mcp-client"\n  config:\n    serverName: folium-authoring\n'
        + (transport === 'stdio' ? `    transport: stdio\n    command: ${quote(node)}\n    args: [${quote(server)}]\n`
            : `    transport: streamable-http\n    url: ${quote(url)}\n    headers:\n      Authorization: !!js '\`Bearer \${process.env.FOLIUM_MCP_TOKEN}\`'\n`)
        + '    startupTimeoutMs: 30000\n    toolCallTimeoutMs: 30000\n';
    return {
        'codex.stdio.toml': `[mcp_servers.folium-authoring]\ncommand = ${quote(node)}\nargs = [${quote(server)}]\nstartup_timeout_sec = 30\ntool_timeout_sec = 30\n`,
        'codex.http.toml': `[mcp_servers.folium-authoring]\nurl = ${quote(url)}\nbearer_token_env_var = "FOLIUM_MCP_TOKEN"\nstartup_timeout_sec = 30\ntool_timeout_sec = 30\n`,
        'claude-code.stdio.json': json(wrap({ type: 'stdio', ...command })),
        'claude-code.http.json': json(wrap({ type: 'http', url, headers })),
        'claude-desktop.stdio.json': json(wrap(command)),
        'workbuddy.stdio.json': json(wrap({ type: 'stdio', ...command, timeout: 30000 })),
        'workbuddy.http.json': json(wrap({ type: 'streamableHttp', url, headers, timeout: 30000 })),
        'deepseek-harness.stdio.yaml': dsh('stdio'),
        'deepseek-harness.http.yaml': dsh('http'),
        'generic.stdio.json': json(wrap(command)),
    };
}
