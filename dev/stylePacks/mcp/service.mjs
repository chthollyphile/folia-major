import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
    ListResourceTemplatesRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { brief, readResource, resources } from './content.mjs';
import { callTool, tools, briefSchema } from './tools.mjs';
import { validate } from './validation.mjs';

// One SDK service for every client; no Codex/Claude-specific branches in tool behavior.
export const serverInfo = { name: 'folia-style', version: '1.2.0' };
const instructions = 'For Folia lyric styles start with folia_style_brief, which loads the embedded art-direction skill. Distinguish complete personalities (个性) from reusable lyric templates (样式) with folia_style_catalog; random is a playback choice. Choose glyph, line or assemble release from observed artwork traits using lyric-release guidance; couple emitter speed to lyric timing and keep instrumental motion slow. Use folia_style_read_guide for the full API and references even without resources or prompts support. Inspect built-in source and watch continuous previews. Validation and diagnostics never certify artistic quality.';
const prompt = { name: 'folia_style_director', description: 'Load Folia art direction and prepare a source-aware renderer task.',
    arguments: [{ name: 'task', description: 'User request and intended visual effect', required: true }, { name: 'source', description: 'original, wallpaper, video or revision', required: false },
        { name: 'kind', description: 'personality or lyric-template', required: false }, { name: 'lyricTemplate', description: 'Optional built-in lyric-template ID from folia_style_catalog', required: false }] };
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
