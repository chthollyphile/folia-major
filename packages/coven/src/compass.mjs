import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENRES, TEMPOS, parseScopeName, runLabel, scopeLabel, scopeNameHelp, taskLabel, tempoLabel } from './catalogue.mjs';
import { githubIo, resolveClaims } from './claim.mjs';
import { COVEN_DIR, covenPath, hasState, loadState, nowIso, parseArgs, prLabel, readJson, writeJson } from './common.mjs';
import { openItemsOf, resolutionLabel } from './escalations.mjs';
import { scopeItems } from './scope.mjs';
import { runRecord } from './state.mjs';
// packages/coven/src/compass.mjs
// Coven Compass：维护者看运行、看认领、划范围的本机网页。`coven compass` 起一个只听 127.0.0.1 的服务。
//   运行：读 .coven/state.json（任务、阶段、轮数、用量、升级和决定、人类介入），页面每几秒刷新一次
//   认领：借本机 gh 读跟踪 issue 上的认领评论，用 resolveClaims 判定（和脚本同一套），页面里不放令牌
//   划范围：从适配层的来源列候选（风险级由脚本算），勾选后存成 .coven/scopes/<名字>.json，和 coven scope 生成的一样
//   历史：.coven/runs/ 下的运行记录和总结
// 它唯一会写的是范围文件：不写 GitHub，不改 .coven/state.json。写 GitHub 仍然只走监控 session 调的脚本。
// 防护：只认 Host 是 127.0.0.1 或 localhost 的请求（挡 DNS 重绑定）；接口要带页面里的一次性令牌（挡别的网页借浏览器来调）。

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../compass');
const ASSETS = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/compass.js': { file: 'compass.js', type: 'text/javascript; charset=utf-8' },
    '/compass.css': { file: 'compass.css', type: 'text/css; charset=utf-8' },
};
const DEFAULT_PORT = 4317;
const CLAIMS_TTL_MS = 30_000;
const MAX_BODY = 1024 * 1024;
const TOKEN_PLACEHOLDER = '%COVEN_TOKEN%';
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const usage = () => [
    `coven compass [--port ${DEFAULT_PORT}] [--open]`,
    '    在本机起 Coven Compass（只听 127.0.0.1）：看运行和认领、从适配层的来源划范围、看历史运行。',
    '    在监控 session 的检出里跑（.coven/ 在那里）。它只会写 .coven/scopes/ 下的范围文件，不写 GitHub。',
    '    --port 0 让系统挑一个空闲端口；--open 顺手用默认浏览器打开。Ctrl+C 停。',
].join('\n');

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// ---- 页面上要的数据（纯函数，测试直接调） ----

const issueUrl = (config, number) => (number ? `https://github.com/${config.repo}/issues/${number}` : null);
const pullUrl = (config, number) => (typeof number === 'number' ? `https://github.com/${config.repo}/pull/${number}` : null);

