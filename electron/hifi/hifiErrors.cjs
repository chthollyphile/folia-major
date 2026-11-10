'use strict';

// HiFi 主进程的错误码：建带码的 Error、认码，给日志用的说明去掉查询串，把 mpv 的日志行和 end-file 归到错误码。

/** 和 src/types/hifi.ts 的 HifiErrorCode 成员一致；主进程只回传码，文案在渲染端。 */
const HIFI_ERROR_CODES = Object.freeze([
    'MPV_NOT_FOUND',
    'MPV_TOO_OLD',
    'MPV_SPAWN_FAILED',
    'MPV_CRASHED',
    'IPC_TIMEOUT',
    'CIRCUIT_OPEN',
    'DEVICE_BUSY',
    'DEVICE_UNAVAILABLE',
    'SOURCE_UNREACHABLE',
    'SOURCE_REJECTED',
    'FORMAT_UNSUPPORTED',
    'LOAD_FAILED',
    'INVALID_REQUEST',
    'UNSUPPORTED_PLATFORM',
    'INSTALL_FAILED',
    'INSTALL_CHECKSUM_MISMATCH',
    'INSTALL_CANCELLED',
    'UNKNOWN',
]);

const MAX_DETAIL_CHARS = 300;

// 独占设备被别的程序占着：WASAPI 的 AUDCLNT_E_DEVICE_IN_USE、ALSA hw 的 EBUSY、CoreAudio 的 hog mode。
const DEVICE_BUSY_PATTERN = /AUDCLNT_E_DEVICE_IN_USE|Device or resource busy|device (is )?(busy|in use)|exclusive mode.*(busy|in use|denied)|hog ?mode/i;
// PipeWire / PulseAudio 的流连不上输出节点（别的流独占着它、节点没了）：mpv 不报错，丢帧快进到结尾，像是放完了。
const STREAM_LOST_PATTERN = /no target node available|Stream in error state|dropping frame due to pin disconnect/i;
// 上面那几行出自这几个模块（丢帧那行记在 ao 名下）。
const STREAM_LOST_PREFIX = /^ao(\/(pipewire|pulse))?$/;
// 只有报失败的级别才算数；我们只订阅了 warn 以上，这里再挡一次 info / v / debug。
const FAILURE_LOG_LEVELS = new Set(['fatal', 'error', 'warn']);
const FORMAT_UNSUPPORTED_PATTERN = /unrecognized file format|no audio or video data played|Failed to recognize/i;

const isHifiErrorCode = value => typeof value === 'string' && HIFI_ERROR_CODES.includes(value);

/** 只给日志的说明：去掉 URL 的用户信息、查询串和片段（Navidrome 的 stream 地址在查询串里带 u/t/s），合并空白，最多 300 字。 */
const sanitizeDetail = text => {
    if (text === null || text === undefined) return '';
    const raw = text instanceof Error ? text.message : String(text);
    return raw
        .replace(/\/\/[^\s/?#@]*@/g, '//')
        .replace(/[?#][^\s"'<>]*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_DETAIL_CHARS);
};

/** 带错误码的 Error：`.code` 是 HifiErrorCode（认不出的码记作 UNKNOWN），`.hifiDetail` 是去敏后的说明。 */
const createHifiError = (code, detail) => {
    const errorCode = isHifiErrorCode(code) ? code : 'UNKNOWN';
    const hifiDetail = sanitizeDetail(detail);
    const error = new Error(hifiDetail ? `${errorCode}: ${hifiDetail}` : errorCode);
    error.code = errorCode;
    if (hifiDetail) error.hifiDetail = hifiDetail;
    return error;
};

const toHifiErrorCode = (error, fallback = 'UNKNOWN') => {
    if (isHifiErrorCode(error)) return error;
    if (error && isHifiErrorCode(error.code)) return error.code;
    return isHifiErrorCode(fallback) ? fallback : 'UNKNOWN';
};

/** 这条 mpv log-message 说的是 PipeWire / PulseAudio 的流连不上输出：mpv 这时照样往下放，声音全丢掉。 */
const isOutputStreamLost = line => {
    if (!line || typeof line.text !== 'string') return false;
    if (typeof line.level === 'string' && !FAILURE_LOG_LEVELS.has(line.level)) return false;
    return STREAM_LOST_PREFIX.test(typeof line.prefix === 'string' ? line.prefix : '') && STREAM_LOST_PATTERN.test(line.text);
};

/** 一条 mpv log-message 能说明的错误码；目前只认出“设备被占用”（含流连不上输出），其余为 null。 */
const classifyLogLine = line => {
    if (!line || typeof line.text !== 'string') return null;
    if (typeof line.level === 'string' && !FAILURE_LOG_LEVELS.has(line.level)) return null;
    return DEVICE_BUSY_PATTERN.test(line.text) || isOutputStreamLost(line) ? 'DEVICE_BUSY' : null;
};

/**
 * end-file 的错误码；reason 不是 error 时为 null。来源桥记下的错（sourceErrorCode）优先，因为 mpv 只看得到
 * 127.0.0.1 断了；音频输出起不来时看最近的日志分清“被占用”和“不可用”。fileError 也收 mpv 原样的 file_error。
 */
const classifyEndFile = (endFile, recentLogLines = [], sourceErrorCode = null) => {
    if (!endFile || endFile.reason !== 'error') return null;
    if (isHifiErrorCode(sourceErrorCode)) return sourceErrorCode;
    const rawFileError = endFile.fileError ?? endFile.file_error;
    const fileError = typeof rawFileError === 'string' ? rawFileError : '';
    const lines = Array.isArray(recentLogLines) ? recentLogLines : [];
    if (/audio output initialization failed/i.test(fileError)) {
        return lines.some(line => classifyLogLine(line) === 'DEVICE_BUSY') ? 'DEVICE_BUSY' : 'DEVICE_UNAVAILABLE';
    }
    if (/loading failed/i.test(fileError)) return 'SOURCE_UNREACHABLE';
    if (FORMAT_UNSUPPORTED_PATTERN.test(fileError)) return 'FORMAT_UNSUPPORTED';
    if (lines.some(line => typeof line?.text === 'string' && FORMAT_UNSUPPORTED_PATTERN.test(line.text))) {
        return 'FORMAT_UNSUPPORTED';
    }
    return 'LOAD_FAILED';
};

module.exports = {
    HIFI_ERROR_CODES,
    isHifiErrorCode,
    createHifiError,
    toHifiErrorCode,
    sanitizeDetail,
    isOutputStreamLost,
    classifyLogLine,
    classifyEndFile,
};
