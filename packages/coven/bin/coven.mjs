#!/usr/bin/env node
import { HelpRequested, runCli } from '../src/common.mjs';
import { loadHost } from '../src/host.mjs';
// packages/coven/bin/coven.mjs
// Coven 的命令行入口：coven <命令> [参数]。在宿主仓库（或它的 worktree）里任意目录运行；配置和适配层由 host.mjs 找。

const COMMANDS = {
    scope: { file: '../src/scope.mjs', what: '从适配层的来源生成范围（HD1）' },
    state: { file: '../src/state.mjs', what: '运行的账本：开始、阶段、用量、人类介入、收尾、审计' },
    claim: { file: '../src/claim.mjs', what: 'coven: 认领评论：认领、续租、改状态、释放' },
    prompt: { file: '../src/prompt.mjs', what: '把角色模板填成提示' },
    contract: { file: '../src/contract.mjs', what: '导入、展示、批准契约（HD2），记录评审结论' },
    verify: { file: '../src/verify.mjs', what: '在工作 worktree 里跑确定性验收和关口' },
    pr: { file: '../src/pr.mjs', what: '开 PR、合并（只进集成分支）' },
    setup: { file: '../src/setup.mjs', what: '按适配层准备一个工作 worktree（装依赖等）' },
    compass: { file: '../src/compass.mjs', what: '本机网页：看运行和认领、划范围、看历史（只写范围文件）' },
};

const HELP = ['--help', '-h'];

const usage = () => `用法：coven <命令> [参数]\n${Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(9)} ${command.what}`).join('\n')}\n\ncoven <命令> --help 看每个命令的子命令和选项。`;

runCli(async () => {
    const [command, ...argv] = process.argv.slice(2);
    if (!command || HELP.includes(command) || command === 'help') {
        console.log(usage());
        return;
    }
    if (!Object.hasOwn(COMMANDS, command)) throw new Error(`不认识的命令 ${command}\n${usage()}`);
    const host = await loadHost();
    const module = await import(COMMANDS[command].file);
    // 每个命令都认 --help：解析参数时在选项的位置遇到它就停下（common.mjs 的 parseArgs），
    // 这里打印这个命令自己的用法（有的要看适配层，比如 scope 的来源、setup 的开关）。各命令都先解析参数再动手，所以什么都没做
    try {
        await module.run(host, argv);
    } catch (error) {
        if (!(error instanceof HelpRequested)) throw error;
        console.log(module.usage(host));
    }
});
