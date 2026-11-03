import { ONBOARDING_ILLUSTRATION, onboardingSurface } from './ponderOnboardingShared';
import type { PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/basics/ponderBasics.target.ts
// 思索自己怎么用。
//
// 从 help-page 拆出来的详细说明：入门页只概述思索能做什么，「悬停出提示、长按 G、整页 Ctrl+G、
// 触屏那颗灯泡、看够了怎么关」这些都是具体操作，属于导航页上的一条，不属于总览。

const illustration = ONBOARDING_ILLUSTRATION;

/**
 * 第一章：你已经在思索里了，以及怎么再打开下一个。
 *
 * 放在最前面是因为读到这一屏的人刚刚第一次进来 —— 先把「刚才发生了什么、下次怎么再来」
 * 说清楚，后面几章才有人看得到。
 *
 * 这一章用的是示意图而不是某个真实页面的轮廓：它讲的是一套机制，而机制没有「所在页面」。
 * 光标移到图里那个组件上 → 胶囊浮出来 → 擦除铺满 → 教程接管整屏，四步就是全过程。
 */
const insidePonder: PonderSceneScript = {
    id: 'help-page-ponder',
    titleKey: 'ponder.scenes.helpPagePonder',
    anchors: illustration,
    steps: [
        { kind: 'highlight', id: 'showPage', anchor: 'page', intensity: [0, 0.35], durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'here',
            textKey: 'ponder.captions.onboarding.here',
            pointTo: { anchor: 'page' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readHere' },

        { kind: 'highlight', id: 'dimPage', anchor: 'page', intensity: [0.35, 0], durationMs: 400, keyframe: true },
        { kind: 'cursor', id: 'hoverComponent', to: { anchor: 'component' }, durationMs: 760, withPrevious: true },
        { kind: 'surfaceState', id: 'showHint', anchor: 'page', state: 'hint-shown', durationMs: 420 },
        {
            kind: 'caption', id: 'hover',
            textKey: 'ponder.captions.onboarding.hover',
            pointTo: { anchor: 'capsule' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readHover' },

        { kind: 'keypress', id: 'holdG', keys: ['G'], at: { anchor: 'capsule', y: 1, offset: { y: 20 } }, durationMs: 1000, keyframe: true },
        { kind: 'surfaceState', id: 'holding', anchor: 'page', state: 'hint-holding', durationMs: 420, withPrevious: true },
        { kind: 'surfaceState', id: 'opened', anchor: 'page', state: 'ponder-open', transition: 'zoom', durationMs: 560 },
        {
            kind: 'caption', id: 'hold',
            textKey: 'ponder.captions.onboarding.hold',
            pointTo: { anchor: 'page' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readHold' },
    ],
};

/**
 * 第二章：整页的教程，以及触屏上那颗灯泡。
 *
 * 灯泡单独说，因为它只在触屏上存在 —— 桌面上照着找是找不到的，而上一版的文案
 * 把这件事写成了一句附带，读的人只会以为自己没看见。
 */
const wholePage: PonderSceneScript = {
    id: 'help-page-whole-page',
    titleKey: 'ponder.scenes.helpPageWholePage',
    anchors: illustration,
    steps: [
        // 这一章不切到 ponder-open：整屏接管的样子上一章末尾刚演过，再演一遍没有新东西，
        // 而它是整屏替换 —— 切过去之后右下角那颗灯泡就不在画面上了，第二段没法指。
        { kind: 'keypress', id: 'ctrlG', keys: ['Ctrl G'], at: { anchor: 'page', y: 1, offset: { y: 20 } }, durationMs: 1100, keyframe: true },
        { kind: 'highlight', id: 'markPage', anchor: 'page', intensity: [0, 0.35], durationMs: 460, withPrevious: true },
        {
            kind: 'caption', id: 'wholePage',
            textKey: 'ponder.captions.onboarding.wholePage',
            pointTo: { anchor: 'page' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readWholePage' },

        { kind: 'highlight', id: 'dimPage', anchor: 'page', intensity: [0.35, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markBulb', anchor: 'touchBulb', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'touch',
            textKey: 'ponder.captions.onboarding.touchBulb',
            pointTo: { anchor: 'touchBulb' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readTouch' },
    ],
};

/**
 * 第五章：看够了就把提示关掉。
 *
 * 放在最后而不是不放：悬停提示对新用户是帮助，对已经熟了的人是噪声，而「它能关」
 * 这件事本身也只有在教程里说才找得到 —— 那个开关在设置的实验室分组里。
 */
const hintSettings: PonderSceneScript = {
    id: 'help-page-hint-settings',
    titleKey: 'ponder.scenes.helpPageHintSettings',
    action: {
        kind: 'openSettings',
        anchorId: 'ponderHints',
        labelKey: 'ponder.actions.openPonderHints',
    },
    anchors: onboardingSurface('ponder.anchors.pages.settings', 'settings-page'),
    steps: [
        { kind: 'highlight', id: 'showSettings', anchor: 'page', intensity: [0, 0.4], durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'hints',
            textKey: 'ponder.captions.onboarding.hintSettings',
            pointTo: { anchor: 'page' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readHints' },
    ],
};

export default {
    id: 'ponder-basics',
    titleKey: 'ponder.targets.ponderBasics',
    category: 'basics',
    summaryKey: 'ponder.summaries.ponder_basics',
    hoverSelector: null,
    scenes: [insidePonder, wholePage, hintSettings],
} satisfies PonderTargetDefinition;
