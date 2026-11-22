// src/services/foliaPlaylist/foliaPlaylistBroadcast.ts
// 歌单被改了这件事在窗口之间怎么传：一个窗口的写事务提交之后，在 BroadcastChannel 上说一声「哪几张歌单变了」
// （只有歌单 id 和「列表变没变」，不带条目、歌名或任何内容），别的窗口（主窗口、遥控窗口……都是同一个源）听到后
// 自己去库里重读。这里只管传话：不读写数据库，听到的话也只交给本窗口的订阅者，绝不再往频道上发——
// 所以两个窗口不会互相触发：只有写事务会发话，而听到话之后做的只是读。
//
// - 自己发的不处理：BroadcastChannel 本来就不把话送回发话的那个对象；话里另带着发话者的记号，记号是自己的也丢掉
//   （同一个窗口里这个模块要是被装了两份，两份会各开一个频道）。
// - 连发合并：听到的话攒一小会儿（REMOTE_COALESCE_MS）再一起交出去，歌单 id 并成一份。
// - 话是不可信的输入（同源的别的页面、以后的版本都能往这个频道上发）：照形状校验；看不懂的、id 太多的，
//   一律当成「不知道哪张变了」（all），订阅者全部重读——多读一次无害，漏读才是问题。

/** 频道名。 */
export const FOLIA_PLAYLISTS_CHANNEL = 'folia-playlists-changed';
/** 听到别的窗口的话之后攒这么久再交给订阅者（毫秒）。 */
export const FOLIA_REMOTE_COALESCE_MS = 40;
/** 一句话里最多带这么多个歌单 id；再多就只说「都变了」。 */
const MAX_IDS = 256;
const MAX_ID_LENGTH = 128;

/** 别的窗口传来的改动。all：不知道具体哪张，全部当成变了。 */
export type FoliaRemoteChange = { playlistIds: readonly string[]; list: boolean; all: boolean };

type Wire = { v: 1; from: string; playlistIds?: string[]; list?: boolean; all?: boolean };

/** BroadcastChannel 里用到的那一点；单测换成内存里的假频道。 */
export type FoliaBroadcastChannelLike = {
    postMessage(message: unknown): void;
    close(): void;
    onmessage: ((event: { data: unknown }) => void) | null;
};

export type FoliaBroadcastChannelFactory = (name: string) => FoliaBroadcastChannelLike;

// 单测（Vitest 的测试文件跑在同一个进程的几个线程里，Node 自带的 BroadcastChannel 会跨线程串话）默认不开频道，
// 要测的用例自己换一个假的进来。
const defaultFactory: FoliaBroadcastChannelFactory | null = (
    import.meta.env.MODE !== 'test' && typeof window !== 'undefined' && typeof BroadcastChannel === 'function'
        ? name => new BroadcastChannel(name) as unknown as FoliaBroadcastChannelLike
        : null
);

const newSenderId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const state: {
    factory: FoliaBroadcastChannelFactory | null;
    channel: FoliaBroadcastChannelLike | null;
    senderId: string;
    handler: ((change: FoliaRemoteChange) => void) | null;
    pendingIds: Set<string>;
    pendingList: boolean;
    pendingAll: boolean;
    timer: ReturnType<typeof setTimeout> | null;
} = {
    factory: defaultFactory,
    channel: null,
    senderId: newSenderId(),
    handler: null,
    pendingIds: new Set(),
    pendingList: false,
    pendingAll: false,
    timer: null,
};

const flush = (): void => {
    state.timer = null;
    const change: FoliaRemoteChange = {
        // 说了「都变了」就不用再点名。
        playlistIds: state.pendingAll ? [] : [...state.pendingIds],
        list: state.pendingList || state.pendingAll,
        all: state.pendingAll,
    };
    state.pendingIds = new Set();
    state.pendingList = false;
    state.pendingAll = false;
    state.handler?.(change);
};

const receive = (data: unknown): void => {
    const message = (data && typeof data === 'object' ? data : {}) as Partial<Wire>;
    if (message.from === state.senderId) return;
    const ids = Array.isArray(message.playlistIds) ? message.playlistIds as unknown[] : null;
    const understood = message.v === 1 && message.all !== true && ids !== null && ids.length <= MAX_IDS
        && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH)
        && (message.list === undefined || typeof message.list === 'boolean');
    if (understood) {
        for (const id of ids as string[]) state.pendingIds.add(id);
        if (message.list === true) state.pendingList = true;
        // 攒着的 id 多到没意义了：改说「都变了」。
        if (state.pendingIds.size > MAX_IDS) state.pendingAll = true;
    } else {
        state.pendingAll = true;
    }
    state.timer ??= setTimeout(flush, FOLIA_REMOTE_COALESCE_MS);
};

const openChannel = (): FoliaBroadcastChannelLike | null => {
    if (state.channel || !state.factory) return state.channel;
    try {
        const channel = state.factory(FOLIA_PLAYLISTS_CHANNEL);
        channel.onmessage = event => {
            receive(event.data);
        };
        state.channel = channel;
    } catch (error) {
        // 开不了频道（环境不给）：别的窗口要等自己下次重读才看到改动，本窗口照常。
        console.warn('[FoliaPlaylist] Could not open the cross-window channel', error);
        state.factory = null;
    }
    return state.channel;
};

/** 开始听别的窗口的改动（只有一个听的人：存储层，它再转给本窗口的订阅者）。 */
export const listenFoliaPlaylistsBroadcast = (handler: (change: FoliaRemoteChange) => void): void => {
    state.handler = handler;
    openChannel();
};

/** 本窗口的一个写事务提交之后叫：告诉别的窗口哪几张歌单变了。发不出去只记日志，不影响这次写。 */
export const announceFoliaPlaylistsChange = (change: { playlistIds: readonly string[]; list: boolean }): void => {
    const channel = openChannel();
    if (!channel) return;
    const tooMany = change.playlistIds.length > MAX_IDS;
    const message: Wire = tooMany
        ? { v: 1, from: state.senderId, all: true }
        : { v: 1, from: state.senderId, playlistIds: [...change.playlistIds], list: change.list };
    try {
        channel.postMessage(message);
    } catch (error) {
        console.warn('[FoliaPlaylist] Could not tell other windows about a change', error);
    }
};

/**
 * 单测用：换一个频道的造法（null：不开频道），并把这个模块当成一个刚打开的窗口（关掉旧频道、丢掉攒着的话、
 * 换一个发话者记号）。听的人不动。
 */
export const resetFoliaPlaylistsBroadcast = (factory: FoliaBroadcastChannelFactory | null = defaultFactory): void => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    state.pendingIds = new Set();
    state.pendingList = false;
    state.pendingAll = false;
    state.channel?.close();
    state.channel = null;
    state.factory = factory;
    state.senderId = newSenderId();
    if (state.handler) openChannel();
};
