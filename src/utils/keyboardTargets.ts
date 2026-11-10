import { isPrimaryModifierPressed, isSecondaryModifierPressed } from './platform';

// src/utils/keyboardTargets.ts
// 全局快捷键的两个通用守卫：正在打字吗、有没有窗口接管了键盘。
//
// 两者此前各有三份副本（usePlaybackInteractionBridge 内联一份 + 局部闭包一份、
// usePlayerPanelTabShortcut 一份、useCommandPalette 导出一份），彼此还不完全一致 ——
// bridge 那份内联判断漏了 <select>。集中到 utils 还有一个层次上的理由：
// isTextEntryTarget 原先导出自 useCommandPalette，而那个模块会拉进整个 commandRegistry，
// hooks 层去 import 它等于反向依赖组件层。

/**
 * 事件目标是不是设置里正在录键的按键框（settings/kit/KeyCapture）。录键时每一个键都是它的，
 * 带修饰键的快捷键也要让路。
 *
 * 按键框自己的监听挂在 window 的捕获阶段，但比应用启动时就挂上的那些晚，拦不住它们；
 * 所以它在按钮上挂 data-folia-key-capture，先运行的监听来问这里。
 */
export const isKeyCaptureTarget = (target: EventTarget | null) => (
    target instanceof Element && target.matches('[data-folia-key-capture="true"]')
);

/**
 * 事件目标是不是正在接收文本输入。是的话，所有裸字母快捷键都必须让路。
 *
 * 三种不是文本框的也算：展开着的下拉（components/shared/CustomSelect，焦点在它的按钮上，
 * 键入的字母是在找选项）、正在录键的按键框、打开着的菜单里的条目（settings/kit/Menu，
 * role="menu"：空格和回车是选这一条，方向键是换一条）。下拉和菜单在冒泡阶段拦键，拦不住
 * window 上捕获阶段的监听（思索的按住 G），菜单也不拦空格和回车，所以写在这里。
 */
export const isTextEntryTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'
        || target.isContentEditable
        || target.matches('[role="combobox"][aria-expanded="true"]')
        || target.closest('[role="menu"]') !== null
        || isKeyCaptureTarget(target);
};

const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/**
 * 这一下按键是不是落在应用自己画的滑杆（role="slider"，比如面板的音量）上、并且是滑杆自己要用的键。
 * 是的话，方向键的全局快捷键（播放页的快退快进、上一首下一首）要让路，否则一下按键做两件事。
 *
 * 滑杆不算文本输入：焦点在它上面时空格和字母快捷键照常可用，所以不并进 isTextEntryTarget。
 */
export const isSliderKey = (event: Pick<KeyboardEvent, 'target' | 'key'>) => (
    event.target instanceof Element
    && event.target.matches('[role="slider"]')
    && SLIDER_KEYS.has(event.key)
);

/**
 * 当前有没有模态窗口声明自己接管了键盘。
 *
 * 用 DOM 属性而不是共享 state，是这个仓库既有的约定：每个模态自己挂
 * data-folia-keyboard-window="true"，全局热键查一次属性即可让路，不需要谁去订阅谁。
 */
export const hasBlockingWindow = () => Boolean(
    document.querySelector('[data-folia-keyboard-window="true"]')
);

/**
 * 把一次按键归一化成一个 "逻辑键码"（等价于 DOM 的 keyboard event code token）。
 *
 * 正常情况下直接返回 event.code —— 它与键盘布局无关，是全局快捷键判定的权威来源。
 * 但软件注入的按键（比如只带 wVk、不带扫描码的 SendInput）在 Chromium 里会拿到空的
 * event.code，只剩 event.key 有值。这时用 event.key 反推出等价的 code token，
 * 让所有统一走 event.code 的快捷键照样命中。加了这段兜底，物理键盘的行为零变化。
 */
export const effectiveKeyCode = (event: KeyboardEvent): string => {
    if (event.code) {
        return event.code;
    }

    const key = event.key;
    if (key.length === 1) {
        if (/[a-zA-Z]/.test(key)) {
            return `Key${key.toUpperCase()}`;
        }
        switch (key) {
            case ' ':
                return 'Space';
            case '[':
                return 'BracketLeft';
            case ']':
                return 'BracketRight';
            default:
                return '';
        }
    }
    // 命名键（Escape / ArrowLeft / Tab / Enter 等）的 key 与 code token 同名，直接用。
    return key;
};

/**
 * 这一下是不是打开命令面板的 Ctrl+K（macOS 上是 Cmd+K）。
 *
 * 命令面板自己的监听器与「接管了键盘、但要给命令面板放行」的界面（模组的首页页面）共用这一个判定，
 * 两边不会对同一次按键得出不同结论。软件注入的按键可能没有 event.code，所以同时认 event.key。
 * 放在 utils 而不是 useCommandPalette：后者会拉进整个 commandRegistry（见文件头）。
 */
export const isCommandPaletteShortcut = (event: KeyboardEvent): boolean => (
    (effectiveKeyCode(event) === 'KeyK' || event.key.toLowerCase() === 'k')
    && isPrimaryModifierPressed(event)
    && !isSecondaryModifierPressed(event)
    && !event.altKey
    && !event.shiftKey
);

/**
 * 当前有没有打开的对话框（components/shared/Sheet.tsx）。
 *
 * 比 hasBlockingWindow 窄。对话框画在所有窗口和命令面板之上，所以它开着时，连命令面板的
 * 打开键和空格的播放/暂停也要让路；别的窗口（歌词时间线、网格上的筛选框）开着时，这两样照常可用。
 */
export const hasOpenSheet = () => Boolean(
    document.querySelector('[data-folia-sheet="true"]')
);
