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
    probe('tsgo 二进制', () => resolveTsgoExe(root));
    const gitOk = probe('git', () => execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 }).trim());
    probe('ripgrep', () => execFileSync('rg', ['--version'], { encoding: 'utf8', timeout: 5000 }).split('\n')[0]);

    const files = listFiles(root);
    console.log(`  · 文件清单: ${files.length} 个（来源 ${lastListSource()}）`);

    console.log('\n结论：');
    console.log('  - tsgo 不可用 → 所有工具都用不了，先跑 npm install');
    console.log(`  - git 不可用 → change_context 用不了；其余工具会自动退回文件系统扫描${gitOk ? '（当前不需要）' : '（当前正在退回）'}`);
    console.log('  - rg 不可用 → search 的全文兜底会退回纯 JS 搜索，只是慢一些');
}

if (toolName === 'doctor') {
    doctor();
    process.exit(0);
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
