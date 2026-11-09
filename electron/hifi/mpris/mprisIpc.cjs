'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSenderGuardedHandler } = require('../../ipcAccessGuard.cjs');
const { connectBus } = require('./dbusConnection.cjs');
const { sessionBusAddress } = require('./dbusWire.cjs');
const { createMprisService } = require('./mprisService.cjs');

// Linux 的 MPRIS 接入点：只认主窗口推来的 HiFi 播放状态和封面并逐项校验，把系统媒体面板的按键和登记成没成转回主窗口。
// 封面总是写成本地文件再交给 MPRIS：http(s) 原址可能带着凭据（Navidrome 的 getCoverArt），不能挂到会话总线上。

const STATE_CHANNEL = 'hifi:mpris-state';
const ARTWORK_CHANNEL = 'hifi:mpris-artwork';
const COMMAND_CHANNEL = 'hifi:mpris-command';
const STATUS_CHANNEL = 'hifi:mpris-status';

const MAX_TEXT_CHARS = 1024;
const MAX_ARTISTS = 32;
const MAX_KEY_CHARS = 256;
const MAX_ARTWORK_BYTES = 16 * 1024 * 1024;
const MAX_URL_CHARS = 8192;
const ARTWORK_FETCH_TIMEOUT_MS = 10000;
const STATUSES = new Set(['Playing', 'Paused', 'Stopped']);
const ARTWORK_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
});
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ARTWORK_FILE_PATTERN = /^cover-[0-9a-f]{40}\.[a-z]+$/;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const isKeyLabel = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_CHARS && !CONTROL_CHARS.test(value);
// D-Bus 的字符串里不能有 NUL；别的控制字符换成空格，免得面板里出怪字。
const cleanText = value => (typeof value === 'string' ? value.slice(0, MAX_TEXT_CHARS).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '');

/** 推来的状态；不合规的一律当作不活动（交还总线名），不抛。 */
const validateMprisState = value => {
    if (!isPlainObject(value) || value.active !== true) return { active: false };
    const { trackKey, title, artists, album, durationSec, status, positionSec, atMs, seeked } = value;
    if (!isKeyLabel(trackKey) || !STATUSES.has(status)) return { active: false };
    if (!isFiniteNumber(positionSec) || !isFiniteNumber(atMs)) return { active: false };
    return {
        active: true,
        trackKey,
        title: cleanText(title),
        artists: Array.isArray(artists) ? artists.slice(0, MAX_ARTISTS).map(cleanText).filter(Boolean) : [],
        album: cleanText(album),
        durationSec: isFiniteNumber(durationSec) && durationSec > 0 ? durationSec : null,
        status,
        positionSec: Math.max(0, positionSec),
        atMs,
        seeked: seeked === true,
    };
};

const isHttpUrl = value => {
    if (typeof value !== 'string' || value === '' || value.length > MAX_URL_CHARS) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

/** 封面：{ bytes, mimeType }（渲染进程读到的图片字节）或 { url }（读不到时的 http(s) 原址，由主进程下载）；别的为 null。 */
const validateArtwork = value => {
    if (!isPlainObject(value)) return null;
    if (value.bytes instanceof Uint8Array) {
        const extension = ARTWORK_EXTENSIONS[value.mimeType];
        if (!extension || value.bytes.byteLength === 0 || value.bytes.byteLength > MAX_ARTWORK_BYTES) return null;
        return { bytes: Buffer.from(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength), extension };
    }
    if (isHttpUrl(value.url)) return { url: value.url };
    return null;
};

/** http(s) 原址的封面由主进程自己下载成字节；不是认得的图片类型、太大或失败时为 null。地址不写进日志。 */
const downloadArtwork = async (url, fetchImpl = fetch) => {
    try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(ARTWORK_FETCH_TIMEOUT_MS) });
        if (!response.ok) return null;
        const mimeType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        const extension = ARTWORK_EXTENSIONS[mimeType];
        const declared = Number(response.headers.get('content-length'));
        if (!extension || (Number.isFinite(declared) && declared > MAX_ARTWORK_BYTES)) return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTWORK_BYTES) return null;
        return { bytes, extension };
    } catch (error) {
        console.info('[MPRIS] could not download the cover', error instanceof Error ? error.name : typeof error);
        return null;
    }
};

