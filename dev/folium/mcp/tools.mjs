import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFoliumShared } from '../api-docs.mjs';
import { brief, reference, root, sources, documents, catalog, guide } from './content.mjs';
import { STYLE_KINDS, LYRIC_TEMPLATE_IDS } from './catalog.mjs';
import { motionSchema, reviewMotion } from './motionReview.mjs';
import { object, string, validate } from './validation.mjs';

// Read-only MCP tools reuse Folium's existing static checker and public documentation.
const runFile = promisify(execFile);
export const briefSchema = object({ task: string(6000), source: { type: 'string', enum: ['original', 'wallpaper', 'video', 'revision'] },
    kind: { type: 'string', enum: STYLE_KINDS }, lyricTemplate: { type: 'string', enum: LYRIC_TEMPLATE_IDS } }, ['task']);
export async function checkMod({ directory }) {
    const result = await runFile(process.execPath, [path.join(root, 'dev/folium/mcp/checkWorker.mjs'), path.resolve(root, directory)],
        { cwd: root, windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(result.stdout);
}
const pageFields = { startLine: { type: 'integer', minimum: 1 }, lineCount: { type: 'integer', minimum: 1, maximum: 240 } };
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const tools = [
    { name: 'folium_catalog', description: 'Discover complete visual personalities and lyric templates as authoring references, plus standard Folium mod examples. Categories do not modify the Folium manifest or player UI.', inputSchema: object({ kind: { type: 'string', enum: STYLE_KINDS } }, []), run: catalog },
    { name: 'folium_brief', description: 'Start a Folium lyric mod task. Load art direction, emission/lifecycle rules and reconstruction lessons; use existing Folium loading and public APIs.', inputSchema: briefSchema, run: brief },
    { name: 'folium_reference', description: 'Read paginated source from the fixed built-in and Folium example allowlist. Adapt visual principles; do not import private player modules.', inputSchema: object({
        style: { type: 'string', enum: Object.keys(sources) }, file: { type: 'integer', minimum: 0, maximum: Math.max(...Object.values(sources).map(files => files.length)) - 1 }, ...pageFields,
    }, ['style']), run: reference },
    { name: 'folium_review_motion', description: 'Diagnose repetition from supplied normalized trajectories. Does not inspect media or award aesthetic acceptance. Read the embedded motion guide first.', inputSchema: motionSchema, run: reviewMotion },
    { name: 'folium_check_mod', description: 'Read a local standard Folium mod directory using the existing host checker, without executing modules. Limits: 16 MiB, 600 entries, 24 levels, no symlinks, 10 seconds. Does not install, sign or enable a mod.', inputSchema: object({ directory: string(4000) }), run: checkMod },
    { name: 'folium_read_guide', description: 'Read official Folium documentation, generated types or art-direction guidance through a paginated tool. Continue at nextLine until null; no resources/prompts support is required.', inputSchema: object({ topic: { type: 'string', enum: Object.keys(documents) }, ...pageFields }, ['topic']), run: guide },
    { name: 'folium_status', description: 'Read service version, Folium contract version and guide availability. Does not launch or control the desktop player.', inputSchema: object({}),
        run: async () => ({ service: 'folium-authoring', node: process.versions.node, projectRoot: root, folium: readFoliumShared().version,
            guides: Object.keys(documents), firstTool: 'folium_brief', runtime: 'Existing desktop Folium mod host. Trusted code, not a sandbox.', clientIndependent: true }) },
].map(tool => ({ ...tool, annotations }));
export async function callTool(name, args = {}) {
    const tool = tools.find(item => item.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    validate(args, tool.inputSchema);
    return { content: [{ type: 'text', text: JSON.stringify(await tool.run(args)) }] };
}
