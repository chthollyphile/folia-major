import { onboardingSurface } from './ponderOnboardingShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/basics/foliaTransport.target.ts
// 播放控制：系统媒体键，以及应用里的那几个键。
//
// 单独成目标是因为它对后台听歌的人价值最大，而且最容易完全不知道 ——
// 没人会主动去试键盘上那几颗媒体键在一个播放器上管不管用。

/**
 * 第二章：不用切回应用也能控制播放。
 *
 * 这一条对后台听歌的人价值最大，而且是最容易完全不知道的一条 —— 没人会主动去试
 * 键盘上那几颗媒体键在一个网页播放器上管不管用。
 */
const transportControl: PonderSceneScript = {
    id: 'help-page-transport',
    titleKey: 'ponder.scenes.helpPageTransport',
    anchors: onboardingSurface('ponder.anchors.pages.player', 'player-page'),
    steps: [
        { kind: 'highlight', id: 'showPlayer', anchor: 'page', intensity: [0, 0.4], durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'mediaKeys',
            textKey: 'ponder.captions.onboarding.mediaKeys',
            pointTo: { anchor: 'page' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readMediaKeys' },

        { kind: 'keypress', id: 'inAppKeys', keys: ['Mod ←', 'Space', 'Mod →'], at: { anchor: 'page', y: 1, offset: { y: 18 } }, durationMs: 1500, keyframe: true },
        {
            kind: 'caption', id: 'inApp',
            textKey: 'ponder.captions.onboarding.inAppTransport',
            pointTo: { anchor: 'page' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readInApp' },
    ],
};

export default {
    id: 'folia-transport',
    titleKey: 'ponder.targets.foliaTransport',
    category: 'playback',
    summaryKey: 'ponder.summaries.folia_transport',
    hoverSelector: null,
    scenes: [transportControl],
} satisfies PonderTargetDefinition;