/** 账本 → “运行”一栏。没有运行返回 null。 */
export function runView(state, config, now = nowIso()) {
    if (!state) return null;
    const record = runRecord(state, state.finishedAt ?? now);
    const records = new Map(record.tasks.map(task => [task.task, task]));
    const ids = [...state.order.filter(id => state.tasks[id]), ...Object.keys(state.tasks).filter(id => !state.order.includes(id))];
    return {
        run: state.run, label: runLabel(state.run), dryRun: Boolean(state.dryRun),
        scope: state.scope, scopeLabel: scopeLabel(state.scope), owner: state.owner,
        integrationBranch: state.integrationBranch, trackingIssue: state.trackingIssue ?? null, trackingIssueUrl: issueUrl(config, state.trackingIssue),
        startedAt: state.startedAt, finishedAt: state.finishedAt ?? null,
        totals: record.totals,
        interventions: record.interventionLog,
        tasks: ids.map(id => {
            const task = state.tasks[id];
            const entry = records.get(id);
            return {
                id, label: taskLabel(id, task.title), title: task.title ?? null, risk: task.risk, tempo: tempoLabel(task.risk),
                phase: task.phase, rounds: task.rounds, tokens: task.tokens ?? 0, approxTokens: entry.approxTokens,
                pr: task.pr ?? null, prLabel: prLabel(task.pr), prUrl: pullUrl(config, task.pr), prTitle: task.prTitle ?? null,
                code: task.code ?? null, codes: entry.codes, escalations: entry.escalations, minutes: entry.minutes,
                session: task.session ?? null, branch: task.branch ?? null,
                lastVerdict: task.lastVerdict ? { round: task.lastVerdict.round, verdict: task.lastVerdict.verdict ?? null, passes: Boolean(task.lastVerdict.passes) } : null,
                history: task.history,
            };
        }),
        escalations: [
            ...(state.escalations ?? []).map(entry => ({
                id: entry.id, task: null, code: entry.code, items: entry.items, openItems: entry.resolution ? [] : openItemsOf(state, entry),
                question: entry.question ?? null, options: entry.options ?? [], lean: entry.lean ?? null,
                decision: entry.decision ?? null, open: !entry.resolution, result: resolutionLabel(entry),
            })),
            // 评审时升级（evaluator 判 escalate）、或者轮数和预算用完停下的任务：问题在最近一次评审结论里
            ...ids.filter(id => state.tasks[id].phase === 'blocked').map(id => {
                const task = state.tasks[id];
                const escalation = task.lastVerdict?.escalation ?? null;
                return {
                    id: null, task: id, code: task.code ?? escalation?.code ?? null, items: task.items, openItems: task.items,
                    question: escalation?.question ?? null, options: escalation?.options ?? [], lean: null,
                    decision: null, open: true, result: '任务停着：维护者决定继续的，用 --unblock-by 解封',
                };
            }),
        ],
        items: Object.entries(state.items).map(([key, item]) => ({ key, claim: item.claim?.state ?? null, task: item.task ?? null })),
    };
}

/** .coven/runs/ 下的运行记录，新的在前。读不了的跳过。 */
export function runHistory(root) {
    const dir = covenPath(root, 'runs');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
        try {
            const record = readJson(path.join(dir, name));
            return [{
                run: record.run, label: runLabel(record.run), scope: record.scope, scopeLabel: scopeLabel(record.scope), dryRun: Boolean(record.dryRun),
                startedAt: record.startedAt, finishedAt: record.finishedAt, totals: record.totals, interventionCount: record.interventionCount,
            }];
        } catch {
            return [];
        }
    }).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

/** 一次运行的记录和总结。 */
export function runDetail(root, run) {
    if (!/^[a-z0-9-]{1,64}$/.test(run)) throw new HttpError(400, '运行的名字不对');
    const file = covenPath(root, 'runs', `${run}.json`);
    if (!fs.existsSync(file)) throw new HttpError(404, `没有运行记录 ${run}`);
    const summary = covenPath(root, 'runs', `${run}.md`);
    return { record: readJson(file), summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : null };
}

/** .coven/scopes/ 下已有的范围，新的在前。 */
export function scopeList(root) {
    const dir = covenPath(root, 'scopes');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
        try {
            const scope = readJson(path.join(dir, name));
            return [{ name: scope.name, label: scopeLabel(scope.name), createdAt: scope.createdAt, count: scope.items?.length ?? 0, source: scope.source ?? null }];
        } catch {
            return [];
        }
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function scopeDetail(root, name) {
    if (!parseScopeName(name)) throw new HttpError(400, '范围名不对');
    const file = covenPath(root, 'scopes', `${name}.json`);
    if (!fs.existsSync(file)) throw new HttpError(404, `没有范围 ${name}`);
    return readJson(file);
}

/** 来源的选项值：页面传来的是 { 选项: [值] }，只收这个来源声明过的选项、字符串值。 */
function sourceOptions(source, options) {
    const allowed = source.options ?? [];
    const result = Object.fromEntries(allowed.map(option => [option, []]));
    for (const [option, values] of Object.entries(options ?? {})) {
        if (!allowed.includes(option)) throw new HttpError(400, `这个来源没有选项 ${option}（有：${allowed.join('、') || '无'}）`);
        if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || value.length > 300)) throw new HttpError(400, `选项 ${option} 要是字符串列表`);
        result[option] = values.map(value => value.trim()).filter(Boolean);
    }
    return result;
}

