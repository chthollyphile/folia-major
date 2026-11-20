// src/services/onlineMusic/web/virtualModules.d.ts
// 网页版用的音源模组「包」：dev/sources/webSourcePlugin.mjs 在构建期把 sources/<id>/ 的 mod.json 与语言表（zh-TW 由 zh-CN
// 生成）以 Vite 虚拟模块提供，没有真实文件可供 TS 解析，所以要这份声明。

declare module 'virtual:folia-source/*' {
    import type { WebSourcePackage } from '@/services/onlineMusic/web/foliumWebSource';
    const source: WebSourcePackage;
    export default source;
}

// The platforms this build carries (FOLIA_BUNDLED_SOURCES), each registered by its web/<id>.ts: web/index.ts's WEB_SOURCES.
declare module 'virtual:folia-web-sources' {
    import type { WebSource } from '@/services/onlineMusic/web';
    const sources: readonly WebSource[];
    export default sources;
}
