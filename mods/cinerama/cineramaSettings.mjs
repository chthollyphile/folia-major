// mods/cinerama/cineramaSettings.mjs
// 巨幕旋钮的唯一真源。面板写这里，渲染层读这里，两边 import 的是同一个模块实例
// （同一条 folia-mod:// URL 下 ESM 单例），所以拖动滑块后下一帧就能读到新值——
// 不需要事件总线，也不需要渲染层每帧去解析 localStorage。
//
// 写入换引用（与宿主侧 `src/mods/modVisualizerSettings.ts` 同一条不可变写法）：
// 调用方拿到的那份永远是它读到时的快照，改值只能走 `updateCineramaSettings`，
// 不存在「渲染层手里的对象被面板悄悄改掉」这回事。渲染层每帧调 `getCineramaSettings()`
// 取新引用，所以换引用不等于读不到新值。
//
// 之前面板只往 localStorage 写，而渲染层读的是 `props.getSettings()`：两条路不通，
// 表现就是「面板能拖、画面不动」。持久化仍然用模组自己的 key，与宿主的任何存储互不干扰；
// 配额/隐私模式写不进去时退化成「本次会话有效、重启回默认」，不打断拖动也不打断渲染。

const STORAGE_KEY = 'folia_mod_cinerama_settings_v1';

let cache = null;

const read = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

/*
 * 当前旋钮值。返回的是读到这一刻的那一份——**调用方不得写它**（写入走
 * updateCineramaSettings，它会换引用）。渲染层每帧调一次取新值。
 */
export const getCineramaSettings = () => {
    if (!cache) cache = read();
    return cache;
};

/*
 * 落盘防抖：滑杆的 `input` 每移动一格就写一次，同步 `JSON.stringify` + `setItem`
 * 会跟着抖一整条拖动。内存里的值立刻生效（渲染层每帧重新取一份），磁盘晚一拍跟上。
 *
 * 与宿主侧同一条路（`src/mods/modVisualizerSettings.ts` 的 250ms 防抖 + pagehide 兜底）：
 * 防抖之后「最后一拍」的改动会在关窗口时丢掉，所以关页面/切后台时补写一次。
 */
const SAVE_DEBOUNCE_MS = 250;
let saveTimer = null;

/** 把还在防抖里的那次写掉；没有待写内容时是空操作。 */
export const flushCineramaSettings = () => {
    if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const current = cache;
    if (!current) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
        // 配额/隐私模式写不进去：值留在内存里，本次会话照常生效。
    }
};

/*
 * 关页面 / 切到后台时补写。与 debugModule 的缓冲日志、宿主的设置 store 同一条路
 * （`pagehide` 在 bfcache 与强杀下都比 `beforeunload` 可靠）。
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', flushCineramaSettings);
    if (typeof document !== 'undefined') {
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushCineramaSettings();
        });
    }
}

/** 写一个或一批旋钮：换一个新对象并落盘（防抖）。返回写后的那一份。 */
export const updateCineramaSettings = (patch) => {
    const current = getCineramaSettings();
    cache = { ...current, ...patch };
    if (saveTimer === null) {
        saveTimer = setTimeout(() => {
            saveTimer = null;
            flushCineramaSettings();
        }, SAVE_DEBOUNCE_MS);
    }
    return cache;
};
