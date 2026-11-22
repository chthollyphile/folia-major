'use strict';

const net = require('net');

// sources/netease/main/backendLifecycle.cjs
// 原是宿主的 electron/backendLifecycle.cjs（宿主的两个内嵌后端共用）。它们都搬成音源模组后宿主不再用它，原件随网易
// 一起搬到这里（另一家在自己的 main/ 里有一份拷贝）。内嵌后端的生命周期工具：
// - createBackendStatus：后端状态的唯一来源，每次变化都广播给所有窗口（渲染进程据此显示故障与重启入口）；
// - createStartupRecorder：把一次拉起拆成有名字的步骤，逐步记下耗时、结果与错误，同一份记录既打到日志，
//   也进诊断报告——「后端起不来」时用户贴回来的报告里能直接看到卡在哪一步、错误原文是什么；
// - describeError：错误的完整文字（含 Node 错误码与 cause），用于状态与日志；
// - waitUntilListening：server.listen() 之后等真正绑定成功，绑定失败变成 rejection 而不是未处理的 'error' 事件。

const MAX_STARTUP_RUNS = 3;

/** 错误的完整描述：message 不含错误码时补上，cause 接在后面。 */
function describeError(error) {
    if (typeof error === 'string') return error.trim() || 'Unknown error';
    if (!(error instanceof Error)) {
        if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
        return 'Unknown error';
    }
    const code = typeof error.code === 'string' || typeof error.code === 'number' ? String(error.code) : '';
    const message = error.message || error.name || 'Unknown error';
    const head = code && !message.includes(code) ? `${code}: ${message}` : message;
    const cause = error.cause instanceof Error ? describeError(error.cause) : '';
    return cause && !head.includes(cause) ? `${head} (cause: ${cause})` : head;
}

/**
 * 后端状态：{ status, port, error, updatedAt }。update 合并字段并广播；get 返回当前值（同一个对象，直到下次 update）。
 */
function createBackendStatus({ channel, broadcast, now = Date.now, initialStatus = 'starting' }) {
    let status = { status: initialStatus, port: null, error: null, updatedAt: now() };
    return {
        get: () => status,
        update(patch) {
            status = { ...status, ...patch, updatedAt: now() };
            try {
                broadcast(channel, status);
            } catch (error) {
                console.warn(`[Backend] failed to broadcast ${channel}`, error);
            }
            return status;
        },
    };
}

/**
 * 拉起步骤记录：begin() 开始一轮，step(id, fn) 运行并记录一步（fn 收到 note(detail) 用来补充这一步的细节），
 * finish(outcome) 结束一轮。保留最近几轮（重启后端会产生新的一轮），snapshot() 给诊断报告。
 */
function createStartupRecorder({ name, now = Date.now, logger = console }) {
    const runs = [];
    let current = null;

    const begin = () => {
        current = { startedAt: now(), finishedAt: null, outcome: 'running', steps: [] };
        runs.push(current);
        if (runs.length > MAX_STARTUP_RUNS) runs.shift();
        logger.info(`[${name}] startup begin`);
        return current;
    };

    const step = async (id, fn) => {
        const run = current ?? begin();
        const entry = { id, startedAt: now(), durationMs: null, outcome: 'running', detail: {}, error: null };
        run.steps.push(entry);
        const note = (detail) => {
            Object.assign(entry.detail, detail);
        };
        try {
            const result = await fn(note);
            entry.outcome = 'ok';
            return result;
        } catch (error) {
            entry.outcome = 'failed';
            entry.error = describeError(error);
            throw error;
        } finally {
            entry.durationMs = now() - entry.startedAt;
            const level = entry.outcome === 'failed' ? 'warn' : 'info';
            logger[level](`[${name}] startup step ${id}: ${entry.outcome} (${entry.durationMs}ms)`, {
                ...entry.detail,
                ...(entry.error ? { error: entry.error } : {}),
            });
        }
    };

    const finish = (outcome) => {
        if (!current) return;
        current.outcome = outcome;
        current.finishedAt = now();
        logger[outcome === 'failed' ? 'warn' : 'info'](`[${name}] startup ${outcome} (${current.finishedAt - current.startedAt}ms)`);
        current = null;
    };

    const snapshot = () => runs.map(run => ({
        ...run,
        steps: run.steps.map(entry => ({ ...entry, detail: { ...entry.detail } })),
    }));

    return { begin, step, finish, snapshot };
}

/**
 * 等 server 真正开始监听。listen() 是异步的：端口被抢、权限不足都只会以 'error' 事件出现，
 * 没人听时会变成主进程的未捕获异常。这里把它变成 rejection。
 */
function waitUntilListening(server) {
    return new Promise((resolve, reject) => {
        if (server.listening) {
            resolve(server);
            return;
        }

        const onListening = () => {
            server.removeListener('error', onError);
            resolve(server);
        };

        const onError = (error) => {
            server.removeListener('listening', onListening);
            reject(error);
        };

        server.once('listening', onListening);
        server.once('error', onError);
    });
}

/**
 * 向系统要一个空闲端口。只代表「刚才是空的」：真正 listen 时仍可能被抢，调用方必须等 waitUntilListening。
 */
function findFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, () => {
            const { port } = probe.address();
            probe.close((error) => {
                if (error) reject(error);
                else resolve(port);
            });
        });
    });
}

/** 绑定成功之后，server 上再出的错（例如连接层异常）只记日志，不能带着主进程一起退出。 */
function keepServerErrorsLogged(server, label) {
    server.on('error', (error) => {
        console.error('[BackendLifecycle] server error', label, error);
    });
}

module.exports = {
    createBackendStatus,
    createStartupRecorder,
    describeError,
    findFreePort,
    keepServerErrorsLogged,
    waitUntilListening,
};
