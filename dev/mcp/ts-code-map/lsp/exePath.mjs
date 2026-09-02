import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
// dev/mcp/ts-code-map/lsp/exePath.mjs

/**
 * 定位 TypeScript 7 的原生 Go 二进制。
 *
 * 逻辑照抄 node_modules/typescript/lib/getExePath.js —— 那个文件没有出现在 typescript 的
 * exports map 里，import 不进来，只能复刻。二进制随平台分包发布，名字固定是 tsc（不是 tsgo，
 * 发布包的 bin 名决定的）。
 */
export function resolveTsgoExe(root) {
    const require = module.createRequire(path.join(root, 'package.json'));
    const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`;

    let exeDir;
    try {
        exeDir = path.join(path.dirname(require.resolve(`${platformPackage}/package.json`)), 'lib');
    } catch {
        throw new Error(
            `找不到 ${platformPackage}。要么当前平台不受支持，要么 node_modules 里缺这个包（先跑 npm install）。`,
        );
    }

    let exe = path.join(exeDir, 'tsc');
    if (process.platform === 'win32') {
        exe += '.exe';
        // Windows 的 MAX_PATH 是 260；接近上限时要切到扩展长度路径语法。
        if (exe.length >= 248) exe = `\\\\?\\${exe}`;
    }

    if (!fs.existsSync(exe)) {
        throw new Error(`二进制不存在：${exe}`);
    }
    return exe;
}
