import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// test/helpers/appState.ts

/**
 * 与 vite.config.ts 注入的 __APP_VERSION__ 同源。
 *
 * 测试里绝对不要硬编码这个版本号。用户指引弹窗的判定是「已看版本 !== 当前版本就自动弹出」，
 * 硬编码的种子会在下一次发版时静默失效：弹窗以 z-[200] 盖住整页，所有点击被拦截，
 * 相关用例会以「locator 超时」或「截图大面积不一致」的形式失败，且看不出和版本号有关。
 */
export const APP_VERSION: string = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
).version as string;

/** 对应 src/stores/useSettingsModalStore.ts 的 LAST_SEEN_GUIDE_VERSION_STORAGE_KEY */
export const GUIDE_VERSION_STORAGE_KEY = 'folia_last_seen_guide_version';
