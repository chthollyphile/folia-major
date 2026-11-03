import {
    SIGN_IN_GEOMETRY as G,
    SIGN_IN_SIGNED_IN_ROW,
    SIGN_IN_WINDOW as W,
    signInRowRect,
} from '../../surfaces/basics/signIn.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/basics/signIn.target.ts
// 登录在线音乐平台：两个入口，和它们打开的同一个窗口。
//
// 单独成目标的理由：入口有两处而且长得不像（主页中间一颗按钮，右下角一枚头像）；窗口里选中
// 一行之后右边是什么跟着平台变（二维码、先选方式、去浏览器）；已经登录的平台还多出切换和退出。
// 这些在照着做一遍之前，从画面上看不出来。
//
// 几何来自 signIn.geometry，和 signIn.surface.tsx 画的是同一组数。

const page = {
    kind: 'synthetic',
    // aspect 是 900 ÷ 1440：画的是一整页，登录窗口按它在页面里的真实大小盖在上面。
    rect: { left: 0.5, top: 0.09, width: 0.6, height: 0.6, aspect: 0.625, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'sign-in',
    labelKey: 'ponder.anchors.signIn.page',
} satisfies PonderAnchorSource;

const region = (from: string, rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from, rect, role: 'region', labelKey }
);

const anchors = {
    page,
    homeButton: region('page', G.homeButton, 'ponder.anchors.signIn.homeButton'),
    pill: region('page', G.pill, 'ponder.anchors.signIn.pill'),
    window: region('page', G.window, 'ponder.anchors.signIn.window'),
    platforms: region('window', W.column, 'ponder.anchors.signIn.platforms'),
    signedInRow: region('window', signInRowRect(SIGN_IN_SIGNED_IN_ROW), 'ponder.anchors.signIn.signedInRow'),
    tile: region('window', W.tile, 'ponder.anchors.signIn.tile'),
    steps: region('window', W.steps, 'ponder.anchors.signIn.steps'),
    account: region('window', W.account, 'ponder.anchors.signIn.account'),
    actions: region('window', W.actions, 'ponder.anchors.signIn.actions'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：两个入口。主页中间的按钮，和右下角一直都在的那一枚。 */
const entries: PonderSceneScript = {
    id: 'sign-in-entries',
    titleKey: 'ponder.scenes.signInEntries',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markButton', anchor: 'homeButton', intensity: [0, 0.6], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'homeButton',
            textKey: 'ponder.captions.signIn.homeButton',
            pointTo: { anchor: 'homeButton' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readButton' },

        { kind: 'highlight', id: 'dimButton', anchor: 'homeButton', intensity: [0.6, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markPill', anchor: 'pill', intensity: [0, 0.8], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'pill',
            textKey: 'ponder.captions.signIn.pill',
            pointTo: { anchor: 'pill' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readPill' },
    ],
};

/** 第二章：点右下角那一枚，窗口打开。左边选平台，右边是那个平台的登录方式和步骤。 */
const signInWindow: PonderSceneScript = {
    id: 'sign-in-window',
    titleKey: 'ponder.scenes.signInWindow',
    anchors,
    steps: [
        { kind: 'cursor', id: 'openWindow', to: { anchor: 'pill', x: 0.27 }, press: 'tap', durationMs: 660, keyframe: true },
        { kind: 'surfaceState', id: 'windowOpens', anchor: 'page', state: 'window-open', transition: 'zoom', durationMs: 520 },
        { kind: 'highlight', id: 'markPlatforms', anchor: 'platforms', intensity: [0, 0.5], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'platforms',
            textKey: 'ponder.captions.signIn.platforms',
            pointTo: { anchor: 'platforms' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readPlatforms' },

        { kind: 'highlight', id: 'dimPlatforms', anchor: 'platforms', intensity: [0.5, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markTile', anchor: 'tile', intensity: [0, 0.6], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'code',
            textKey: 'ponder.captions.signIn.code',
            pointTo: { anchor: 'tile' }, durationMs: 7600, withPrevious: true,
        },
        { kind: 'pause', id: 'readCode' },

        { kind: 'highlight', id: 'dimTile', anchor: 'tile', intensity: [0.6, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markSteps', anchor: 'steps', intensity: [0, 0.8], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'steps',
            textKey: 'ponder.captions.signIn.steps',
            pointTo: { anchor: 'steps' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readSteps' },
    ],
};

/** 第三章：选中一个已经登录的平台，右边换成它的账号，和切换、退出两颗按钮。 */
const account: PonderSceneScript = {
    id: 'sign-in-account',
    titleKey: 'ponder.scenes.signInAccount',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'windowOpen', anchor: 'page', state: 'window-open', durationMs: 420, keyframe: true },
        { kind: 'cursor', id: 'pickRow', to: { anchor: 'signedInRow' }, press: 'tap', durationMs: 660 },
        { kind: 'surfaceState', id: 'toAccount', anchor: 'page', state: 'window-account', durationMs: 460 },
        { kind: 'highlight', id: 'markAccount', anchor: 'account', intensity: [0, 0.4], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'account',
            textKey: 'ponder.captions.signIn.account',
            pointTo: { anchor: 'account' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readAccount' },

        { kind: 'highlight', id: 'dimAccount', anchor: 'account', intensity: [0.4, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markActions', anchor: 'actions', intensity: [0, 0.8], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'switch',
            textKey: 'ponder.captions.signIn.switch',
            pointTo: { anchor: 'actions' }, durationMs: 7200, withPrevious: true,
        },
        { kind: 'pause', id: 'readSwitch' },
    ],
};

export default {
    id: 'sign-in',
    titleKey: 'ponder.targets.signIn',
    category: 'basics',
    summaryKey: 'ponder.summaries.sign_in',
    // 右下角那一枚挂着它自己的 data-testid；主页的「登录」按钮和整个登录窗口（平台那一列、标题那一行都在内）
    // 挂 data-ponder="sign-in"。
    hoverSelector: '[data-testid="online-provider-switcher"], [data-ponder="sign-in"]',
    relatedTargetIds: ['panel-account-tab'],
    scenes: [entries, signInWindow, account],
} satisfies PonderTargetDefinition;
