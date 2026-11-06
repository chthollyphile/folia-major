// Shared authoring catalog: the user's categories describe purpose, not a count of effects or assets.
export type StyleKind = 'personality' | 'lyric-template';
export const STYLE_KINDS = ['personality', 'lyric-template'] as const;
export const LYRIC_TEMPLATE_IDS = ['classic', 'cadenza', 'partita', 'fume', 'tilt', 'claddagh', 'monet', 'pendolo', 'cappella', 'diorama', 'still'] as const;
export type LyricTemplateId = typeof LYRIC_TEMPLATE_IDS[number];
export const BUILTIN_STYLE_CATALOG = [
    { id: 'sonnet', name: '商籁', kind: 'personality', files: ['sonnet/sonnetProgram.ts'] },
    { id: 'tempera', name: '凝彩', kind: 'personality', files: ['tempera/temperaProgram.ts', 'tempera/temperaShotProfiles.ts', 'tempera/temperaCamera.ts'] },
    { id: 'lumiere', name: '绘光', kind: 'personality', files: ['lumiere/catalog.ts', 'lumiere/types.ts', 'lumiere/text/reveal.ts', 'lumiere/text/windowTiming.ts', 'lumiere/text/windowGeometry.ts'] },
    { id: 'hanabi', name: '花火', kind: 'personality', files: ['hanabi/catalog.ts', 'hanabi/types.ts', 'hanabi/text/animations.ts', 'hanabi/text/lyricText.ts'] },
    { id: 'machi', name: '町景', kind: 'personality', files: ['machi/createMachiRuntime.ts', 'machi/engine/lyricScreen.ts', 'machi/shownScene.ts'] },
    { id: 'nebbia', name: '雾笺', kind: 'personality', files: ['nebbia/nebbiaInk.ts', 'nebbia/nebbiaGlyphs.ts', 'nebbia/nebbiaScene.ts'] },
    { id: 'classic', name: '流光', kind: 'lyric-template', files: ['classic/Visualizer.tsx'] },
    { id: 'cadenza', name: '心象', kind: 'lyric-template', files: ['cadenza/VisualizerCadenza.tsx'] },
    { id: 'partita', name: '云阶', kind: 'lyric-template', files: ['partita/partitaLayout.ts', 'partita/PartitaChunk.tsx'] },
    { id: 'fume', name: '浮名', kind: 'lyric-template', files: ['fume/useFumeCanvasStage.ts', 'fume/fumeTextStyle.ts'] },
    { id: 'tilt', name: '倾诉', kind: 'lyric-template', files: ['tilt/VisualizerTilt.tsx'] },
    { id: 'claddagh', name: '回环', kind: 'lyric-template', files: ['claddagh/claddaghTimeline.ts', 'claddagh/claddaghLayout.ts', 'claddagh/CladdaghRingLine.tsx'] },
    { id: 'monet', name: '莫奈', kind: 'lyric-template', files: ['monet/monetLyricsModel.ts', 'monet/monetLyricMotion.ts', 'monet/MonetLyricsRail.tsx'] },
    { id: 'pendolo', name: '时计', kind: 'lyric-template', files: ['pendolo/pendoloTimeline.ts', 'pendolo/pendoloTextLayout.ts', 'pendolo/PendoloRotatingLine.tsx'] },
    { id: 'cappella', name: '群唱', kind: 'lyric-template', files: ['cappella/VisualizerCappella.tsx'] },
    { id: 'diorama', name: '镜台', kind: 'lyric-template', files: ['diorama/dioramaSequencer.ts', 'diorama/dioramaSceneUnits.ts', 'diorama/dioramaTextRaster.ts'] },
    { id: 'still', name: '静止', kind: 'lyric-template', files: ['still/VisualizerStill.tsx'] },
] as const;

export function builtinStyle(id: string) { return BUILTIN_STYLE_CATALOG.find(item => item.id === id); }
/** Old packs remain byte-for-byte compatible; the fallback never rewrites the saved object. */
export function packKind(pack: { kind?: StyleKind }): StyleKind { return pack.kind ?? 'personality'; }
export function styleGroup(id: string): StyleKind | 'other' { return builtinStyle(id)?.kind ?? 'other'; }
