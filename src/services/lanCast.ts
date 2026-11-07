// src/services/lanCast.ts
// 局域网音响投送的前端门面。桌面端把 SSDP 与 SOAP 交给主进程（electron/lanCast），
// 安卓端交给 FoliaLanCast 原生插件；这里负责能力探测、地址中继、归一化错误，
// 以及投送会话本身的生命周期（本机静音 / 还原、跨组件共享当前音响）。

import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';

export type LanSpeaker = {
    id: string;
    name: string;
    location: string;
    controlUrl: string;
    manufacturer: string;
};

export type LanCastTrack = {
    url: string;
    title: string;
    artist: string;
    album?: string;
    coverUrl?: string;
    durationMs?: number;
};

type DesktopCastApi = {
    lanCastDiscover?: (options: { timeoutMs?: number }) => Promise<{ devices?: LanSpeaker[] } | null>;
    lanCastCast?: (track: LanCastTrack & { controlUrl: string }) => Promise<{ ok?: boolean } | null>;
    lanCastStop?: (options: { controlUrl: string }) => Promise<{ ok?: boolean } | null>;
};

type CapacitorCastPlugin = {
    discover?: (options: { timeoutMs?: number }) => Promise<{ devices?: LanSpeaker[] }>;
    play?: (options: LanCastTrack & { controlUrl: string }) => Promise<{ ok?: boolean }>;
    stop?: (options: { controlUrl: string }) => Promise<{ ok?: boolean }>;
};

type CapacitorRelayPlugin = {
    lanCastPrepare?: () => Promise<{ port?: number; lanIp?: string }>;
    lanCastRelease?: () => Promise<unknown>;
};

/** 桌面端：主进程的投送控制器（见 electron/lanCast）。 */
const desktop = (): DesktopCastApi | null => {
    if (typeof window === 'undefined') return null;
    const api = (window as any).electron as DesktopCastApi | undefined;
    if (!api || typeof api.lanCastDiscover !== 'function' || typeof api.lanCastCast !== 'function') return null;
    return api;
};

const nativePlugin = <T>(name: string): T | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as any).Capacitor;
    return (capacitor?.Plugins?.[name] ?? null) as T | null;
};

const relay = (): CapacitorRelayPlugin | null => nativePlugin<CapacitorRelayPlugin>('FoliaNative');
const capacitorCast = (): CapacitorCastPlugin | null => nativePlugin<CapacitorCastPlugin>('FoliaLanCast');

const isAndroidShell = (): boolean => {
    if (typeof window === 'undefined') return false;
    const capacitor = (window as any).Capacitor;
    return Boolean(capacitor?.isNativePlatform?.() && capacitor?.getPlatform?.() === 'android');
};

/**
 * 播放页是否该出现投送入口：桌面端看主进程有没有暴露投送通道，
 * 安卓看原生插件在不在。iOS / Web 两者都没有，入口自动隐藏。
 */
export const isLanCastAvailable = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (desktop()) return true;
    return isAndroidShell() && capacitorCast()?.discover != null;
};

const errorText = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    // Capacitor 把 reject 包成 "Error: xxx"，去掉前缀免得界面上重复两遍。
    return raw.replace(/^Error:\s*/i, '').trim() || '未知错误';
};

/** 判断是不是本机回环的转发地址（音响拿到会当成它自己）。 */
const isLoopbackUrl = (value: string): boolean => {
    try {
        const url = new URL(value, typeof location === 'undefined' ? undefined : location.href);
        return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    } catch {
        return false;
    }
};

/**
 * 安卓上把播放地址变成音响能真正拉到的地址。
 *
 * 安卓上绝大多数在线歌曲走 `http://127.0.0.1:<port>/remote-audio/<token>`（绕 CORS 的转发），
 * 这个地址对音响毫无意义。投送前让原生把转发服务临时对局域网开放，再把 host 换成手机 IP，
 * token 与端口保持原样，音响就能连回来拿字节，连音源需要的请求头也照样由转发服务带上。
 *
 * 桌面端这一步在主进程完成（自定义协议与回环地址都经 electron/lanCast/gateway 转成
 * `http://<局域网 IPv4>:<port>/cast/<token>`），这里原样把地址交过去即可。
 */
