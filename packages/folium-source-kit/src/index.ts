// packages/folium-source-kit/src/index.ts
// 音源模组共用的纯函数（Folium 2.0 方案 §6.1）。音源（sources/<id>/）和宿主都从这里取：
// `import { … } from '@folia/folium-source-kit'`（别名在 tsconfig、vite、vitest 与 dev/sources/build.mjs 里各配一处）。
// 只放纯 TypeScript：不 import 包外的任何东西（D308），不碰 DOM 以外的平台接口，不认识任何平台。

export { codeText, errorFields, errorMessage } from './errorText';
export { MAX_KEPT, createHandedOut, cursorWords, stampCursor } from './exploreReads';
export { krcDecrypt } from './krcDecrypt';
export { LOGIN_REQUEST_LIMIT_MS, LoginRequestTimeout, dropLoginRequestLimits, isLoginRequestTimeout, withLoginRequestLimit } from './loginRequestLimit';
