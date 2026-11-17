import { useAppViewStore, type AppView } from '../../stores/useAppViewStore';
import { usePonderStore } from '../../stores/usePonderStore';
import { openSettings, useSettingsModalStore, type VisualizerSettingsSection } from '../../stores/useSettingsModalStore';
import { settingsAnchorSubview, type SettingsAnchorId } from '../../utils/settingsAnchorModel';
import type { PonderTargetId } from '../../types/ponder';

// src/services/ponder/pagePonderTarget.ts

const PAGE_TARGET_BY_VIEW: Record<AppView, PonderTargetId> = {
    home: 'grid-page',
    player: 'player-page',
    lattice: 'lattice-page',
};

const PAGE_SCOPE_TARGETS = new Set<PonderTargetId>([
    'grid-page',
    'grid-view-page',
    'local-grid-map-page',
    'player-page',
    'lattice-page',
    'help-page',
    'settings-page',
    // bravais 的首页 / 集合 / 歌手页：墙是页面教程，信息条（bravais-seam）作为本页组件挂在它下面。
    'bravais-wall',
]);

/** A rendered page explicitly opts out; missing or unknown scopes still use the view fallback. */
export type PagePonderScope = PonderTargetId | 'none';

export const resolvePagePonderTarget = (
    view: AppView,
    visibleScopeTargetId?: string | null,
): PonderTargetId | null => visibleScopeTargetId === 'none' ? null : (
    visibleScopeTargetId && PAGE_SCOPE_TARGETS.has(visibleScopeTargetId as PonderTargetId)
        ? visibleScopeTargetId as PonderTargetId
        : PAGE_TARGET_BY_VIEW[view]
);

/** Returns the topmost mounted, visible page scope. Later overlays win over their underlying page. */
export const readVisiblePagePonderScope = (): PagePonderScope | null => {
    if (typeof document === 'undefined') {
        return null;
    }

    const scopes = Array.from(document.querySelectorAll<HTMLElement>('[data-ponder-page-scope]'));
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
        const element = scopes[index];
        const targetId = element.dataset.ponderPageScope;
        if (!targetId || (targetId !== 'none' && !PAGE_SCOPE_TARGETS.has(targetId as PonderTargetId))) continue;

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
            return targetId as PagePonderScope;
        }
    }

    return null;
};

/**
 * 思索导航页。帮助页那颗灯泡按钮开的是它。
 *
 * 不直接开教程：总览只有一章，剩下的几十条各自独立，用户要的是「挑一条」而不是
 * 「从头看一遍」。导航页上按 Ctrl+G 才是总览 —— 那一屏声明了 help-page 作为页面 scope。
 */
export const openPonderNavigation = (): void => {
    useSettingsModalStore.getState().closeSettings();
    usePonderStore.getState().openNavigation();
};

/**
 * 一章里「直接去那儿」按下之后：把思索这一侧的层全部收掉，再打开设置。
 *
 * 设置窗口是 z-[100]，是整个应用里最低的一层浮层 —— 教程层（220）和思索导航页（195）
 * 都压在它上面。只关教程的话，从导航页进来的那条路会把设置开在导航页底下，
 * 屏幕上什么都没变，读起来就是「这个按钮没反应」。
 *
 * 不把导航页留着等用户回来：他按这颗按钮就是要去那儿，回到原处反而是意外。
 */
export const openSettingsFromPonder = (anchorId: SettingsAnchorId): void => {
    const ponder = usePonderStore.getState();
    ponder.closePonder();
    ponder.closeNavigation();
    openSettings('options', settingsAnchorSubview(anchorId), null, anchorId);
};

/** 同上，去的是歌词动画调参台的某一页。收层的顺序和理由与 openSettingsFromPonder 相同。 */
export const openVisualizerSettingsFromPonder = (section: VisualizerSettingsSection): void => {
    const ponder = usePonderStore.getState();
    ponder.closePonder();
    ponder.closeNavigation();
    openSettings('options', 'visualizer', section);
};

/** Opens Ponder for the foremost page and completes the non-dismissible shortcut lesson if present. */
export const openCurrentPagePonder = (): PonderTargetId | null => {
    const modal = useSettingsModalStore.getState();
    const targetId = readCurrentPagePonderTarget();
    if (targetId === null) return null;

    if (modal.isUserGuideModalOpen) {
        if (typeof __APP_VERSION__ !== 'undefined') {
            modal.setLastSeenGuideVersion(__APP_VERSION__);
        }
        modal.setIsUserGuideModalOpen(false);
    }

    usePonderStore.getState().openPonder(targetId);
    return targetId;
};

/** Resolves the same target for shortcut feedback, touch and command entry points. */
export const readCurrentPagePonderTarget = (): PonderTargetId | null => {
    const modal = useSettingsModalStore.getState();
    // 第一次那道门是压在首页上的，按页面 scope 解析出来的是海报墙 —— 而它要教的是
    // 「Folia 大致怎么转」。这一条比页面 scope 优先。
    return modal.isUserGuideModalOpen
        ? 'help-page'
        : resolvePagePonderTarget(
            useAppViewStore.getState().view,
            readVisiblePagePonderScope(),
        );
};