const toCastableUrl = async (raw: string): Promise<string> => {
    const value = String(raw || '').trim();
    if (!value) throw new Error('当前没有正在播放的歌曲');
    if (value.startsWith('blob:') || value.startsWith('data:') || value.startsWith('file:')) {
        throw new Error('本机文件没有局域网地址，暂时不能投送');
    }
    if (!/^https?:\/\//i.test(value)) throw new Error('这首歌的地址不能投送');
    if (!isLoopbackUrl(value)) return value;

    const bridge = relay();
    if (!bridge?.lanCastPrepare) throw new Error('当前版本不支持本机中继投送');
    const info = await bridge.lanCastPrepare();
    if (!info?.lanIp || !info?.port) {
        throw new Error('没取到手机的局域网地址，请确认已连接 WiFi');
    }
    const url = new URL(value);
    url.protocol = 'http:';
    url.host = `${info.lanIp}:${info.port}`;
    return url.toString();
};

// ------------------------------------------------------------------ 投送会话

const MUTE_STORAGE_KEY = 'player_is_muted';

type CastSession = {
    speaker: LanSpeaker;
    /** 投送前本机是否本就静音。停止投送时据此还原，别把用户原本的静音一起解掉。 */
    wasMuted: boolean;
    /** 投送前 localStorage 里的原值（null = 当时没有这个 key）。 */
    storedMuted: string | null;
};

// 会话放在模块里而不是组件 state：离开播放页时 LanCastControl 会卸载，
// 但音响还在播，本机必须保持静音；回到播放页时也要能恢复「正在投送」的显示。
let activeSession: CastSession | null = null;
const listeners = new Set<() => void>();
const notifyCasting = () => { for (const listener of listeners) listener(); };

export const subscribeCasting = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
export const getCastingSpeaker = (): LanSpeaker | null => activeSession?.speaker ?? null;
export const isCasting = (): boolean => activeSession !== null;

const readStoredMuted = (): string | null => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem(MUTE_STORAGE_KEY); } catch { return null; }
};

/**
 * handleSetMuted 会顺手把状态写进 localStorage。投送期间的静音只该是「这一次会话」的，
 * 否则中途被杀进程，下次打开应用会莫名其妙没声音。这里把落盘的值改回投送前的原值，
 * 内存里的 isMuted 仍然是 true，音量链路照常读到 0。
 */
const undoMutePersistence = (stored: string | null) => {
    if (typeof window === 'undefined') return;
    try {
        if (stored === null) localStorage.removeItem(MUTE_STORAGE_KEY);
        else localStorage.setItem(MUTE_STORAGE_KEY, stored);
    } catch { /* 存储不可用时忽略。 */ }
};

/** 投送中已推给音响的曲目（跨组件共享）：面板和全局跟随都读它，避免面板推送后又被跟随重复推一次。 */
let pushedTrackKey = '';
let pushedTrackSrc = '';
export const readPushedCast = () => ({ key: pushedTrackKey, src: pushedTrackSrc });
export const markPushedCast = (key: string, src: string) => {
    pushedTrackKey = key;
    pushedTrackSrc = src;
};

/**
 * 本机静音，但**不暂停**：项目里 isMuted 只把输出增益降到 0，
 * 播放时钟（currentTime / lyricCurrentTime）只看 audio.paused，所以进度条和歌词照常走。
 */
const applyCastingMute = () => {
    const session = activeSession;
    if (!session) return;
    const state = useAudioSettingsStore.getState();
    if (state.isMuted) return;
    state.handleSetMuted(true);
    undoMutePersistence(session.storedMuted);
};

