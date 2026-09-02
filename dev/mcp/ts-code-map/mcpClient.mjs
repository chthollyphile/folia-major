import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
// dev/mcp/ts-code-map/mcpClient.mjs

/**
 * cli.mjs 和 smoke.mjs 共用的 MCP 客户端。
 *
 * 这里的每一处防御都对应一个真实故障：只要有一个请求永远不 settle，调用方的 top-level await
 * 就会挂住，Node 最后只吐一句 "Detected unsettled top-level await"，完全看不出哪里坏了。
 * 所以：子进程 error/exit 要唤醒所有等待者、每个请求要有超时、stdout 脏行不能抛异常。
 */

const DEFAULT_TIMEOUT_MS = 60_000;

export function connect({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '../../..');

    const server = spawn(process.execPath, [path.join(here, 'server.mjs'), root], { cwd: root });
    server.stderr.pipe(process.stderr);

    let nextId = 0;
    const pending = new Map();
    let dead = null;

    const failAll = reason => {
        dead ??= reason;
        for (const { reject, timer } of pending.values()) {
            clearTimeout(timer);
            reject(new Error(reason));
        }
        pending.clear();
    };

    server.on('error', error => failAll(`MCP server 启动失败: ${error.message}`));
    server.on('exit', (code, signal) => failAll(`MCP server 已退出 (code=${code} signal=${signal})`));

    readline.createInterface({ input: server.stdout }).on('line', line => {
        if (!line.trim()) return;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            // stdout 混进了非 JSON（比如某个工具误用了 console.log）。丢掉这一行，
            // 但绝不能让异常冒到 readline 的事件回调里去——那会直接干掉整个进程。
            process.stderr.write(`[warn] 忽略非 JSON 输出: ${line.slice(0, 120)}\n`);
            return;
        }
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        entry.resolve(msg);
    });

    const request = (method, params) => new Promise((resolve, reject) => {
        if (dead) { reject(new Error(dead)); return; }
        const id = ++nextId;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`${method} 超时（${timeoutMs}ms）——server 可能卡在某个工具里`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
            server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        } catch (error) {
            pending.delete(id);
            clearTimeout(timer);
            reject(new Error(`写入 server stdin 失败: ${error.message}`));
        }
    });

    const notify = method => {
        try {
            server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
        } catch { /* server 已经没了，调用方会从别处拿到错误 */ }
    };

    return {
        root,
        request,
        notify,
        close() {
            failAll('客户端主动关闭');
            if (!server.killed) server.kill();
        },
        async handshake() {
            await request('initialize', {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: { name: 'ts-code-map-cli', version: '0' },
            });
            notify('notifications/initialized');
        },
        async callTool(name, args) {
            const message = await request('tools/call', { name, arguments: args ?? {} });
            if (message.error) return { text: `协议错误: ${message.error.message}`, isError: true };
            return {
                text: message.result?.content?.[0]?.text ?? '(无输出)',
                isError: Boolean(message.result?.isError),
            };
        },
    };
}

/**
 * 把 main 包起来：任何异常都打印成人话并以非 0 退出，绝不留下未 settle 的 top-level await。
 */
export async function runMain(main) {
    const client = connect();
    try {
        await client.handshake();
        await main(client);
        client.close();
        process.exit(0);
    } catch (error) {
        process.stderr.write(`\n失败: ${error.message}\n`);
        client.close();
        process.exit(1);
    }
}
