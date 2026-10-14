import { homePageFocusTargets } from '../../../mods/folium/homePageKeyboard';
import type { WallDirection } from '../../../components/wall/wallNavigation';

// src/library/suites/bravais/bravaisSeamFocus.ts
// 缝里的键盘焦点（设计稿 §7.6「Tab：墙 ↔ 缝」）：Tab / Shift+Tab 只在墙与缝两站之间切换，缝内控件之间用方向键走。
// 这里是 DOM 侧的小工具：列出缝里此刻真能拿焦点的控件（可见、没有 inert、没有禁用），挑进缝时的落点，算方向键的下一站。
// 文本输入（过滤位、搜索框、表单）与 <select> 不进方向键的序列：方向键在它们里面归它们自己（光标、选项；过滤位的 ↓ 交给墙），
// 它们有自己的入口（墙上打字、`/`、表单打开即聚焦），进缝时如果上次就停在它们上面，Tab 会回到那里。

/** 缝里能拿焦点的东西（与浏览器的 Tab 序列同一套判定，外加文本输入与 select）。 */
const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

const isTextLike = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || (element instanceof HTMLElement && element.isContentEditable);
};

/** 此刻真能拿焦点：在文档里、不在 inert 子树（翻走的半圈）里、没被 tabindex=-1 排除、看得见（缝折叠时是 visibility: hidden）。 */
export const canTakeSeamFocus = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    if (element.closest('[inert]') || element.getAttribute('tabindex') === '-1') return false;
    if (!element.matches(FOCUSABLE)) return false;
    if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({ visibilityProperty: true });
    }
    // 没有 checkVisibility 的环境：退回到「有布局盒子、visibility 不是 hidden」。
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
};

/** 缝里此刻能拿焦点的控件，按 DOM 顺序。`controlsOnly` 时去掉文本输入与 select（方向键的序列）。 */
export const listSeamControls = (seam: HTMLElement | null, { controlsOnly = false }: { controlsOnly?: boolean } = {}) => (
    seam
        ? [...seam.querySelectorAll<HTMLElement>(`${FOCUSABLE}, [data-folium-kind="home-navigation"]`)].flatMap(element => {
            // Native arrows enter each isolated mod widget once; its own Tab/arrow handling stays inside.
            if (element.dataset.foliumKind === 'home-navigation') {
                const visible = typeof element.checkVisibility === 'function'
                    ? element.checkVisibility({ visibilityProperty: true })
                    : element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
                if (element.closest('[inert]') || !visible) return [];
                return homePageFocusTargets(element.shadowRoot ?? element).slice(0, 1);
            }
            return canTakeSeamFocus(element) && !(controlsOnly && isTextLike(element)) ? [element] : [];
        })
        : []
);

/**
 * 缝里一个控件的身份（页签 key、缝的动作名、过滤位）：缝换形态（折叠 ↔ 展开、翻牌）会重挂节点，按身份才找得回「上次停过的那个」。
 * 没有身份的控件返回 null（只能按节点本身认）。
 */
const seamControlSelector = (element: Element): string | null => {
    if (!(element instanceof HTMLElement)) return null;
    const { bravaisTab, bravaisSeamAction } = element.dataset;
    if (bravaisTab) return `[data-bravais-tab="${CSS.escape(bravaisTab)}"]`;
    if (bravaisSeamAction) return `[data-bravais-seam-action="${CSS.escape(bravaisSeamAction)}"]`;
    if (element.hasAttribute('data-bravais-filter-input')) return '[data-bravais-filter-input]';
    return null;
};

/** 上次停过的那个：节点还在就是它，否则按身份找此刻缝里的同一个控件。 */
const findRemembered = (seam: HTMLElement, remembered: Element | null): HTMLElement | null => {
    if (!remembered) return null;
    if (seam.contains(remembered) && canTakeSeamFocus(remembered)) return remembered;
    const selector = seamControlSelector(remembered);
    if (!selector) return null;
    return [...seam.querySelectorAll(selector)].find(canTakeSeamFocus) ?? null;
};

/**
 * Tab 进缝时的落点：上次在缝里停过的那个（还在、还能聚焦；节点换了按身份找）→ 首页选中的页签（缝里「当前在哪」的那一格）→
 * 方向键序列的第一个控件 → 随便一个能聚焦的（例如搜索态里只剩输入框）。缝合着 / 折叠着时什么都没有，返回 null。
 */
export const resolveSeamEntry = (seam: HTMLElement | null, remembered: Element | null): HTMLElement | null => {
    if (!seam) return null;
    const again = findRemembered(seam, remembered);
    if (again) return again;
    const selected = seam.querySelector('[role="tab"][aria-selected="true"]');
    if (canTakeSeamFocus(selected)) return selected;
    return listSeamControls(seam, { controlsOnly: true })[0] ?? listSeamControls(seam)[0] ?? null;
};

/**
 * 缝里方向键的下一站：↑ / ← 上一个，↓ / → 下一个（DOM 顺序，到头不绕回）。当前元素不在序列里（例如焦点在缝的空白处）时
 * 落到第一个。没有下一站时返回 null。
 */
export const resolveSeamStep = (seam: HTMLElement | null, current: Element | null, direction: WallDirection): HTMLElement | null => {
    const controls = listSeamControls(seam, { controlsOnly: true });
    if (controls.length === 0) return null;
    const index = current instanceof HTMLElement ? controls.indexOf(current) : -1;
    if (index < 0) return controls[0];
    const step = direction === 'up' || direction === 'left' ? -1 : 1;
    return controls[index + step] ?? null;
};
