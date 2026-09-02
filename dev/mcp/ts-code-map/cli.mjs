#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { listFiles, lastListSource } from './files.mjs';
import { resolveTsgoExe } from './lsp/exePath.mjs';
import { runMain } from './mcpClient.mjs';
// dev/mcp/ts-code-map/cli.mjs

/**
 * 不带 MCP 客户端也能调这些工具。
 *
 *   node dev/mcp/ts-code-map/cli.mjs list
 *   node dev/mcp/ts-code-map/cli.mjs doctor
 *   node dev/mcp/ts-code-map/cli.mjs find_symbol '{"query":"buildHomeModel"}'
 */

const [, , toolName, argsJson] = process.argv;

if (!toolName || toolName === '--help' || toolName === '-h') {
    console.log(`用法: node dev/mcp/ts-code-map/cli.mjs <tool|list|doctor> [JSON 参数]

  list    列出全部工具和说明
  doctor  检查环境（tsgo 二进制、git、rg），排查工具异常时先跑这个`);
    process.exit(toolName ? 0 : 2);
}

/** 环境自检。工具行为异常时，先确认是环境问题还是代码问题。 */
function doctor() {
    const root = process.cwd();
    const probe = (label, fn) => {
        try {
            console.log(`  ✓ ${label}: ${fn()}`);
            return true;
        } catch (error) {
            console.log(`  ✗ ${label}: ${error.message}`);
            return false;
        }
    };

    console.log('ts-code-map 环境检查\n');
    const tsgoOk = probe('tsgo 二进制', () => resolveTsgoExe(root));
    const gitOk = probe('git', () => execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim());
    const rgOk = probe('ripgrep', () => execFileSync('rg', ['--version'], { encoding: 'utf8', timeout: 5000 }).split('\n')[0]);

    // 分开报总数和源文件数：代码地图只统计源文件，两个数字对不上会让人以为清单错了。
    const files = listFiles(root);
    const sources = files.filter(file => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)).length;
    console.log(`  · 文件清单: ${files.length} 个（其中源文件 ${sources} 个，来源 ${lastListSource()}）`);

    // 只报当前真实受影响的能力。原先这里无条件打印三条「不可用会怎样」，全绿时读起来像三条故障。
    const problems = [];
    if (!tsgoOk) problems.push('tsgo 找不到 → 所有工具都用不了。跑 npm install 重装 typescript。');
    if (!gitOk) problems.push('git 不可用 → change_context 用不了；文件清单已退回文件系统扫描，可能混进构建产物。');
    if (!rgOk) problems.push('rg 不可用 → search 的全文兜底改用纯 JS 搜索，只是慢一些，结果一致。');

    if (problems.length === 0) {
        console.log('\n环境正常，全部工具可用。');
        return true;
    }
    console.log('\n需要处理：');
    for (const problem of problems) console.log(`  - ${problem}`);
    // 只有 tsgo 缺失是致命的，另外两个都有退路——退出码要能区分，便于脚本判断。
    return tsgoOk;
}

if (toolName === 'doctor') {
    process.exit(doctor() ? 0 : 1);
}

let args = {};
if (argsJson) {
    try {
        args = JSON.parse(argsJson);
    } catch (error) {
        console.error(`参数不是合法 JSON: ${argsJson}\n  ${error.message}`);
        process.exit(2);
    }
}

await runMain(async client => {
    if (toolName === 'list') {
        const { result } = await client.request('tools/list', {});
        for (const tool of result.tools) console.log(`${tool.name}\n  ${tool.description}\n`);
        return;
    }
    const { text, isError } = await client.callTool(toolName, args);
    console.log(text);
    if (isError) throw new Error('工具返回错误（见上）');
});
