import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
    ListResourceTemplatesRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { brief, readResource, resources } from './content.mjs';
import { callTool, tools, briefSchema } from './tools.mjs';
import { validate } from './validation.mjs';

// One SDK service for every client; no Codex/Claude-specific branches in tool behavior.
export const serverInfo = { name: 'folium-authoring', version: '0.1.0' };
const instructions = 'Start with folium_brief and the official quickstart/API/specification guides. Use the existing desktop Folium mod host, manifest and public lifecycle APIs; do not create another player loader or import private player modules. folium_catalog categories are authoring labels only. Use folium_read_guide pagination even without resources/prompts support. Choose glyph/line/assemble release from the artwork; freeze settled glyph anchors and retire at N+2. Static checks and motion diagnostics never certify runtime behavior or artistic quality. Folium runs trusted code, not a sandbox.';
const prompt = { name: 'folium_director', description: 'Load Folia art direction and prepare a source-aware renderer task.',
    arguments: [{ name: 'task', description: 'User request and intended visual effect', required: true }, { name: 'source', description: 'original, wallpaper, video or revision', required: false },
        { name: 'kind', description: 'personality or lyric-template', required: false }, { name: 'lyricTemplate', description: 'Optional built-in lyric-template ID from folium_catalog', required: false }] };
export function createFoliaServer() {
    const server = new Server(serverInfo, { instructions, capabilities: { tools: {}, resources: {}, prompts: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(({ run, ...definition }) => definition) }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
        try { return await callTool(request.params.name, request.params.arguments); }
        catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
    });
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
    server.setRequestHandler(ReadResourceRequestSchema, async request => {
        try { return await readResource(request.params.uri); }
        catch (error) { throw new McpError(ErrorCode.InvalidParams, error.message); }
    });
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [prompt] }));
    server.setRequestHandler(GetPromptRequestSchema, async request => {
        try {
            if (request.params.name !== prompt.name) throw new Error('Unknown prompt.');
            validate(request.params.arguments, briefSchema);
            return { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(await brief(request.params.arguments)) } }] };
        } catch (error) { throw new McpError(ErrorCode.InvalidParams, error.message); }
    });
    return server;
}
