// src/components/song-notes/songNotesBroadcast.ts
// 评论被改了这件事在窗口之间怎么传（照 foliaPlaylistBroadcast.ts 的写法，简化）：一个窗口的写事务提交之后，
// 在 BroadcastChannel 上说一声「哪几首歌的评论变了」（只有歌的 key，不带评论内容），别的窗口听到后自己去库里重读。
// 只有写事务会发话，听到话之后做的只是读，所以两个窗口不会互相触发。自己发的不处理；看不懂的话当成「都变了」。

export const SONG_NOTES_CHANNEL = 'folia-song-notes-changed';
const COALESCE_MS = 40;
const MAX_KEYS = 256;
const MAX_KEY_LENGTH = 512;

/** 别的窗口传来的改动。all：不知道具体哪首，全部重读。 */
export type SongNotesRemoteChange = { songKeys: readonly string[]; all: boolean };

type Wire = { v: 1; from: string; songKeys?: string[]; all?: boolean };

export type SongNotesChannelLike = {
    postMessage(message: unknown): void;
    close(): void;
    onmessage: ((event: { data: unknown }) => void) | null;
};

// 单测不开频道（Node 自带的 BroadcastChannel 会在测试线程之间串话）。
const defaultFactory: ((name: string) => SongNotesChannelLike) | null = (
    import.meta.env.MODE !== 'test' && typeof window !== 'undefined' && typeof BroadcastChannel === 'function'
        ? name => new BroadcastChannel(name) as unknown as SongNotesChannelLike
        : null
);

const state: {
    factory: ((name: string) => SongNotesChannelLike) | null;
    channel: SongNotesChannelLike | null;
    senderId: string;
    handler: ((change: SongNotesRemoteChange) => void) | null;
    pending: Set<string>;
    pendingAll: boolean;
    timer: ReturnType<typeof setTimeout> | null;
} = {
    factory: defaultFactory,
    channel: null,
    senderId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    handler: null,
    pending: new Set(),
    pendingAll: false,
    timer: null,
};

const flush = (): void => {
    state.timer = null;
    const change: SongNotesRemoteChange = { songKeys: state.pendingAll ? [] : [...state.pending], all: state.pendingAll };
    state.pending = new Set();
    state.pendingAll = false;
    state.handler?.(change);
};

const receive = (data: unknown): void => {
    const message = (data && typeof data === 'object' ? data : {}) as Partial<Wire>;
    if (message.from === state.senderId) return;
    const keys = Array.isArray(message.songKeys) ? message.songKeys as unknown[] : null;
    const understood = message.v === 1 && message.all !== true && keys !== null && keys.length <= MAX_KEYS
        && keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH);
    if (understood) {
        for (const key of keys as string[]) state.pending.add(key);
        if (state.pending.size > MAX_KEYS) state.pendingAll = true;
    } else {
        state.pendingAll = true;
    }
    state.timer ??= setTimeout(flush, COALESCE_MS);
};

const openChannel = (): SongNotesChannelLike | null => {
    if (state.channel || !state.factory) return state.channel;
    try {
        const channel = state.factory(SONG_NOTES_CHANNEL);
        channel.onmessage = event => receive(event.data);
        state.channel = channel;
    } catch (error) {
        console.warn('[SongNotes] Could not open the cross-window channel', error);
        state.factory = null;
    }
    return state.channel;
};

/** 开始听别的窗口的改动（只有一个听的人：useSongNotesStore）。 */
export const listenSongNotesBroadcast = (handler: (change: SongNotesRemoteChange) => void): void => {
    state.handler = handler;
    openChannel();
};

/** 本窗口的写事务提交之后叫：告诉别的窗口哪几首歌的评论变了。发不出去只记日志。 */
export const announceSongNotesChange = (songKeys: readonly string[] | 'all'): void => {
    const channel = openChannel();
    if (!channel) return;
    // 'all'：改的是标签本身（改名、合并、删除、换先后）或一大批歌，别的窗口全部重读。
    const message: Wire = songKeys === 'all' || songKeys.length > MAX_KEYS
        ? { v: 1, from: state.senderId, all: true }
        : { v: 1, from: state.senderId, songKeys: [...songKeys] };
    try {
        channel.postMessage(message);
    } catch (error) {
        console.warn('[SongNotes] Could not tell other windows about a change', error);
    }
};

/** 单测用：换一个频道的造法，并当成一个刚打开的窗口。 */
export const resetSongNotesBroadcast = (factory: ((name: string) => SongNotesChannelLike) | null = defaultFactory): void => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    state.pending = new Set();
    state.pendingAll = false;
    state.channel?.close();
    state.channel = null;
    state.factory = factory;
    state.senderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    if (state.handler) openChannel();
};
