import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from './storagePrimitives';

// src/stores/useScratchpadSettingsStore.ts
// 速记簿的设置：左缘的悬浮把手显不显示、放在左缘的什么高度。设置页「主页与歌单」的「速记簿」一组、
// 命令面板和 ScratchpadHost 三处读写。把手藏起来以后 Ctrl / ⌘ + J 与命令面板照常能开合抽屉。
// 另有把手常驻时的样子（handleStyle）：视觉设置，随外观配置导入导出（appearanceCodec 的短码 sphs）。
//
// @note scratchpad_show_handle、scratchpad_handle_position 是用户明确决定「不进外观配置导入导出」的设置（2026-11-08）：配置码也用于 web 版 OBS 链接，
// 只加 OBS 页面看得到的，这些在 OBS 页面上看不到。不要按 settings-feature-integration「视觉设置必须进
// buildCurrentConfig / compressConfig / decompressConfig / validKeys / handleImportConfig」的规则把它们补进短码或 JSON。

const SHOW_HANDLE_KEY = 'scratchpad_show_handle';
const HANDLE_POSITION_KEY = 'scratchpad_handle_position';
const HANDLE_STYLE_KEY = 'scratchpad_handle_style';

/** 把手在左缘的高度：0 是最上面（标题栏与左上角返回钮之下，原来的位置），1 是贴近窗口底部。 */
export const SCRATCHPAD_HANDLE_POSITION_DEFAULT = 0;

/**
 * 把手常驻时（指针还没进左缘热区）的样子：米白小条、细竖线、小圆点、几何体（圆 / 三角 / 「》」三颗小记号）。
 * 四种都小而半透明，不打扰页面；指针进来或键盘聚焦时一律展开成完整的米白标签。
 */
export const SCRATCHPAD_HANDLE_STYLES = ['strip', 'line', 'dot', 'shapes'] as const;
export type ScratchpadHandleStyle = (typeof SCRATCHPAD_HANDLE_STYLES)[number];
export const SCRATCHPAD_HANDLE_STYLE_DEFAULT: ScratchpadHandleStyle = 'strip';

export const isScratchpadHandleStyle = (value: unknown): value is ScratchpadHandleStyle => (
    typeof value === 'string' && (SCRATCHPAD_HANDLE_STYLES as readonly string[]).includes(value)
);

/** 设置页、导入确认里每种样式的名字。 */
export const SCRATCHPAD_HANDLE_STYLE_LABEL_KEYS: Record<ScratchpadHandleStyle, string> = {
    strip: 'options.scratchpadHandleStyleStrip',
    line: 'options.scratchpadHandleStyleLine',
    dot: 'options.scratchpadHandleStyleDot',
    shapes: 'options.scratchpadHandleStyleShapes',
};

const clampPosition = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : SCRATCHPAD_HANDLE_POSITION_DEFAULT);

const readStoredPosition = () => clampPosition(Number.parseFloat(getStoredString(HANDLE_POSITION_KEY, String(SCRATCHPAD_HANDLE_POSITION_DEFAULT))));

const readStoredStyle = (): ScratchpadHandleStyle => {
    const stored = getStoredString(HANDLE_STYLE_KEY, SCRATCHPAD_HANDLE_STYLE_DEFAULT);
    return isScratchpadHandleStyle(stored) ? stored : SCRATCHPAD_HANDLE_STYLE_DEFAULT;
};

export type ScratchpadSettingsState = {
    showHandle: boolean;
    handlePosition: number;
    handleStyle: ScratchpadHandleStyle;
    setShowHandle: (show: boolean) => void;
    toggleShowHandle: () => void;
    setHandlePosition: (position: number) => void;
    setHandleStyle: (style: ScratchpadHandleStyle) => void;
};

export const useScratchpadSettingsStore = create<ScratchpadSettingsState>((set, get) => ({
    showHandle: getStoredBoolean(SHOW_HANDLE_KEY, true),
    handlePosition: readStoredPosition(),
    handleStyle: readStoredStyle(),
    setShowHandle: (show) => {
        set({ showHandle: show });
        setStoredBoolean(SHOW_HANDLE_KEY, show);
    },
    toggleShowHandle: () => get().setShowHandle(!get().showHandle),
    setHandlePosition: (position) => {
        const next = clampPosition(position);
        set({ handlePosition: next });
        setStoredString(HANDLE_POSITION_KEY, String(next));
    },
    setHandleStyle: (style) => {
        const next = isScratchpadHandleStyle(style) ? style : SCRATCHPAD_HANDLE_STYLE_DEFAULT;
        set({ handleStyle: next });
        setStoredString(HANDLE_STYLE_KEY, next);
    },
}));
