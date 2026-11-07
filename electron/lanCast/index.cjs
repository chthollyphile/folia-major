'use strict';

const { discoverSpeakers, lanIpv4 } = require('./ssdp.cjs');
const { playOnSpeaker, stopOnSpeaker } = require('./soap.cjs');
const { createGateway } = require('./gateway.cjs');

// 桌面端的投送控制器：把「发现 / 推送 / 停止」三件事串起来，并管理本次会话的音频网关。
//
// 与安卓 FoliaLanCastPlugin 的区别只在传输层：那边是 UDP + OkHttp，这边是 dgram + http。
// 语义完全对齐——投送成功后手机/电脑静音但不暂停，切歌自动跟随，停止时还原。

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const hostOf = value => {
    try {
        return new URL(value).hostname;
    } catch {
        return undefined;
    }
};

const isLoopbackUrl = value => {
    try {
        const url = new URL(value);
        return LOOPBACK_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
};

const isCustomScheme = value => {
    try {
        const url = new URL(value);
        return url.protocol !== 'http:' && url.protocol !== 'https:';
    } catch {
        return false;
    }
};

/**
 * 把渲染层的播放地址变成音响能真正拉到的地址。
 *
 * - 自定义协议（folia-fnmusic 等）：音响不认识，必须经网关转成 http。
 * - 本机回环地址（http://127.0.0.1:port/...）：音响会把 127.0.0.1 当成它自己，也必须经网关。
 * - 公网 http(s) 直链：直接交给音响（与安卓侧一致，少一跳中转）。
 */
const toCastableUrl = async (raw, gateway, preferHost) => {
    const value = String(raw || '').trim();
    if (!value) throw new Error('当前没有正在播放的歌曲');
    if (value.startsWith('blob:') || value.startsWith('data:')) {
        throw new Error('本机文件没有局域网地址，暂时不能投送');
    }
    if (value.startsWith('file:')) throw new Error('本机文件没有局域网地址，暂时不能投送');

    if (!isCustomScheme(value) && !isLoopbackUrl(value)) {
        if (!/^https?:\/\//i.test(value)) throw new Error('这首歌的地址不能投送');
        return value;
    }

    // 需要中继：起网关（已起就复用），把地址登记成一次性令牌路径。
    const port = await gateway.start();
    // 用音响自己的地址引导选网卡：多网卡时取错网段，音响会直接连不上这个中继地址。
    const lanIp = lanIpv4(preferHost);
    if (!lanIp) throw new Error('没取到本机的局域网地址，请确认已连接网络');
    const { path } = gateway.register(value);
    return `http://${lanIp}:${port}${path}`;
};

const createLanCastController = ({ resolveProtocol = () => null, log = () => {} } = {}) => {
    const gateway = createGateway({ resolveProtocol });
    let activeControlUrl = '';

    /** 扫一遍局域网，返回可投送的 MediaRenderer。 */
    const discover = async ({ timeoutMs } = {}) => {
        log('[LanCast] discover start');
        const speakers = await discoverSpeakers({ timeoutMs });
        log(`[LanCast] discover done, ${speakers.length} speaker(s)`);
        return speakers;
    };

    /** 推送当前歌曲。成功才把控制地址记成当前会话。 */
    const cast = async (track) => {
        const controlUrl = String(track?.controlUrl || '');
        if (!/^https?:\/\//i.test(controlUrl)) throw new Error('缺少音响地址');
        const url = await toCastableUrl(track?.url, gateway, hostOf(controlUrl));
        const result = await playOnSpeaker(controlUrl, { ...track, url });
        if (!result.ok) throw new Error(result.reason || '推送失败');
        activeControlUrl = controlUrl;
        log(`[LanCast] cast ok -> ${controlUrl}`);
        return { ok: true, url };
    };

    /** 停止音响播放，并关掉对局域网开放的网关。 */
    const stop = async ({ controlUrl } = {}) => {
        const target = String(controlUrl || activeControlUrl || '');
        let result = { ok: true, reason: '' };
        if (target) {
            try {
                result = await stopOnSpeaker(target);
            } catch (error) {
                // 音响可能已离线；本地收口不能因此跳过。
                result = { ok: false, reason: error?.message || '停止失败' };
            }
        }
        gateway.stop();
        activeControlUrl = '';
        if (!result.ok) throw new Error(result.reason);
        return { ok: true };
    };

    /** 渲染层推公网直链时不需要网关；这里只给「是否需要中继」的判断用。 */
    const needsRelay = value => isCustomScheme(String(value || '')) || isLoopbackUrl(String(value || ''));

    return { discover, cast, stop, needsRelay, dispose: () => gateway.stop() };
};

module.exports = {
    createLanCastController,
    toCastableUrl,
};
