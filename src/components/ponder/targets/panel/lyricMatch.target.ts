import { LYRIC_MATCH_GEOMETRY as G, lyricMatchRowRect } from '../../surfaces/panel/lyricMatch.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/lyricMatch.target.ts
// 匹配歌词的窗口：面板来源页的「在线匹配」打开它，给当前这首歌手动挑一份歌词。
//
// 单独成目标的理由：窗口一打开就已经搜过一遍，看起来像「结果就这些」，其实来源可以换、字可以改；
// 选一条之前保存是灰的，而右下那一块歌词预览要选了才有；给本地文件匹配时又多出三个开关，
// 决定这一条的封面、元数据、歌词各用不用。
//
// 几何来自 lyricMatch.geometry，和 lyricMatch.surface.tsx 画的是同一组数。

const panel = {
    kind: 'synthetic',
    // aspect 是 622 ÷ 1024：窗口里那张正方形封面按宽度定大小，不锁比例的话它会压到按高度定位的名字上。
    rect: { left: 0.5, top: 0.07, width: 0.62, height: 0.62, aspect: 0.607, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'lyric-match',
    labelKey: 'ponder.anchors.lyricMatch.window',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string, from = 'panel'): PonderAnchorSource => (
    { kind: 'relative', from, rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    header: region(G.heading, 'ponder.anchors.lyricMatch.header'),
    sources: region(G.sources, 'ponder.anchors.lyricMatch.sources'),
    search: region(G.search, 'ponder.anchors.lyricMatch.search'),
    results: region(G.results, 'ponder.anchors.lyricMatch.results'),
    firstResult: region(lyricMatchRowRect(0), 'ponder.anchors.lyricMatch.results', 'results'),
    chosen: region(G.chosen, 'ponder.anchors.lyricMatch.chosen'),
    lyrics: region(G.lyrics, 'ponder.anchors.lyricMatch.lyrics'),
    save: region(G.save, 'ponder.anchors.lyricMatch.save'),
    switches: region(G.switches, 'ponder.anchors.lyricMatch.switches'),
    noMatch: region(G.noMatch, 'ponder.anchors.lyricMatch.noMatch'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：这是给哪首歌找歌词，来源可以换，字可以改了再搜。 */
const search: PonderSceneScript = {
    id: 'lyric-match-search',
    titleKey: 'ponder.scenes.lyricMatchSearch',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markHeader', anchor: 'header', intensity: [0, 0.6], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'where',
            textKey: 'ponder.captions.lyricMatch.where',
            pointTo: { anchor: 'header' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readWhere' },

        { kind: 'highlight', id: 'dimHeader', anchor: 'header', intensity: [0.6, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markSources', anchor: 'sources', intensity: [0, 0.7], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'sources',
            textKey: 'ponder.captions.lyricMatch.sources',
            pointTo: { anchor: 'sources' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readSources' },

        { kind: 'highlight', id: 'dimSources', anchor: 'sources', intensity: [0.7, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markSearch', anchor: 'search', intensity: [0, 0.6], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'search',
            textKey: 'ponder.captions.lyricMatch.search',
            pointTo: { anchor: 'search' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readSearch' },
    ],
};

/** 第二章：结果里点一条，右边换成它、下面出歌词；看过了再保存。 */
const pick: PonderSceneScript = {
    id: 'lyric-match-pick',
    titleKey: 'ponder.scenes.lyricMatchPick',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markResults', anchor: 'results', intensity: [0, 0.4], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'results',
            textKey: 'ponder.captions.lyricMatch.results',
            pointTo: { anchor: 'results' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readResults' },

        { kind: 'highlight', id: 'dimResults', anchor: 'results', intensity: [0.4, 0], durationMs: 380, keyframe: true },
        { kind: 'cursor', id: 'pickResult', to: { anchor: 'firstResult' }, press: 'tap', durationMs: 660, withPrevious: true },
        { kind: 'surfaceState', id: 'picked', anchor: 'panel', state: 'picked', durationMs: 460 },
        { kind: 'highlight', id: 'markLyrics', anchor: 'lyrics', intensity: [0, 0.5], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'preview',
            textKey: 'ponder.captions.lyricMatch.preview',
            pointTo: { anchor: 'lyrics' }, durationMs: 7200, withPrevious: true,
        },
        { kind: 'pause', id: 'readPreview' },

        { kind: 'highlight', id: 'dimLyrics', anchor: 'lyrics', intensity: [0.5, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markSave', anchor: 'save', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'save',
            textKey: 'ponder.captions.lyricMatch.save',
            pointTo: { anchor: 'save' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readSave' },
    ],
};

/** 第三章：给本地文件匹配时多出来的三个开关，和底边左端那颗「不使用在线数据」。 */
const localFile: PonderSceneScript = {
    id: 'lyric-match-local',
    titleKey: 'ponder.scenes.lyricMatchLocal',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'asLocalFile', anchor: 'panel', state: 'local-file', durationMs: 460, keyframe: true },
        { kind: 'highlight', id: 'markSwitches', anchor: 'switches', intensity: [0, 0.8], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'switches',
            textKey: 'ponder.captions.lyricMatch.switches',
            pointTo: { anchor: 'switches' }, durationMs: 7600, withPrevious: true,
        },
        { kind: 'pause', id: 'readSwitches' },

        { kind: 'highlight', id: 'dimSwitches', anchor: 'switches', intensity: [0.8, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markNoMatch', anchor: 'noMatch', intensity: [0, 0.8], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'noMatch',
            textKey: 'ponder.captions.lyricMatch.noMatch',
            pointTo: { anchor: 'noMatch' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readNoMatch' },
    ],
};

export default {
    id: 'lyric-match',
    titleKey: 'ponder.targets.lyricMatch',
    category: 'playback',
    summaryKey: 'ponder.summaries.lyric_match',
    hoverSelector: '[data-ponder="lyric-match"]',
    relatedTargetIds: ['panel-source-tab', 'lyrics-settings'],
    scenes: [search, pick, localFile],
} satisfies PonderTargetDefinition;