function sourceOf(adapter, name) {
    if (typeof name !== 'string' || !Object.hasOwn(adapter.sources, name)) throw new HttpError(400, `适配层 ${adapter.id} 没有来源 ${name}（有：${Object.keys(adapter.sources).join('、')}）`);
    return adapter.sources[name];
}

/** 一个来源按选项列出的候选（和 coven scope 一样，风险级由脚本算）。 */
export function candidateItems(host, { source, options }) {
    const options_ = sourceOptions(sourceOf(host.adapter, source), options);
    try {
        return scopeItems(host.adapter, { root: host.root, sources: [source], options: options_, riskRules: host.config.risk });
    } catch (error) {
        throw new HttpError(400, error?.message ?? String(error));
    }
}

/**
 * 页面勾选的条目 → 范围。picks 是 [{ source, options, keys }]：按同样的来源和选项在这边重新列一遍，只收列得出来的条目。
 * 页面传回来的条目对象不可信，风险级、敏感原因都要脚本算。
 */
export function buildScope(host, { name, picks }, now = nowIso()) {
    if (typeof name !== 'string' || !parseScopeName(name)) throw new HttpError(400, `范围名不合格。${scopeNameHelp()}`);
    if (!Array.isArray(picks) || picks.length === 0) throw new HttpError(400, '没有选任何条目');
    const items = [];
    const seen = new Set();
    const missing = [];
    for (const pick of picks) {
        if (!pick || !Array.isArray(pick.keys) || pick.keys.some(key => typeof key !== 'string')) throw new HttpError(400, '每组勾选要有 keys（条目 key 的列表）');
        const listed = new Map(candidateItems(host, pick).map(item => [item.key, item]));
        for (const key of pick.keys) {
            if (seen.has(key)) continue;
            const item = listed.get(key);
            if (!item) {
                missing.push(key);
                continue;
            }
            seen.add(key);
            items.push(item);
        }
    }
    if (missing.length > 0) throw new HttpError(409, `这些条目现在列不出来了（可能已经修掉，重新列一次）：${missing.slice(0, 10).join('，')}${missing.length > 10 ? '……' : ''}`);
    if (items.length === 0) throw new HttpError(400, '没有选任何条目');
    return {
        name, createdAt: now,
        source: { from: [...new Set(picks.map(pick => pick.source))], compass: picks.map(pick => ({ source: pick.source, options: sourceOptions(sourceOf(host.adapter, pick.source), pick.options) })) },
        items,
    };
}

/** 读账本，读不了（写坏了、旧格式）时带上原因，不抛出：页面照样要能开。 */
export function readStateSafely(root) {
    try {
        return { state: hasState(root) ? loadState(root) : null, error: null };
    } catch (error) {
        return { state: null, error: error?.message ?? String(error) };
    }
}

/**
 * 存范围。正在跑的运行用的范围不能覆盖；已有的同名范围要页面明确说覆盖。
 * 账本读不了时确认不了哪个范围正在用：新名字照存，覆盖已有的不行。
 */
