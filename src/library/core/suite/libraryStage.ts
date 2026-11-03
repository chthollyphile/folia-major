import type { LibrarySuiteId } from './suite.contract';

// src/library/core/suite/libraryStage.ts
// 集合宿主的分层呈现规则（B1）：打开集合 / 歌手层时，首页要不要藏起、要不要垫中性背景板。纯函数，宿主
// （library/app/GridViewOverlayHost）按 registry 解析的结果调用，单测直接喂 id。

export type LibraryLayerPresentationInput = {
    /** 导航栈里有没有打开的集合 / 歌手层。 */
    hasOpenLayer: boolean;
    /** 挂载着的 stage 属于哪套 suite（resolveLibraryStage 的结果；没有 stage 为 null）。 */
    stageSuiteId: LibrarySuiteId | null;
    /** 实际渲染当前层（集合或歌手页，回退时是默认 suite）的 suite。 */
    layerSuiteId: LibrarySuiteId;
};

export type LibraryLayerPresentation = {
    /** 集合层之下垫 `--bg-color` 的中性背景板。 */
    showBackdrop: boolean;
    /** 首页容器加 visibility: hidden（aria-hidden 与 pointer-events 不归这里管，打开集合时照旧关掉）。 */
    hideHome: boolean;
};

const HOME_ONLY: LibraryLayerPresentation = Object.freeze({ showBackdrop: false, hideHome: false });
const STAGE_LAYER: LibraryLayerPresentation = Object.freeze({ showBackdrop: false, hideHome: false });
const OVERLAY_LAYER: LibraryLayerPresentation = Object.freeze({ showBackdrop: true, hideHome: true });

/**
 * 当前层由带 stage 的 suite 渲染（挂着的 stage 正是它的）时，画面由 stage 负责：不垫背景板、不藏首页
 * （stage 夹在首页与背景板之间，背景板会把它盖住）。其它情况与没有 stage 时完全一样：打开了层就垫背景板、藏首页。
 * 比较的是 suite id 而不只是「有没有 stage」：当前层回退到默认 suite 时，挂着的 stage 不是它的，背景板照常。
 */
export const resolveLibraryLayerPresentation = ({
    hasOpenLayer,
    stageSuiteId,
    layerSuiteId,
}: LibraryLayerPresentationInput): LibraryLayerPresentation => {
    if (!hasOpenLayer) return HOME_ONLY;
    return stageSuiteId !== null && stageSuiteId === layerSuiteId ? STAGE_LAYER : OVERLAY_LAYER;
};
