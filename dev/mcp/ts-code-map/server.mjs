#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { TsgoClient } from './lsp/client.mjs';
import findSymbol from './tools/findSymbol.mjs';
import fileOutline from './tools/fileOutline.mjs';
import inspectSymbol from './tools/inspectSymbol.mjs';
import references from './tools/references.mjs';
import search from './tools/search.mjs';
import { callers, callees } from './tools/callHierarchy.mjs';
import dependencyGraph from './tools/dependencyGraph.mjs';
import impact from './tools/impact.mjs';
import changeContext from './tools/changeContext.mjs';
import batch from './tools/batch.mjs';
// dev/mcp/ts-code-map/server.mjs

/**
 * ts-code-map MCP server：把 TypeScript 的 LSP 能力包成 agent 能直接用的几个工具。
 *
 * 传输用 MCP 的 stdio 约定（一行一条 JSON-RPC），与内部 tsgo 的 Content-Length 分帧
 * 不是一回事，两者在 lsp/client.mjs 里隔开。这个文件只做协议和分发。
 */

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const TOOLS = [search, findSymbol, fileOutline, inspectSymbol, references, callers, callees, dependencyGraph, impact, changeContext, batch];
const toolsByName = new Map(TOOLS.map(tool => [tool.name, tool]));

const root = path.resolve(process.argv[2] ?? process.env.TS_CODE_MAP_ROOT ?? process.cwd());
const client = new TsgoClient(root);
const ctx = { client, root };
// batch 需要能回头调别的工具，所以把调度器注入 ctx。
ctx.runTool = async (name, args) => {
    const tool = toolsByName.get(name);
    if (!tool) throw new Error(`未知工具: ${name}。可用: ${[...toolsByName.keys()].join('、')}`);
    validateArgs(tool, args ?? {});
    return tool.run(ctx, args ?? {});
};

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * 参数名对不上时要当场说清楚。
 *
 * 之前传错参数名会漏出内部错误——`file_outline({paths})` 报 `"paths[1]" argument must be of
 * type string`（Node 的 path.resolve 漏出来的），`find_symbol({name})` 报一句 Go 的
 * unmarshal 错误。两者都完全看不出正确字段叫什么，只能靠猜。
 */
function validateArgs(tool, args) {
    const schema = tool.inputSchema ?? {};
    const known = Object.keys(schema.properties ?? {});
    const required = schema.required ?? [];

    const missing = required.filter(key => args[key] === undefined);
    if (missing.length > 0) {
        const unknown = Object.keys(args).filter(key => !known.includes(key));
        const hint = unknown.length > 0 ? `。收到的是 ${unknown.map(k => `\`${k}\``).join('、')}，可能是名字写错了` : '';
        throw new Error(
            `${tool.name} 缺少必填参数 ${missing.map(k => `\`${k}\``).join('、')}${hint}。`
            + `\n该工具接受: ${known.map(k => (required.includes(k) ? `${k}(必填)` : k)).join('、')}`,
        );
    }
}

async function callTool(params) {
    const tool = toolsByName.get(params?.name);
    if (!tool) {
        throw new Error(`未知工具: ${params?.name}。可用: ${[...toolsByName.keys()].join('、')}`);
    }
    const args = params.arguments ?? {};
    validateArgs(tool, args);
    const text = await tool.run(ctx, args);
    return { content: [{ type: 'text', text: text || '(空结果)' }] };
}

async function handle(message) {
    const { id, method, params } = message;
    const isRequest = id !== undefined && id !== null;

    switch (method) {
        case 'initialize':
            return reply(id, {
                // 回声客户端请求的版本：这个 server 只提供 tools，各版本行为一致。
                protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: 'ts-code-map', version: '0.1.0' },
            });
        case 'notifications/initialized':
        case 'notifications/cancelled':
            return;
        case 'ping':
            return reply(id, {});
        case 'tools/list':
            return reply(id, {
                tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
            });
        case 'tools/call':
            try {
                return reply(id, await callTool(params));
            } catch (error) {
                // 工具级失败作为结果回传（isError），不是协议错误 —— agent 需要读到原因才能改参数重试。
                return reply(id, { content: [{ type: 'text', text: `错误: ${error.message}` }], isError: true });
            }
        default:
            if (isRequest) replyError(id, -32601, `未实现的方法: ${method}`);
    }
}

readline.createInterface({ input: process.stdin }).on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
        message = JSON.parse(trimmed);
    } catch {
        return; // 非 JSON 行直接丢弃，不要因为一行脏数据断掉连接
    }
    handle(message).catch(error => {
        if (message.id !== undefined && message.id !== null) {
            replyError(message.id, -32603, error.message);
        }
    });
});

// 退出路径要全兜住：MCP 客户端可能发信号，也可能只是关掉 stdin。漏一条就留下孤儿 tsgo。
const shutdown = () => { client.dispose(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
process.on('exit', () => client.dispose());
process.stdin.on('close', shutdown);
process.stdin.on('end', shutdown);