export function saveScope(host, { name, picks, overwrite = false }) {
    const scope = buildScope(host, { name, picks });
    const { state, error } = readStateSafely(host.root);
    if (state && !state.finishedAt && state.scope === name) throw new HttpError(409, `范围 ${name} 是正在跑的 ${runLabel(state.run)} 用的，不能覆盖：换个名字`);
    const file = covenPath(host.root, 'scopes', `${name}.json`);
    const exists = fs.existsSync(file);
    if (exists && !overwrite) throw Object.assign(new HttpError(409, `已经有范围 ${name}`), { exists: true });
    if (exists && error) throw new HttpError(409, `读不了 .coven/state.json（${error}），确认不了范围 ${name} 是不是正在用，不覆盖：先修好账本，或者换个名字`);
    writeJson(file, scope);
    return { scope, file: `${COVEN_DIR}/scopes/${name}.json` };
}

/**
 * 认领评论 → “认领”一栏：每个条目现在归谁（和 coven claim status 同一套判定）。
 * mine：持有它的认领就是这个检出的监控 session 发的（claimId 对得上）。
 */
export function claimsView({ comments, state, config, itemPattern = null, now = Date.now(), issue }) {
    const resolved = resolveClaims(comments, { now, leaseHours: config.leaseHours, itemPattern });
    const mine = new Set(Object.values(state?.items ?? {}).map(item => item.claimId).filter(Boolean));
    const brief = claim => ({ owner: claim.owner, claimId: claim.claimId, state: claim.state, leaseUntil: claim.leaseUntil });
    const order = { held: 0, done: 1, free: 2 };
    const items = [...resolved.items.values()].map(resolution => ({
        item: resolution.item, status: resolution.status,
        holder: resolution.holder ? {
            ...brief(resolution.holder), pr: resolution.holder.pr ?? null, prLabel: prLabel(resolution.holder.pr), prUrl: pullUrl(config, resolution.holder.pr),
            code: resolution.holder.code ?? null, manual: resolution.holder.manual, mine: mine.has(resolution.holder.claimId),
        } : null,
        conflicts: resolution.conflicts.map(brief),
        expired: resolution.expired.map(brief),
    })).sort((a, b) => order[a.status] - order[b.status] || a.item.localeCompare(b.item));
    return { issue, issueUrl: issueUrl(config, issue), readAt: new Date(now).toISOString(), items, ignored: resolved.ignored };
}

/** 页面上告诉维护者下一步怎么说：宿主配了 npm script 就写 npm run coven:<命令> --，否则写 coven <命令>。 */
export function commandStyle(root) {
    const pkg = readJson(path.join(root, 'package.json'), null);
    return pkg?.scripts?.['coven:state'] ? 'npm' : 'coven';
}

/** 读跟踪 issue 上的评论：真评论借本机 gh，干跑的模拟评论在账本里。 */
function defaultReadComments({ state, config, issue }) {
    return githubIo(state ?? { dryComments: [], github: [] }, config, { dryRun: true, readRemote: true }).list(issue);
}

// ---- 服务 ----

function send(response, status, body, headers = {}) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    response.end(JSON.stringify(body));
}

/** 请求体按 JSON 读，要是对象。太大的不收：照常读完丢掉，先回 413（直接断开的话客户端只看到连接被重置）。 */
function readBody(request) {
    return new Promise((resolve, reject) => {
        let size = 0;
        let tooLarge = false;
        const chunks = [];
        request.on('data', chunk => {
            size += chunk.length;
            if (tooLarge) return;
            if (size > MAX_BODY) {
                tooLarge = true;
                chunks.length = 0;
                reject(new HttpError(413, '请求太大'));
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (tooLarge) return;
            let body;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            } catch {
                reject(new HttpError(400, '请求体不是合法的 JSON'));
                return;
            }
            if (!body || typeof body !== 'object' || Array.isArray(body)) reject(new HttpError(400, '请求体要是一个 JSON 对象'));
            else resolve(body);
        });
        request.on('error', reject);
    });
}

/** 路径里的名字解码；编码不对的是坏请求，不是服务出错。 */
function decodeName(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        throw new HttpError(400, '路径编码不对');
    }
}

const optionsFromQuery = (searchParams, source) => Object.fromEntries((source.options ?? [])
    .filter(option => searchParams.has(option))
    .map(option => [option, searchParams.get(option).split(',').map(value => value.trim()).filter(Boolean)]));

