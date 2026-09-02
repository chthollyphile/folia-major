#!/usr/bin/env node
import { runMain } from './mcpClient.mjs';
// dev/mcp/ts-code-map/smoke.mjs

/**
 * 跑一遍协议握手和全部工具，打印每个工具的耗时和输出体积。
 * 用法：node dev/mcp/ts-code-map/smoke.mjs
 */

const CASES = [
    ['find_symbol buildHomeModel', 'find_symbol', { query: 'buildHomeModel' }],
    ['file_outline VisualizerFume.tsx', 'file_outline', { file: 'src/components/visualizer/fume/VisualizerFume.tsx' }],
    ['inspect_symbol buildHomeModel', 'inspect_symbol', { symbol: 'buildHomeModel' }],
    ['references buildHomeModel', 'references', { symbol: 'buildHomeModel' }],
    ['references omni', 'references', { symbol: 'omni' }],
    ['callers buildHomeModel', 'callers', { symbol: 'buildHomeModel' }],
    ['callers buildHomeModel depth=3', 'callers', { symbol: 'buildHomeModel', depth: 3 }],
    ['callees buildHomeModel', 'callees', { symbol: 'buildHomeModel' }],
    ['search 整串符号', 'search', { query: 'buildHomeModel' }],
    ['search 自然语言多词', 'search', { query: 'lyric font size typography settings' }],
    ['search 文件名层', 'search', { query: 'dev-probe' }],
    ['search 全文层', 'search', { query: '探针页刻意开启' }],
    ['search 查不到', 'search', { query: 'zzz-no-such-thing-anywhere-42' }],
    ['dependency_graph registry (glob 展开)', 'dependency_graph', { target: 'src/components/visualizer/registry.tsx', direction: 'forward' }],
    ['dependency_graph omni reverse', 'dependency_graph', { target: 'src/services/onlineMusic/omni.ts', direction: 'reverse' }],
    ['impact buildHomeModel', 'impact', { target: 'buildHomeModel' }],
    ['impact omni.ts', 'impact', { target: 'src/services/onlineMusic/omni.ts', depth: 1 }],
    ['change_context', 'change_context', {}],
    ['batch 三合一', 'batch', { calls: [
        { tool: 'find_symbol', args: { query: 'omni' } },
        { tool: 'file_outline', args: { file: 'src/components/visualizer/registry.tsx' } },
        { tool: 'references', args: { symbol: 'defineCommand' } },
    ] }],
    ['[错误路径] 不存在的符号', 'inspect_symbol', { symbol: 'ThisDoesNotExistAnywhere' }],
    ['[错误路径] 非函数取调用链', 'callers', { symbol: 'SongResult' }],
];

await runMain(async client => {
    const { result } = await client.request('tools/list', {});
    console.log(`tools (${result.tools.length}): ${result.tools.map(t => t.name).join(', ')}`);
    console.log(`tool schema 总字节数: ${Buffer.byteLength(JSON.stringify(result.tools))}\n`);

    let failures = 0;
    for (const [label, tool, args] of CASES) {
        const started = Date.now();
        const { text, isError } = await client.callTool(tool, args);
        const expectedError = label.startsWith('[错误路径]');
        if (isError !== expectedError) failures++;
        const tag = isError ? (expectedError ? '预期内报错' : '意外报错') : '';
        console.log(`${String(Date.now() - started).padStart(5)}ms  ${String(Buffer.byteLength(text)).padStart(6)}B  ${label}  ${tag}`);
    }

    console.log(failures === 0 ? '\n全部用例符合预期 ✓' : `\n有 ${failures} 个用例结果不符合预期 ✗`);
    if (failures > 0) throw new Error(`${failures} 个用例失败`);
});
