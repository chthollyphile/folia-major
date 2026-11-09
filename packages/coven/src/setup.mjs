import fs from 'node:fs';
import path from 'node:path';
import { STATE_FILE, parseArgs } from './common.mjs';
// packages/coven/src/setup.mjs
// 按适配层准备一个工作 worktree（Folia：装依赖、要跑 ESLint 时装隔离环境）。generator 开工第一步在自己的 worktree 根目录里跑，
// 不要自己想办法绕过装不上的依赖：退路由适配层统一定，verify 会把“少装了什么”记进结果。
//
//   coven setup [--worktree <路径>] [适配层的开关]     不给路径就是当前所在的 worktree；开关由适配层的 worktree.flags 定

export async function run(host, argv) {
    const flags = host.adapter.worktree.flags ?? [];
    const { options } = parseArgs(argv, ['help', ...flags], ['worktree']);
    if (options.help) {
        console.log(`coven setup [--worktree <路径>]${flags.map(flag => ` [--${flag}]`).join('')}`);
        return;
    }
    // 监控 session 的检出里有 .coven/state.json：没写 --worktree 多半是在错的目录里跑（子代理的工作目录被重置回了监控 session 那里）
    if (!options.worktree && fs.existsSync(path.join(host.root, STATE_FILE))) {
        throw new Error('这里是监控 session 的检出，不是工作 worktree：先 cd 进你的 worktree，或者写 --worktree <路径>');
    }
    const worktree = path.resolve(options.worktree ?? host.root);
    const setup = host.adapter.worktree.setup;
    if (!setup) {
        console.log(`适配层 ${host.adapter.id} 没有准备步骤，worktree 不用准备。`);
        return;
    }
    await setup({ root: host.root, worktree, flags: Object.fromEntries(flags.map(flag => [flag, Boolean(options[flag])])) });
    for (const note of host.adapter.worktree.inspect?.(worktree) ?? []) console.log(`注意：${note}`);
}
