// dev/sources/sourceDeps.d.ts
// `@folia/source-deps` 的类型：构建给音源模组的 main 入口与 worker 的虚拟模块（bundle.mjs 的 SOURCE_DEPS），
// 只在声明了 asar 依赖的音源里有。

/** 绑在本模组 deps 归档上的 require：`depsRequire.resolve('<包>/<文件>')` 是那个文件在归档里的路径。 */
export declare const depsRequire: NodeJS.Require;
