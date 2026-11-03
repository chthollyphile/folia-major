import { LYRIC_EXPORT_GEOMETRY as E } from '../../surfaces/command/lyricExport.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/command/lyricExport.target.ts
// 命令面板里「导出歌词缓存」那一页。
//
// 这一页值得讲的不是开关本身，而是三件界面上看不出来的事：
// 1. 导出的是「播放时实际显示的那一份」—— 自己导入或手动匹配的歌词优先，纯音乐直接跳过；
// 2. 两种格式不是同一份东西换个扩展名：.fia 连分词和背景和声一起留下，LRC 会丢；
// 3. 在线歌词缓存本身不带歌名：播放时顺手记下的歌名最先用，其次是本机缓存过的歌单，最后才联网去问。
// 另外，这一页关掉就等于取消，导出不在后台继续跑。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.12, width: 0.44, height: 0.66, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'lyric-export',
    labelKey: 'ponder.anchors.lyricExport.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    card: region(E.card, 'ponder.anchors.lyricExport.card'),
    scope: region(E.scope, 'ponder.anchors.lyricExport.scope'),
    formats: region(E.formats, 'ponder.anchors.lyricExport.formats'),
    names: region(E.names, 'ponder.anchors.lyricExport.names'),
    run: region(E.run, 'ponder.anchors.lyricExport.run'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：导出的是哪些歌、哪一份歌词。 */
const scope: PonderSceneScript = {
    id: 'lyric-export-scope',
    titleKey: 'ponder.scenes.lyricExportScope',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markCard', anchor: 'card', intensity: [0, 0.5], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'whatItIs',
            textKey: 'ponder.captions.lyricExport.whatItIs',
            pointTo: { anchor: 'card' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readWhatItIs' },

        { kind: 'highlight', id: 'dimCard', anchor: 'card', intensity: [0.5, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markScope', anchor: 'scope', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'effective',
            textKey: 'ponder.captions.lyricExport.effective',
            pointTo: { anchor: 'scope' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readEffective' },
    ],
};

/** 第二章：两种格式的取舍、文件名从哪来，以及关掉就是取消。 */
const formats: PonderSceneScript = {
    id: 'lyric-export-formats',
    titleKey: 'ponder.scenes.lyricExportFormats',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markFormats', anchor: 'formats', intensity: [0, 0.85], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'formats',
            textKey: 'ponder.captions.lyricExport.formats',
            pointTo: { anchor: 'formats' }, durationMs: 7200, withPrevious: true,
        },
        { kind: 'pause', id: 'readFormats' },

        { kind: 'highlight', id: 'dimFormats', anchor: 'formats', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markNames', anchor: 'names', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'names',
            textKey: 'ponder.captions.lyricExport.names',
            pointTo: { anchor: 'names' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readNames' },

        { kind: 'highlight', id: 'dimNames', anchor: 'names', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'cursor', id: 'pressRun', to: { anchor: 'run', x: 0.9 }, press: 'tap', durationMs: 620, withPrevious: true },
        { kind: 'surfaceState', id: 'startRun', anchor: 'panel', state: 'running', durationMs: 460 },
        { kind: 'highlight', id: 'markRun', anchor: 'run', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'running',
            textKey: 'ponder.captions.lyricExport.running',
            pointTo: { anchor: 'run' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readRunning' },
    ],
};

export default {
    id: 'lyric-export',
    titleKey: 'ponder.targets.lyricExport',
    category: 'playback',
    summaryKey: 'ponder.summaries.lyric_export',
    hoverSelector: '[data-ponder="lyric-export-surface"], [data-ponder-lyric-export-settings-entry]',
    relatedTargetIds: ['panel-source-tab', 'command-palette'],
    scenes: [scope, formats],
} satisfies PonderTargetDefinition;
