import type { CSSProperties } from 'react';

// src/components/app/presentation/playerVisualizerBackdrop.ts
// 首页墙后面透出来的播放页 visualizer 怎么画（bravais「墙后的画面」设置，设计稿 §11）。资料库 stage 经契约的
// reportPlayerBackdrop 报两个开关（useLibraryPlayerOcclusionStore 的 selectLibraryPlayerBackdrop），App 只认报告、
// 不认识 suite，也不读 suite 的偏好：
// - 歌词文字：visualizer 的 showText 原来只在播放页为真（首页的 visualizer 不画文字，省开销、首页不花）；stage 报了
//   lyrics 时首页显示着（不被面板盖住；设置弹窗盖着时首页仍显示在遮罩下面，照画，墙后的画面不随设置开关变）也画。
//   播放页不受影响（设置弹窗盖着时不画）。
// - 模糊：visualizer 那一层（player-visual-surface）加一层 CSS filter 的模糊。只在首页墙显示着时（含设置弹窗盖着、
//   进 Lattice 的交接期间，墙的窗还开着）；回播放页立即撤掉（过渡 300ms）。选它而不是 backdrop-filter：一次合成层的模糊、开销与透光处
//   的多少无关；backdrop-filter 要先把背后的画面拷出来、而且每个窗 / 缝各算一遍。
// stage 只在墙或缝真的透着时才报 true，完全实色时 visualizer 本来就卸载了。

/** 模糊半径。够大（≥ 20px）时合成器的模糊会先降采样，开销基本不随半径涨。 */
export const LIBRARY_BACKDROP_BLUR_PX = 24;

/** visualizer 画不画歌词文字：播放页照旧（设置弹窗盖住时不画）；首页显示着（设置弹窗盖着也算）且 stage 报了 lyrics 时也画。 */
export const resolveVisualizerShowText = ({
    currentView,
    isSettingsModalOpen,
    isPanelOpen,
    backdropLyrics,
}: {
    currentView: string;
    isSettingsModalOpen: boolean;
    isPanelOpen: boolean;
    backdropLyrics: boolean;
}): boolean => (
    (currentView === 'player' && !isSettingsModalOpen)
    || (currentView === 'home' && !isPanelOpen && backdropLyrics)
);

/** visualizer 那一层要不要模糊：首页墙露着（buildHomeSurfacePresentation 的 shouldRevealHomeSurface）且 stage 报了 blur。 */
export const resolveVisualizerBackdropBlur = ({
    shouldRevealHomeSurface,
    backdropBlur,
}: {
    shouldRevealHomeSurface: boolean;
    backdropBlur: boolean;
}): boolean => shouldRevealHomeSurface && backdropBlur;

/**
 * visualizer 的返回按钮要不要给：它回的是播放页，所以只属于播放页。首页上 visualizer 仍挂着（墙后透出的画面），
 * 给了按钮就会在首页左上角多出一颗本该回播放页的按钮——首页有自己的导航，那颗按钮在那儿没有去处。
 * Lattice 同理（交接期间 visualizer 还挂着，但它不是播放页）。
 */
export const resolveVisualizerBackAction = <TAction>(
    currentView: string,
    onBack: TAction,
): TAction | undefined => (currentView === 'player' ? onBack : undefined);

const BLURRED: CSSProperties = Object.freeze({ filter: `blur(${LIBRARY_BACKDROP_BLUR_PX}px)`, transition: 'filter 300ms ease' });
const SHARP: CSSProperties = Object.freeze({ transition: 'filter 300ms ease' });

/** player-visual-surface 的内联样式（引用稳定，不让 App 每次渲染都换一个 style 对象）。 */
export const visualizerBackdropStyle = (blurred: boolean): CSSProperties => (blurred ? BLURRED : SHARP);
