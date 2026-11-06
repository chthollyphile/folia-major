import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BUILTIN_STYLE_CATALOG, LYRIC_TEMPLATE_IDS, packKind, styleGroup } from '../../../src/stylePacks/catalog';
import { BUILTIN_VISUALIZER_MODES } from '../../../src/types/visualizerModes';
import { parseStylePack, formatStylePack } from '../../../src/stylePacks/validate';
import { RENDERER_PACK } from '../../../src/stylePacks/code/example';
import { LYRIC_TEMPLATE_PACK } from '../../../src/stylePacks/code/lyricTemplate';
import { EXAMPLE_PACK } from '../../../src/stylePacks/example';
import { callTool } from '../../../dev/stylePacks/mcp/tools.mjs';

// Classify by the user's intended role while keeping older files and the player's stored IDs stable.
describe('personality and lyric-template contract', () => {
    it('covers each built-in exactly once, without treating random or the pack library as a template', () => {
        expect(BUILTIN_STYLE_CATALOG.map(item => item.id).sort()).toEqual(BUILTIN_VISUALIZER_MODES.filter(id => id !== 'stylePack').sort());
        expect(BUILTIN_STYLE_CATALOG.filter(item => item.kind === 'personality').map(item => item.id)).toEqual(['sonnet', 'tempera', 'lumiere', 'hanabi', 'machi', 'nebbia']);
        expect(BUILTIN_STYLE_CATALOG.filter(item => item.kind === 'lyric-template').map(item => item.id)).toEqual([...LYRIC_TEMPLATE_IDS]);
        expect(styleGroup('random')).toBe('other'); expect(styleGroup('stylePack')).toBe('other'); expect(styleGroup('mod:custom:scene')).toBe('other');
        for (const item of BUILTIN_STYLE_CATALOG) for (const file of item.files) expect(existsSync(path.join('src/components/visualizer', file)), file).toBe(true);
    });
    it('round trips new metadata and leaves legacy v1/v2 files unchanged', () => {
        for (const sample of [EXAMPLE_PACK, RENDERER_PACK]) {
            const text = formatStylePack(sample), parsed = parseStylePack(text);
            expect(formatStylePack(parsed)).toBe(text); expect(parsed.kind).toBeUndefined(); expect(packKind(parsed)).toBe('personality');
            const typed = { ...sample, kind: 'personality', lyricTemplate: 'diorama' };
            expect(parseStylePack(JSON.stringify(typed))).toEqual(typed);
            for (const value of [{ kind: 'unknown' }, { kind: null }, { lyricTemplate: 'tempera' }, { lyricTemplate: 'random' }]) {
                expect(() => parseStylePack(JSON.stringify({ ...sample, ...value }))).toThrow();
            }
        }
        expect(parseStylePack(JSON.stringify(LYRIC_TEMPLATE_PACK)).kind).toBe('lyric-template');
    });
    it('serves filtered catalogs and category-aware briefs through real tool validation', async () => {
        const templates = JSON.parse((await callTool('folia_style_catalog', { kind: 'lyric-template' })).content[0].text);
        expect(templates.entries).toHaveLength(11);
        const result = JSON.parse((await callTool('folia_style_brief', { task: 'test', kind: 'personality', lyricTemplate: 'classic' })).content[0].text);
        expect(result.kind).toBe('personality'); expect(result.lyricTemplate).toBe('classic');
        expect(result.guidance.some((item: { uri: string }) => item.uri === 'folia-style://taxonomy')).toBe(true);
        await expect(callTool('folia_style_brief', { task: 'test', lyricTemplate: 'hanabi' })).rejects.toThrow();
        await expect(callTool('folia_style_catalog', { kind: 'random' })).rejects.toThrow();
    });
});
