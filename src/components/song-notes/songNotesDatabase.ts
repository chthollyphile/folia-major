import Dexie, { type Table } from 'dexie';
import type { SongNoteComment, SongNoteRow, SongNoteTag } from './songNotesModel';

// src/components/song-notes/songNotesDatabase.ts
// 歌曲评论自己的数据库（IndexedDB，名字 FoliaSongNotesDB）：
// - songs：一首写过评论或打过标签的歌一行，主键 getPlaybackSongKey；tags 是 multiEntry 索引（按标签找歌），
//   updatedAt 索引（最近评论过的歌）；
// - comments：一条评论一行，songKey 索引（读一首歌的评论），createdAt 索引；
// - tags：一个标签一行，主键是规整后的小写，order 索引（标签之间的先后）。
// 和 FoliaPlaylistsDB 一样不放进 KineticPlayerDB：给那个库加表要升它的版本号，旧版本的 Folia 打不开，用户一降级就坏；
// 单独一个库，按类别清缓存也碰不到它。速记簿移除一首歌不碰这里：评论是歌自己的，长期留着。

export const SONG_NOTES_DATABASE_NAME = 'FoliaSongNotesDB';

export class SongNotesDatabase extends Dexie {
    songs!: Table<SongNoteRow, string>;
    comments!: Table<SongNoteComment, string>;
    tags!: Table<SongNoteTag, string>;

    constructor(name = SONG_NOTES_DATABASE_NAME) {
        super(name);
        this.version(1).stores({
            songs: 'key, *tags, updatedAt',
            comments: 'id, songKey, createdAt',
            tags: 'key, order',
        });
    }
}

let database: SongNotesDatabase | null = null;

/** 用到时才开库。单测经 setSongNotesDatabaseForTest 换一个进来。 */
export const songNotesDatabase = (): SongNotesDatabase => {
    database ??= new SongNotesDatabase();
    return database;
};

/** 单测用：换一个库（null：下次用到时按缺省的名字重开）。 */
export const setSongNotesDatabaseForTest = (next: SongNotesDatabase | null): void => {
    database = next;
};
