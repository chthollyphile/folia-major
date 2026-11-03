import { onboardingSurface } from './ponderOnboardingShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/basics/foliaShortcuts.target.ts
// 四个带主修饰键的快捷键，一个一句。

/** 第三章：四个 Ctrl 组合，一个一句。 */
const shortcuts: PonderSceneScript = {
    id: 'help-page-shortcuts',
    titleKey: 'ponder.scenes.helpPageShortcuts',
    anchors: onboardingSurface('ponder.anchors.pages.commandPalette', 'palette', true),
    steps: [
        { kind: 'keypress', id: 'modK', keys: ['Mod K'], at: 'bottom', durationMs: 1000, keyframe: true },
        { kind: 'reveal', id: 'showPalette', anchor: 'page', transition: 'zoom', durationMs: 520 },
        {
            kind: 'caption', id: 'paletteKey',
            textKey: 'ponder.captions.onboarding.shortcutK',
            pointTo: { anchor: 'page' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readK' },

        { kind: 'keypress', id: 'modP', keys: ['Mod P'], at: { anchor: 'page', y: 1, offset: { y: 18 } }, durationMs: 1000, keyframe: true },
        {
            kind: 'caption', id: 'queueKey',
            textKey: 'ponder.captions.onboarding.shortcutP',
            pointTo: { anchor: 'page' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readP' },

        { kind: 'keypress', id: 'modB', keys: ['Mod B'], at: { anchor: 'page', y: 1, offset: { y: 18 } }, durationMs: 1000, keyframe: true },
        {
            kind: 'caption', id: 'latticeKey',
            textKey: 'ponder.captions.onboarding.shortcutB',
            pointTo: { anchor: 'page' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readB' },

        { kind: 'keypress', id: 'modG', keys: ['Ctrl G'], at: { anchor: 'page', y: 1, offset: { y: 18 } }, durationMs: 1000, keyframe: true },
        {
            kind: 'caption', id: 'ponderKey',
            textKey: 'ponder.captions.onboarding.shortcutG',
            pointTo: { anchor: 'page' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readG' },
    ],
};

export default {
    id: 'folia-shortcuts',
    titleKey: 'ponder.targets.foliaShortcuts',
    category: 'basics',
    summaryKey: 'ponder.summaries.folia_shortcuts',
    hoverSelector: null,
    scenes: [shortcuts],
} satisfies PonderTargetDefinition;
