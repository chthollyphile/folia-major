import { create } from 'zustand';

// src/mods/modVisualizerSettings.ts
// Persisted per-mode settings for mod-contributed visualizers. The manifest
// declares a param schema (visualizers[].settings); the generic panel
// (ModVisualizerSettingsPanel) writes here, and the contribution reads the
// current values every frame through mount props (`getSettings`).
//
// localStorage on purpose: these are small plain-JSON knob sets, and the mod
// system's own store owns everything mod-identity related. A corrupt or
// foreign payload degrades to "no saved settings", never to a crash.

const STORAGE_KEY = 'folia_mod_visualizer_settings_v1';
const EMPTY: Record<string, unknown> = Object.freeze({});

const load = (): Record<string, Record<string, unknown>> => {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        /*
         * 只保留「值是纯对象」的条目：被篡改或旧版本留下的数据里 `byMode[mode]` 可能是
         * 数字、字符串或数组，而后面一律按对象展开（`{ ...values, ...patch }`）——
         * 数组会被摊成下标键，数字则整条丢值，面板与模组都拿不到正确的形状。
         */
        return Object.fromEntries(Object.entries(parsed).filter(([, value]) => (
            Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ))) as Record<string, Record<string, unknown>>;
    } catch {
        return {};
    }
};

/*
 * 落盘防抖：数字滑杆的 onChange 每次移动都会调 `setValues`，同步
 * `JSON.stringify` + `setItem` 会跟着抖一整条拖动（ModSurfaceRenderer 走 live 通道的
 * 那条路同样做了防抖）。内存里的值立刻生效，磁盘晚 250ms 跟上即可。
 */
const SAVE_DEBOUNCE_MS = 250;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: Record<string, Record<string, unknown>> | null = null;

const flushSave = () => {
    if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const snapshot = pendingSave;
    pendingSave = null;
    if (!snapshot) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
        // Quota/private-mode failures must not break the knob drag; values stay
        // in memory for the session.
    }
};

const save = (byMode: Record<string, Record<string, unknown>>) => {
    pendingSave = byMode;
    if (saveTimer !== null) return;
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
};

/*
 * 关页面/切到后台时把还在 debounce 里的那一次写掉：防抖之后最后一拍的改动
 * 会在窗口关闭时丢掉，而同步写时代不会。与 debugModule 的缓冲日志同一条路
 * （`window.addEventListener('pagehide', flush)`）。
 */
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushSave();
    });
}

interface ModVisualizerSettingsState {
    byMode: Record<string, Record<string, unknown>>;
    setValues: (mode: string, patch: Record<string, unknown>) => void;
    resetMode: (mode: string) => void;
}

export const useModVisualizerSettingsStore = create<ModVisualizerSettingsState>((set) => ({
    byMode: load(),
    setValues: (mode, patch) => set((state) => {
        const byMode = {
            ...state.byMode,
            [mode]: { ...(state.byMode[mode] ?? {}), ...patch },
        };
        save(byMode);
        return { byMode };
    }),
    resetMode: (mode) => set((state) => {
        if (!(mode in state.byMode)) {
            return state;
        }
        const byMode = { ...state.byMode };
        delete byMode[mode];
        save(byMode);
        return { byMode };
    }),
}));

/**
 * Stable empty object so panels/contributions re-render only on real changes.
 *
 * 宿主界面读当前值的唯一入口。模组侧的值不走这里（`props.getSettings()`），
 * 见 mods/README.md「模组模式的设置面板」。
 */
export const useModVisualizerSettings = (mode: string): Record<string, unknown> => (
    useModVisualizerSettingsStore((state) => state.byMode[mode] ?? EMPTY)
);