/** 投送期间若被手动取消静音（拖音量条会自动取消），立刻压回去。 */
export const ensureCastingMute = () => applyCastingMute();

const restoreCastingMute = () => {
    const session = activeSession;
    if (!session) return;
    // 先清会话再改音量：ensureCastingMute 的守卫看到 isCasting() 为 false 就不会把还原压回去。
    activeSession = null;
    pushedTrackKey = '';
    pushedTrackSrc = '';
    notifyCasting();
    const state = useAudioSettingsStore.getState();
    if (!session.wasMuted && state.isMuted) state.handleSetMuted(false);
    else undoMutePersistence(session.storedMuted);
};

// ------------------------------------------------------------------ 对外能力

export const discoverLanSpeakers = async (timeoutMs = 3200): Promise<LanSpeaker[]> => {
    const api = desktop();
    if (api?.lanCastDiscover) {
        const result = await api.lanCastDiscover({ timeoutMs });
        return (result?.devices ?? []).filter(device => Boolean(device?.controlUrl && device?.name));
    }
    const plugin = capacitorCast();
    if (!plugin?.discover) throw new Error('当前设备不支持局域网投送');
    const result = await plugin.discover({ timeoutMs });
    return (result?.devices ?? []).filter(device => Boolean(device?.controlUrl && device?.name));
};

export const castTrackToSpeaker = async (speaker: LanSpeaker, track: LanCastTrack): Promise<void> => {
    const api = desktop();
    if (api?.lanCastCast) {
        // 桌面端：主进程自己决定直连还是经网关中继，这里把原始地址原样交过去。
        const result = await api.lanCastCast({ ...track, url: track.url, controlUrl: speaker.controlUrl });
        if (!result?.ok) throw new Error('推送失败');
    } else {
        const plugin = capacitorCast();
        if (!plugin?.play) throw new Error('当前设备不支持局域网投送');
        const url = await toCastableUrl(track.url);
        try {
            await plugin.play({ ...track, url, controlUrl: speaker.controlUrl });
        } catch (error) {
            throw new Error(errorText(error));
        }
    }
    // 换音响时，等新音响确实接上了再停旧的；推送失败就什么都不动，
    // 免得旧音响停了、新的没响、本机还静音。
    const previous = activeSession;
    if (previous && previous.speaker.controlUrl !== speaker.controlUrl) {
        try {
            if (api?.lanCastStop) await api.lanCastStop({ controlUrl: previous.speaker.controlUrl });
            else await capacitorCast()?.stop?.({ controlUrl: previous.speaker.controlUrl });
        } catch { /* 旧音响可能已离线，忽略即可。 */ }
    }
    // 只有推送真的成功才静音，失败时本机照常出声。
    // 切歌自动跟随会复用同一会话，保留最初的静音记录，别把状态一层层覆盖掉。
    activeSession = {
        speaker,
        wasMuted: previous ? previous.wasMuted : useAudioSettingsStore.getState().isMuted,
        storedMuted: previous ? previous.storedMuted : readStoredMuted(),
    };
    notifyCasting();
    applyCastingMute();
};

/** 停止音响播放、关掉对局域网开放的转发入口、把本机声音还原。 */
export const stopCastingToSpeaker = async (): Promise<void> => {
    const session = activeSession;
    const api = desktop();
    let stopError: unknown = null;
    try {
        if (session) {
            if (api?.lanCastStop) await api.lanCastStop({ controlUrl: session.speaker.controlUrl });
            else await capacitorCast()?.stop?.({ controlUrl: session.speaker.controlUrl });
        }
    } catch (error) {
        // 音响可能已离线；本地状态无论如何都要收口，不能留一个「永远静音」的本机。
        stopError = error;
    }
    try {
        await relay()?.lanCastRelease?.();
    } catch { /* 收口失败不影响还原。 */ }
    restoreCastingMute();
    if (stopError) throw new Error(errorText(stopError));
};

export const lanCastErrorText = errorText;
