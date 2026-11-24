import type { SongResult } from '../../types';

// src/components/song-notes/songNotesModel.ts
// 歌曲的本地评论（来源 folium-compound#177 的「音乐笔记」模组，做进本体，计划见 plan/music-notes-integration-plan.md）：
// 一首歌 = 歌这一层的一组标签 + 一串评论。评论一条一条地写，带 at（秒）的就是时间轴注释，在进度条上画刻痕。
// 这里是不碰数据库的纯函数：标签怎么规整、评论的上限、摘要怎么算、两种排序、时刻怎么写。单测直接测它们。

/** 一首歌最多几个标签、几条评论；一条评论、一个标签最多几个字。 */
export const SONG_NOTE_MAX_TAGS = 32;
export const SONG_NOTE_MAX_COMMENTS = 1000;
export const SONG_NOTE_MAX_TEXT = 10_000;
export const SONG_NOTE_MAX_TAG_LENGTH = 64;

/** 一条评论。at 是挂在歌里的位置（秒）；没有 at 就是普通的正文。 */
export type SongNoteComment = {
    id: string;
    /** getPlaybackSongKey。 */
    songKey: string;
    text: string;
    at?: number;
    createdAt: number;
    editedAt?: number;
};

/** 卡片上显示的那一条（不带 songKey）。 */
export type SongNoteCommentPreview = Pick<SongNoteComment, 'id' | 'text' | 'at' | 'createdAt'>;

/** songs 表的一行：一首写过评论或打过标签的歌。标签和评论都删光了，这一行就删掉。 */
export type SongNoteRow = {
    /** getPlaybackSongKey，主键。 */
    key: string;
    /** toStoredSongSnapshot：不在任何列表里也能显示、能播放。 */
    song: SongResult;
    /** 标签的 key（规整后的小写），按打上的先后；multiEntry 索引。 */
    tags: string[];
    /** 每个标签是什么时候打上的（标签组里按它排，第二阶段用）。 */
    tagAddedAt: Record<string, number>;
    commentCount: number;
    timedCount: number;
    latestComment?: SongNoteCommentPreview;
    updatedAt: number;
};

/** tags 表的一行：一个标签的写法与它在所有标签里的先后。 */
export type SongNoteTag = {
    /** 规整后的小写，主键。 */
    key: string;
    /** 第一次打上时的写法（大小写照用户写的）。 */
    name: string;
    order: number;
    createdAt: number;
};

/** 规整一个标签：去掉开头的 #、首尾空白，中间的空白并成一个，截到上限。规整完是空的返回 null。 */
export const normalizeTagName = (raw: string): string | null => {
    const name = raw.replace(/^[#＃\s]+/u, '').replace(/\s+/gu, ' ').trim();
    if (!name) return null;
    return Array.from(name).slice(0, SONG_NOTE_MAX_TAG_LENGTH).join('');
};

/** 标签的 key：规整后转小写（「Rock」和「rock」是同一个标签）。 */
export const tagKeyOf = (name: string): string => name.toLocaleLowerCase();

/** 规整评论的字：去掉首尾空白（中间的换行留着），截到上限。 */
export const normalizeCommentText = (raw: string): string => Array.from(raw.trim()).slice(0, SONG_NOTE_MAX_TEXT).join('');

/** 规整时刻：不是有限数、是负数的当没有；保留一位小数。 */
export const normalizeCommentAt = (at: number | null | undefined): number | undefined => {
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return undefined;
    return Math.round(at * 10) / 10;
};

/** 一条评论能不能留下：有字，或者挂着时刻（图钉按 Esc 只留一道刻痕，不写字）。 */
export const isKeepableComment = (text: string, at: number | undefined): boolean => text.length > 0 || at !== undefined;

/** 按一串评论重算这首歌的摘要：几条、几条挂着时刻、最新的一条（有字的优先）。 */
export const summarizeComments = (comments: readonly SongNoteComment[]): Pick<SongNoteRow, 'commentCount' | 'timedCount' | 'latestComment'> => {
    let timedCount = 0;
    let latest: SongNoteComment | undefined;
    let latestWithText: SongNoteComment | undefined;
    for (const comment of comments) {
        if (comment.at !== undefined) timedCount += 1;
        if (!latest || comment.createdAt >= latest.createdAt) latest = comment;
        if (comment.text && (!latestWithText || comment.createdAt >= latestWithText.createdAt)) latestWithText = comment;
    }
    const pick = latestWithText ?? latest;
    return {
        commentCount: comments.length,
        timedCount,
        latestComment: pick ? { id: pick.id, text: pick.text, ...(pick.at !== undefined ? { at: pick.at } : {}), createdAt: pick.createdAt } : undefined,
    };
};

/** 两种排序：按写的时间（旧的在上，新写的贴着输入框）；按时间轴（挂着时刻的按时刻，没挂的放在最后，按写的时间）。 */
export type SongNoteSort = 'written' | 'timeline';

export const sortComments = (comments: readonly SongNoteComment[], sort: SongNoteSort): SongNoteComment[] => {
    const byWritten = (a: SongNoteComment, b: SongNoteComment) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    if (sort === 'written') return [...comments].sort(byWritten);
    return [...comments].sort((a, b) => {
        if (a.at !== undefined && b.at !== undefined) return a.at - b.at || byWritten(a, b);
        if (a.at !== undefined) return -1;
        if (b.at !== undefined) return 1;
        return byWritten(a, b);
    });
};

/** 时刻写成 mm:ss（一小时以上 h:mm:ss），和进度条上的时间同一种写法。 */
export const formatNoteAt = (seconds: number): string => {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`;
};

/** 刻痕在进度条上的位置（0–1）：只随歌长和评论变，不随播放进度变。歌长未知、时刻超出歌长的不画。 */
export const timelineMarks = (comments: readonly SongNoteComment[], duration: number): { id: string; at: number; ratio: number; text: string }[] => {
    if (!Number.isFinite(duration) || duration <= 0) return [];
    return comments
        .filter((comment): comment is SongNoteComment & { at: number } => comment.at !== undefined && comment.at <= duration)
        .sort((a, b) => a.at - b.at)
        .map(comment => ({ id: comment.id, at: comment.at, ratio: comment.at / duration, text: comment.text }));
};

/** 新评论的 id：时间加随机，同一毫秒写两条也不撞。 */
export const newCommentId = (now = Date.now()): string => (
    `${now.toString(36)}-${(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 12)}`
);