/**
 * Compass 的 HTTP 服务（还没 listen）。readComments 可以换掉（测试不连 GitHub）。
 * @returns {{ server: http.Server, token: string }}
 */
export function createCompassServer(host, { token = crypto.randomBytes(18).toString('base64url'), readComments = defaultReadComments } = {}) {
    const { root, config, adapter } = host;
    const claimsCache = { at: 0, view: null };
    // 旧格式或者写坏了的账本：页面照样能开，运行一栏显示读不了的原因
    const safeRunView = ({ state, error }) => {
        if (error) return { error };
        try {
            return runView(state, config);
        } catch (failure) {
            return { error: failure?.message ?? String(failure) };
        }
    };

    function loadClaims(refresh) {
        const { state } = readStateSafely(root);
        // 和 coven claim status 一样：有运行就读这次运行的跟踪 issue（干跑没有跟踪 issue 时只有账本里的模拟评论），没有运行读配置里的
        const issue = state ? state.trackingIssue ?? null : config.trackingIssue ?? null;
        if (!issue && !(state?.dryComments ?? []).some(comment => comment.issue === null || comment.issue === undefined)) {
            return { available: false, reason: state ? '这次运行没有跟踪 issue，也还没有干跑的认领' : '配置里没有 trackingIssue：认领评论发在跟踪 issue 上，没有它就没有可读的认领' };
        }
        if (!refresh && claimsCache.view && claimsCache.view.issue === issue && Date.now() - claimsCache.at < CLAIMS_TTL_MS) return { available: true, ...claimsCache.view };
        const comments = readComments({ state, config, issue });
        claimsCache.view = claimsView({ comments, state, config, itemPattern: adapter.itemKeyPattern ?? null, issue });
        claimsCache.at = Date.now();
        return { available: true, ...claimsCache.view };
    }

    /** 候选上标出谁持有（只用最近一次读到的认领，不为列候选去读 GitHub）。 */
    function annotate(items) {
        const byItem = new Map((claimsCache.view?.items ?? []).map(entry => [entry.item, entry]));
        return items.map(item => {
            const claim = byItem.get(item.key);
            return { ...item, claim: claim ? { status: claim.status, owner: claim.holder?.owner ?? null, state: claim.holder?.state ?? null, mine: Boolean(claim.holder?.mine) } : null };
        });
    }

    const routes = {
        '/api/overview': () => {
            const read = readStateSafely(root);
            return {
                repo: config.repo, adapter: adapter.id, root: path.basename(root), commandStyle: commandStyle(root),
                config: { leaseHours: config.leaseHours, concurrency: config.concurrency, maxReviewRounds: config.maxReviewRounds, budget: config.budget ?? null, trackingIssue: config.trackingIssue ?? null, trackingIssueUrl: issueUrl(config, config.trackingIssue), dryOnly: !config.hd0Confirmed },
                sources: Object.entries(adapter.sources).map(([name, source]) => ({ name, describe: source.describe, options: source.options ?? [], hasHints: typeof source.hints === 'function' })),
                tempos: TEMPOS, genres: GENRES, scopeNameHelp: scopeNameHelp(),
                run: safeRunView(read), runs: runHistory(root), scopes: scopeList(root),
                claimsReadAt: claimsCache.view?.readAt ?? null,
            };
        },
        '/api/hints': url => {
            const source = sourceOf(adapter, url.searchParams.get('source'));
            try {
                return { hints: source.hints ? source.hints({ root }) : {} };
            } catch (error) {
                throw new HttpError(500, `读选项的候选值出错：${error?.message ?? error}`);
            }
        },
        '/api/candidates': url => {
            const name = url.searchParams.get('source');
            const source = sourceOf(adapter, name);
            const options = optionsFromQuery(url.searchParams, source);
            return { source: name, options, items: annotate(candidateItems(host, { source: name, options })), claimsReadAt: claimsCache.view?.readAt ?? null };
        },
        '/api/claims': url => {
            try {
                return loadClaims(url.searchParams.get('refresh') === '1');
            } catch (error) {
                throw new HttpError(502, `读认领评论失败（要本机 gh 已登录）：${error?.message ?? error}`);
            }
        },
    };

    async function handle(request, response) {
        const port = server.address()?.port;
        const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
        if (!hosts.includes(request.headers.host ?? '')) throw new HttpError(403, 'Compass 只接受发给 127.0.0.1 或 localhost 的请求');
        const origin = request.headers.origin;
        if (origin && !hosts.some(entry => origin === `http://${entry}`)) throw new HttpError(403, '不接受别的网页发来的请求');
        const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
        if (request.method === 'GET' && Object.hasOwn(ASSETS, url.pathname)) {
            const asset = ASSETS[url.pathname];
            let body = fs.readFileSync(path.join(ASSETS_DIR, asset.file), 'utf8');
            if (asset.file === 'index.html') body = body.replace(TOKEN_PLACEHOLDER, token);
            response.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...(asset.file === 'index.html' ? { 'content-security-policy': PAGE_CSP } : {}) });
            response.end(body);
            return;
        }
        if (!url.pathname.startsWith('/api/')) throw new HttpError(404, '没有这个页面');
        // 接口都要带页面里的令牌：别的网页拿不到它，借浏览器来调也没用
        // 按字节比：字符数相同、字节数不同的令牌（非 ASCII）不能让 timingSafeEqual 抛错
        const given = Buffer.from(String(request.headers['x-coven-token'] ?? ''));
        const expected = Buffer.from(token);
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(403, '令牌不对：刷新 Compass 页面');
        if (request.method === 'GET') {
            if (Object.hasOwn(routes, url.pathname)) return send(response, 200, routes[url.pathname](url));
            const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
            if (runMatch) return send(response, 200, runDetail(root, decodeName(runMatch[1])));
            const scopeMatch = /^\/api\/scopes\/([^/]+)$/.exec(url.pathname);
            if (scopeMatch) return send(response, 200, scopeDetail(root, decodeName(scopeMatch[1])));
            throw new HttpError(404, '没有这个接口');
        }
        if (request.method === 'POST' && url.pathname === '/api/scopes') {
            if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, '要 application/json');
            const body = await readBody(request);
            try {
                const saved = saveScope(host, { name: body.name, picks: body.picks, overwrite: body.overwrite === true });
                return send(response, 200, { file: saved.file, name: saved.scope.name, count: saved.scope.items.length });
            } catch (error) {
                if (error?.exists) return send(response, 409, { error: error.message, exists: true });
                throw error;
            }
        }
        throw new HttpError(405, '不支持这个请求');
    }

    const server = http.createServer((request, response) => {
        handle(request, response).catch(error => {
            if (response.headersSent) return response.end();
            send(response, error instanceof HttpError ? error.status : 500, { error: error?.message ?? String(error) });
        });
    });
    return { server, token };
}

function openBrowser(url) {
    const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try {
        spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    } catch {
        // 打不开就算了，地址已经打印出来
    }
}

export async function run(host, argv) {
    const { options } = parseArgs(argv, ['open'], ['port']);
    const port = options.port === undefined ? DEFAULT_PORT : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port 要是 0–65535 的整数');
    const { server } = createCompassServer(host);
    await new Promise((resolve, reject) => {
        server.once('error', error => reject(error?.code === 'EADDRINUSE' ? new Error(`端口 ${port} 被占用了：换一个，比如 --port ${port + 1}，或者 --port 0`) : error));
        server.listen(port, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}/`;
    console.log(`Coven Compass：${url}`);
    console.log(`只听本机，读 ${path.join(host.root, COVEN_DIR)}；只会写 .coven/scopes/ 下的范围文件，不写 GitHub。Ctrl+C 停。`);
    if (options.open) openBrowser(url);
}
