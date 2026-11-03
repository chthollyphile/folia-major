// src/i18n/virtualModules.d.ts
// 繁体中文文案由 dev/i18n/traditionalLocalePlugin.mjs 在构建期从 zh-CN.ts 转换生成，
// 以 Vite 虚拟模块的形式提供，不签入仓库——所以它没有真实文件可供 TS 解析，需要这份声明。

declare module 'virtual:folia-locale-zh-TW' {
    /** 结构同 zh-CN，只是每条文案换成了繁体中文，所以不沿用 zh-CN 的字面量类型。 */
    type TraditionalTexts<T> = { readonly [K in keyof T]: T[K] extends string ? string : TraditionalTexts<T[K]> };

    const zhTW: TraditionalTexts<typeof import('./locales/zh-CN').default>;
    export default zhTW;
}
