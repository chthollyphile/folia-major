import { open } from 'node:fs/promises';
import path from 'node:path';
import { MAX_PACK_BYTES, parseStylePack } from '../../../src/stylePacks/validate.ts';
import { brief, reference, root, sources, documents, readDocument, installation, catalog } from './content.mjs';
import { STYLE_KINDS, LYRIC_TEMPLATE_IDS, packKind } from '../../../src/stylePacks/catalog.ts';
import { motionSchema, reviewMotion } from './motionReview.mjs';
import { object, string, validate } from './validation.mjs';

// Read-only authoring tools: reuse the actual pack validator, never execute submitted renderer code.
export const briefSchema = object({ task: string(6000), source: { type: 'string', enum: ['original', 'wallpaper', 'video', 'revision'] },
    kind: { type: 'string', enum: STYLE_KINDS }, lyricTemplate: { type: 'string', enum: LYRIC_TEMPLATE_IDS } }, ['task']);
async function checkPack({ file }) {
    const resolved = path.resolve(root, file);
    if (!resolved.toLowerCase().endsWith('.json')) throw new Error('Expected a local .json style pack path.');
    const handle = await open(resolved, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_PACK_BYTES) throw new Error(`Expected a regular file up to ${MAX_PACK_BYTES} bytes.`);
        // Bound the read even if the file changes after stat; no arbitrary host file contents are returned.
        const buffer = Buffer.alloc(MAX_PACK_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break;
            length += bytesRead;
        }
        if (length > MAX_PACK_BYTES) throw new Error('Pack exceeds size limit.');
        let pack;
        try { pack = parseStylePack(buffer.subarray(0, length).toString('utf8')); }
        catch (error) {
            return { valid: false, accepted: false, execution: 'not run', issues: error.issues ?? [{ path: '$', code: 'Invalid pack JSON' }] };
        }
        return { valid: true, accepted: false, id: pack.id, version: pack.version, schemaVersion: pack.schemaVersion,
            kind: packKind(pack), kindDeclared: pack.kind !== undefined, lyricTemplate: pack.lyricTemplate ?? null,
            execution: 'not run', next: 'Load in Style Studio. Complete runtime checks and continuous visual review using folia-style://motion; schema validity is not artistic acceptance.' };
    } finally { await handle.close(); }
}
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const tools = [
    { name: 'folia_style_catalog', description: 'Discover the explicit distinction between complete personalities (个性) and reusable lyric templates (样式), including all 17 built-in references. Random is a playback choice, not a template.',
        inputSchema: object({ kind: { type: 'string', enum: STYLE_KINDS } }, []), run: catalog },
    { name: 'folia_style_brief', description: 'Start here before designing or revising a Folia renderer pack. Loads the embedded aesthetic skill, actual built-in design principles, phrase-motion/visual acceptance rules and wallpaper/video lessons. Does not generate code or render media.', inputSchema: briefSchema, run: brief },
    { name: 'folia_style_reference', description: 'Read the actual source of a built-in personality or lyric template from folia_style_catalog. Returns category, source file list and paginated lines. Adapt framework-dependent source to API 2 instead of importing player code into a pack.', inputSchema: object({
        style: { type: 'string', enum: Object.keys(sources) }, file: { type: 'integer', minimum: 0, maximum: Math.max(...Object.values(sources).map(files => files.length)) - 1 },
        startLine: { type: 'integer', minimum: 1 }, lineCount: { type: 'integer', minimum: 1, maximum: 160 },
    }, ['style']), run: reference },
    { name: 'folia_style_review_motion', description: 'Diagnose repeated lyric trajectories from supplied time samples normalized to viewport width/height. Removes emitter translation and compares shape/relative timing. No media analysis, no automatic aesthetic pass; intentional motifs require visual judgment. Read folia_style_brief first.', inputSchema: motionSchema, run: reviewMotion },
    { name: 'folia_style_check_pack', description: 'Validate a local Folia .json pack using the player schema without executing its renderer. Returns format issues, never artistic acceptance. Follow with Style Studio and the embedded skill visual review.', inputSchema: object({ file: string(4000) }), run: checkPack },
    { name: 'folia_style_read_guide', description: 'Read the full renderer API, specification or embedded aesthetic references through a regular tool. Works without MCP resources/prompts support, including DeepSeek Harness and tools-only clients.', inputSchema: object({ topic: { type: 'string', enum: Object.keys(documents) } }),
        run: async ({ topic }) => ({ topic, uri: `folia-style://${topic}`, text: await readDocument(topic) }) },
    { name: 'folia_style_status', description: 'Check the Folia authoring service runtime and available guidance without launching the player or executing a pack. A healthy MCP connection is separate from renderer validation.', inputSchema: object({}),
        run: async () => ({ service: 'folia-style', node: process.versions.node, projectRoot: root, installation, guides: Object.keys(documents),
            firstTool: 'folia_style_brief', renderer: 'Use Folia Style Studio; this service does not execute renderers.', clientIndependent: true }) },
].map(tool => ({ ...tool, annotations }));
export async function callTool(name, args = {}) {
    const tool = tools.find(item => item.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    validate(args, tool.inputSchema);
    return { content: [{ type: 'text', text: JSON.stringify(await tool.run(args)) }] };
}
