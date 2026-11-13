// 当前文件：把 qishui-music-api 包装为 Folia Docker 栈的常驻 HTTP 服务。
// 桌面端由 Electron 主进程持有会话并通过 IPC 暴露给渲染进程；Web 端没有 Electron，
// 所以这里用一个独立的 Node 服务承载协议实现，前端通过 gateway 的 /qishui/ 反代调用。
// 会话以 JSON 文件持久化到 /app/data，多实例部署不要共用同一个数据卷。

const fs = require('fs');
const path = require('path');
const express = require('express');
const { createQishuiApi, createQishuiDeviceId, isQishuiDeviceId, QISHUI_OPERATIONS } = require('qishui-music-api');

const DATA_DIR = process.env.QISHUI_DATA_DIR || '/app/data';
const SESSION_FILE = path.join(DATA_DIR, 'qishui-session.json');
const DEVICE_FILE = path.join(DATA_DIR, 'qishui-device.json');

const isAccountId = (value) => typeof value === 'string' && value.length > 0;

// 文件会话存储：deviceId 和 session 分别落盘，session 含账号票据。
function createFileSessionStore() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    let deviceId;
    try {
        const raw = fs.readFileSync(DEVICE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        deviceId = isQishuiDeviceId(parsed?.deviceId) ? parsed.deviceId : createQishuiDeviceId();
    } catch {
        deviceId = createQishuiDeviceId();
        fs.writeFileSync(DEVICE_FILE, JSON.stringify({ deviceId }));
    }

    let current = null;
    let loaded = false;
    let revision = 0;

    return {
        get deviceId() { return deviceId; },
        get revision() { return revision; },
        get() {
            if (!loaded) {
                loaded = true;
                try {
                    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
                    const value = JSON.parse(raw);
                    if (value && isAccountId(value.userId) && value.ticket && value.guardKey
                        && value.guardCert && value.guardTsSign && value.accessCode
                        && Number.isFinite(value.expiresAt)) {
                        current = value;
                    }
                } catch { /* 没有或无法读取会话时保持未登录 */ }
            }
            return current;
        },
        set(value) {
            current = { ...value, version: 1 };
            revision += 1;
            try {
                fs.writeFileSync(SESSION_FILE, JSON.stringify(current));
            } catch (error) {
                console.warn('[Qishui] 无法持久化会话，本次运行保留在内存中', error?.message);
            }
        },
        clear() {
            current = null;
            revision += 1;
            try { fs.unlinkSync(SESSION_FILE); } catch { /* 文件不存在时忽略 */ }
        },
    };
}

const sessions = createFileSessionStore();
const api = createQishuiApi({
    deviceId: sessions.deviceId,
    sessions,
    fetch: globalThis.fetch,
    log: (message) => console.info('[Qishui]', message),
});

const app = express();
app.use(express.json({ limit: '1mb' }));

// 健康检查
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'folia-qishui-api' });
});

// 统一请求入口：前端 POST { operation, params }，返回 QishuiBridgeResult。
app.post('/request', async (req, res) => {
    const { operation, params = {} } = req.body || {};
    if (!QISHUI_OPERATIONS.includes(operation)) {
        return res.status(400).json({
            ok: false,
            error: { code: 'unsupported', message: `Unsupported Qishui operation: ${operation}` },
        });
    }
    try {
        const result = await api.request(operation, params);
        res.json(result);
    } catch (error) {
        console.warn('[Qishui] request failed', { operation }, error);
        res.status(200).json({
            ok: false,
            error: { code: 'network', message: 'Qishui operation failed' },
        });
    }
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.info(`[Qishui] API server listening on ${HOST}:${PORT}`);
});
