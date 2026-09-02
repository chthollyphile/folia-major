import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolveTsgoExe } from './exePath.mjs';
// dev/mcp/ts-code-map/lsp/client.mjs

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OPEN_DOCS = 40;
/** 没有任何 didOpen 之前 workspace/symbol 恒返回 []，启动时必须先拿一个文件把 project 拉起来。 */
const SEED_FILES = ['src/types.ts', 'src/App.tsx', 'index.ts'];

const languageIdFor = file =>
    file.endsWith('.tsx') ? 'typescriptreact'
    : file.endsWith('.jsx') ? 'javascriptreact'
    : /\.(js|cjs|mjs)$/.test(file) ? 'javascript'
    : 'typescript';

export class TsgoClient {
    constructor(root) {
        this.root = root;
        this.proc = null;
        this.buffer = Buffer.alloc(0);
        this.nextId = 0;
        this.pending = new Map();
        /** relPath -> { version, mtimeMs } —— agent 边查边改，靠 mtime 决定是否重推全文。 */
        this.open = new Map();
        this.starting = null;
    }

    uriFor(relPath) {
        return pathToFileURL(path.resolve(this.root, relPath)).href;
    }

    relFor(uri) {
        return path.relative(this.root, fileURLToPath(uri)).split(path.sep).join('/');
    }

    async start() {
        if (this.starting) return this.starting;
        this.starting = this.#boot();
        return this.starting;
    }

    async #boot() {
        this.proc = spawn(resolveTsgoExe(this.root), ['--lsp', '-stdio'], {
            cwd: this.root,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.proc.stdout.on('data', chunk => this.#onData(chunk));
        this.proc.stderr.resume();
        this.proc.on('exit', () => {
            for (const { reject } of this.pending.values()) reject(new Error('tsgo 进程已退出'));
            this.pending.clear();
        });

        const rootUri = pathToFileURL(this.root).href;
        await this.request('initialize', {
            processId: process.pid,
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
            capabilities: {
                workspace: {
                    workspaceFolders: true,
                    symbol: { dynamicRegistration: false },
                    didChangeWatchedFiles: { dynamicRegistration: true },
                    configuration: true,
                },
                textDocument: {
                    synchronization: { dynamicRegistration: false },
                    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                    definition: { linkSupport: false },
                    references: {},
                    hover: { contentFormat: ['markdown', 'plaintext'] },
                    documentHighlight: {},
                    callHierarchy: {},
                },
            },
        });
        this.notify('initialized', {});

        const seed = SEED_FILES.find(f => fs.existsSync(path.join(this.root, f)));
        // 直接同步文档，不能走 ensureOpen —— 那个会 await start()，而我们就在 start() 里。
        if (seed) this.#syncDoc(seed);
    }

    #onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        for (;;) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) return;
            const header = this.buffer.subarray(0, headerEnd).toString('ascii');
            const match = /content-length:\s*(\d+)/i.exec(header);
            if (!match) {
                this.buffer = this.buffer.subarray(headerEnd + 4);
                continue;
            }
            const length = Number(match[1]);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length) return;
            const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
            this.buffer = this.buffer.subarray(bodyStart + length);
            try {
                this.#dispatch(JSON.parse(body));
            } catch {
                /* 单条消息解析失败不该拖垮整个连接 */
            }
        }
    }

    #dispatch(msg) {
        // 服务端会在 initialized 之后反过来请求 workspace/configuration 和
        // client/registerCapability。不应答的话它会一直等，后续所有请求全部挂死。
        if (msg.method && msg.id !== undefined) {
            const result = msg.method === 'workspace/configuration'
                ? (msg.params?.items ?? []).map(() => null)
                : null;
            this.#send({ jsonrpc: '2.0', id: msg.id, result });
            return;
        }
        if (msg.id === undefined) return; // 通知（logMessage / publishDiagnostics）一律忽略
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(`${msg.error.message ?? 'LSP 错误'} (${msg.error.code})`));
        else entry.resolve(msg.result);
    }

    #send(payload) {
        const body = JSON.stringify(payload);
        this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    }

    request(method, params) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} 超时（${REQUEST_TIMEOUT_MS}ms）`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            this.#send({ jsonrpc: '2.0', id, method, params });
        });
    }

    notify(method, params) {
        this.#send({ jsonrpc: '2.0', method, params });
    }

    /** 保证文件在服务端是最新的；mtime 变了就整篇重推，没变就什么都不做。 */
    async ensureOpen(relPath) {
        await this.start();
        return this.#syncDoc(relPath);
    }

    /** ensureOpen 的实体，不 await start()，好让 #boot 能直接调用它推种子文件。 */
    #syncDoc(relPath) {
        const abs = path.resolve(this.root, relPath);
        const stat = fs.statSync(abs);
        const uri = this.uriFor(relPath);
        const tracked = this.open.get(relPath);

        if (tracked && tracked.mtimeMs === stat.mtimeMs) {
            this.open.delete(relPath);
            this.open.set(relPath, tracked); // 触碰一下，维持 LRU 顺序
            return uri;
        }

        const text = fs.readFileSync(abs, 'utf8');
        if (tracked) {
            const version = tracked.version + 1;
            this.notify('textDocument/didChange', {
                textDocument: { uri, version },
                contentChanges: [{ text }],
            });
            this.open.delete(relPath);
            this.open.set(relPath, { version, mtimeMs: stat.mtimeMs });
        } else {
            this.notify('textDocument/didOpen', {
                textDocument: { uri, languageId: languageIdFor(relPath), version: 1, text },
            });
            this.open.set(relPath, { version: 1, mtimeMs: stat.mtimeMs });
            this.#evict();
        }
        return uri;
    }

    #evict() {
        while (this.open.size > MAX_OPEN_DOCS) {
            const oldest = this.open.keys().next().value;
            this.open.delete(oldest);
            this.notify('textDocument/didClose', { textDocument: { uri: this.uriFor(oldest) } });
        }
    }

    /**
     * tsgo 会捕获 SIGTERM 等 LSP 的 exit 通知，光 kill() 会留下孤儿进程（实测跑完一次
     * 之后它还在，占着 ~19MB）。所以先按协议发 exit，再直接 SIGKILL 兜底。
     */
    dispose() {
        if (!this.proc || this.proc.killed) return;
        try {
            this.notify('exit', undefined);
        } catch {
            /* stdin 可能已经关了，忽略 */
        }
        this.proc.kill('SIGKILL');
    }
}
