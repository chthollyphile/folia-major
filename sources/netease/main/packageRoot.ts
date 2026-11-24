import path from 'node:path';

// sources/netease/main/packageRoot.ts
// 网易云 API 的包在模组 deps 归档里的目录：main 入口开工作线程时交过去（workerData.packageRoot），线程从那里按路径加载
// 包里的文件（neteaseApiWorker.cjs）。包没有 exports 表，它自己的 package.json 就在目录里。

export const NETEASE_API_PACKAGE = '@neteasecloudmusicapienhanced/api';

/** The package's folder, found by `resolve` (the deps archive's require.resolve in the mod). */
export const neteasePackageRoot = (resolve: (request: string) => string): string => (
    path.dirname(resolve(`${NETEASE_API_PACKAGE}/package.json`))
);
