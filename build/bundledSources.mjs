import { packageExclusionPattern, upstreamPackageExclusions } from '../dev/sources/packaging.mjs';
// build/bundledSources.mjs
// electron-builder 的上层配置（package.json 的 build.extends 指过来，electron-builder 先读它，再把 package.json 的 build 合上去）：
// 内置音源在安装包里的样子（Folium 2.0 方案 §6.2「打包」）。`files` 里排除各音源自己带着的上游库，app.asar 里不再有第二份
// （dev/sources/packaging.mjs 算出哪些包）。`files` 的排除规则 electron-builder 对 node_modules 照样生效；两边的 `files`
// 按顺序接在一起，这里只写排除，不影响 package.json 里的那几条。

/** 交给 electron-builder 的配置。 */
export const bundledSourcesConfig = ({ root } = {}) => ({
    files: upstreamPackageExclusions({ root }).map(packageExclusionPattern),
});

export default () => bundledSourcesConfig();