// 封面写进 userData 下的一个目录，只留当前这首的；文件名是内容的哈希。写和清理排成一队做：两次交错时，
// 前一次的清理会删掉后一次刚写好、已经交给 MPRIS 的文件。
const createArtworkFiles = ({ getDirectory, fsImpl = fs.promises }) => {
    let currentFile = null;
    let queue = Promise.resolve();
    const enqueue = task => {
        const result = queue.then(task);
        queue = result.catch(() => {});
        return result;
    };

    const removeOthers = async keep => {
        const directory = getDirectory();
        let names;
        try {
            names = await fsImpl.readdir(directory);
        } catch {
            return;
        }
        await Promise.all(names
            .filter(name => ARTWORK_FILE_PATTERN.test(name) && name !== keep)
            .map(name => fsImpl.rm(path.join(directory, name), { force: true }).catch(() => {})));
    };

    return {
        write: ({ bytes, extension }) => enqueue(async () => {
            const directory = getDirectory();
            const name = `cover-${crypto.createHash('sha1').update(bytes).digest('hex')}.${extension}`;
            const filePath = path.join(directory, name);
            await fsImpl.mkdir(directory, { recursive: true });
            if (currentFile !== name) await fsImpl.writeFile(filePath, bytes, { mode: 0o600 });
            currentFile = name;
            await removeOthers(name);
            return filePath;
        }),
        clear: () => enqueue(async () => {
            currentFile = null;
            await removeOthers(null);
        }),
    };
};

const fileUrl = filePath => `file://${filePath.split('/').map(encodeURIComponent).join('/')}`;

/**
 * 只在 Linux 上调。getMainWindow() 给按键的去处和 Raise 要拿到前面的窗口；getArtworkDirectory() 是放封面的目录。
 * 返回 dispose()，退出时关掉总线连接、删掉封面。
 */
const registerMprisIpc = ({
    ipcMain,
    isTrustedSender,
    getMainWindow,
    getArtworkDirectory,
    fetchArtwork = url => downloadArtwork(url),
    env = process.env,
    uid = process.getuid(),
    connect = () => connectBus({ address: sessionBusAddress(env), uid }),
    readMachineId = () => {
        try {
            return fs.readFileSync('/etc/machine-id', 'utf8').trim();
        } catch {
            return '';
        }
    },
}) => {
    const sendToMainWindow = (channel, payload) => {
        const window = getMainWindow();
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
        window.webContents.send(channel, payload);
    };
    const artworkFiles = createArtworkFiles({ getDirectory: getArtworkDirectory });

    const service = createMprisService({
        connect: async () => {
            if (sessionBusAddress(env) === null) throw new Error('No session bus address');
            return connect();
        },
        onCommand: command => sendToMainWindow(COMMAND_CHANNEL, command),
        onRegistered: registered => sendToMainWindow(STATUS_CHANNEL, { registered }),
        onRaise: () => {
            const window = getMainWindow();
            if (!window || window.isDestroyed()) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
        },
        readMachineId,
    });

    const handle = (channel, handler) => {
        ipcMain.handle(channel, createSenderGuardedHandler({ channel, isTrusted: isTrustedSender, handler }));
    };

    handle(STATE_CHANNEL, (_event, state) => {
        const valid = validateMprisState(state);
        service.update(valid);
        if (!valid.active) void artworkFiles.clear();
    });
    handle(ARTWORK_CHANNEL, async (_event, trackKey, artwork) => {
        if (!isKeyLabel(trackKey) || service.currentTrackKey() !== trackKey) return;
        const valid = validateArtwork(artwork);
        if (!valid) {
            service.setArtwork(trackKey, null);
            return;
        }
        const image = valid.url ? await fetchArtwork(valid.url) : valid;
        if (service.currentTrackKey() !== trackKey) return;
        if (!image) {
            service.setArtwork(trackKey, null);
            return;
        }
        try {
            const filePath = await artworkFiles.write(image);
            if (service.currentTrackKey() === trackKey) service.setArtwork(trackKey, fileUrl(filePath));
        } catch (error) {
            console.warn('[MPRIS] could not write the cover for the system media controls', error);
            service.setArtwork(trackKey, null);
        }
    });

    return {
        dispose: () => {
            service.dispose();
            void artworkFiles.clear();
        },
    };
};

module.exports = {
    STATE_CHANNEL,
    ARTWORK_CHANNEL,
    COMMAND_CHANNEL,
    STATUS_CHANNEL,
    validateMprisState,
    validateArtwork,
    downloadArtwork,
    createArtworkFiles,
    fileUrl,
    registerMprisIpc,
};
