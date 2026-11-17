import type { LocalSong } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';
import {
    needsAlbumArtistContext,
    planAlbumMemberLookups,
    type ImportAssignmentLookup,
} from '../utils/localLibraryImportAssignment';
import {
    cleanLocalLibraryName,
    getImportedAlbumName,
    getImportedArtistNames,
    getLocalSongAlbumContextKey,
    normalizeLocalLibraryName,
} from '../utils/localLibraryNames';
import { appDatabase } from './appDatabase';

// src/services/localLibraryImportLookup.ts
// 按索引预取一批导入歌曲定归属要用的库内数据（utils/localLibraryImportAssignment 的 ImportAssignmentLookup），
// 读的量跟这一批的名字和文件夹有关，跟曲库总量无关。
//
// 必须在调用方的 Dexie 读写事务里调用（local_music、local_library_entities、local_library_assignments），
// 这样读到的是同一个事务里的批前状态。这里只直接 await Dexie 自己的请求：写这段时在 fake-indexeddb 下实测过，
// 事务里 await 不发请求的自定义 async 函数（命中缓存直接返回的、空的 id 列表）之后再读写，报 PrematureCommitError。

const byPrimaryKey = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** 预取一批歌的 ImportAssignmentLookup；preserveNonImportAssignments 与随后计算归属时传的一致。 */
export const prefetchImportAssignmentLookup = async (
    songs: LocalSong[],
    preserveNonImportAssignments: boolean,
): Promise<ImportAssignmentLookup> => {
    const batchSongIds = new Set(songs.map(song => song.id));
    const currentAssignments = new Map((await appDatabase.local_library_assignments.bulkGet(Array.from(batchSongIds)))
        .flatMap(assignment => (assignment ? [[assignment.songId, assignment] as const] : [])));

    // 批内的名字：解析时按 clean 再规范化，歌手重叠按 getImportedArtistNames 的结果规范化，两种都收。
    const artistNames = new Set<string>();
    const allNames = new Set<string>();
    const addCleaned = (name: string) => {
        const cleaned = cleanLocalLibraryName(name);
        if (cleaned) allNames.add(normalizeLocalLibraryName(cleaned));
    };
    songs.forEach(song => {
        getImportedArtistNames(song).forEach(name => {
            artistNames.add(normalizeLocalLibraryName(name));
            addCleaned(name);
        });
        const albumName = getImportedAlbumName(song);
        if (albumName) addCleaned(albumName);
    });
    artistNames.forEach(name => allNames.add(name));

    const entitiesById = new Map<string, LocalLibraryEntity>();
    const aliasRows = allNames.size > 0
        ? await appDatabase.local_library_entities.where('normalizedAliases').anyOf(Array.from(allNames)).toArray()
        : [];
    aliasRows.forEach(entity => entitiesById.set(entity.id, entity));
    const aliasEntities = Array.from(entitiesById.values()).sort((left, right) => byPrimaryKey(left.id, right.id));
    const entityIdsByAlias = new Map<string, string[]>();
    const artistAliasEntityIds = new Map<string, string[]>();
    aliasEntities.forEach(entity => entity.normalizedAliases.forEach(alias => {
        if (allNames.has(alias)) {
            const key = `${entity.kind}:${alias}`;
            entityIdsByAlias.set(key, [...(entityIdsByAlias.get(key) || []), entity.id]);
        }
        if (artistNames.has(alias) && !artistAliasEntityIds.get(alias)?.includes(entity.id)) {
            artistAliasEntityIds.set(alias, [...(artistAliasEntityIds.get(alias) || []), entity.id]);
        }
    }));

    // 同文件夹同名专辑：批前同一个上下文键的歌（批内的歌按它们新的键算），取 songId 顺序最后一条有专辑的归属。
    const contextMembers = new Map<string, Set<string>>();
    songs.forEach(song => {
        const key = getLocalSongAlbumContextKey(song);
        if (key && !contextMembers.has(key)) contextMembers.set(key, new Set());
    });
    for (const [key, members] of contextMembers) {
        const songIds = await appDatabase.local_music.where('albumContextKey').equals(key).primaryKeys();
        songIds.forEach(songId => { if (!batchSongIds.has(songId)) members.add(songId); });
    }
    // 同一首在批内出现多次时按最后一次算（与写进库的那份一致）。
    new Map(songs.map(song => [song.id, song])).forEach(song => {
        const key = getLocalSongAlbumContextKey(song);
        if (key) contextMembers.get(key)?.add(song.id);
    });
    const contextSongIds = Array.from(new Set(Array.from(contextMembers.values()).flatMap(members => Array.from(members))));
    const contextAssignments = new Map((await appDatabase.local_library_assignments.bulkGet(contextSongIds))
        .flatMap(assignment => (assignment ? [[assignment.songId, assignment] as const] : [])));
    const contextAlbumIds = new Map<string, string | undefined>();
    contextMembers.forEach((members, key) => {
        let albumId: string | undefined;
        Array.from(members).sort(byPrimaryKey).forEach(songId => {
            albumId = contextAssignments.get(songId)?.albumEntityId || albumId;
        });
        contextAlbumIds.set(key, albumId);
    });

    // 歌手重叠：只有存在没有上下文、也没有现有专辑的歌时才需要。
    const albumIdsByArtistEntity = new Map<string, Set<string>>();
    const overlapEntityIds = new Set(Array.from(artistAliasEntityIds.values()).flat());
    const needsOverlap = songs.some(song => {
        const current = currentAssignments.get(song.id);
        const preserveAlbum = Boolean(preserveNonImportAssignments && current && current.albumOrigin !== 'import');
        const key = getLocalSongAlbumContextKey(song);
        return !preserveAlbum && key && !contextAlbumIds.get(key) && !current?.albumEntityId;
    });
    if (needsOverlap && overlapEntityIds.size > 0) {
        const rows = await appDatabase.local_library_assignments.where('artistEntityIds').anyOf(Array.from(overlapEntityIds)).toArray();
        rows.forEach(({ albumEntityId, artistEntityIds }) => {
            if (!albumEntityId) return;
            artistEntityIds.forEach(entityId => {
                if (!overlapEntityIds.has(entityId)) return;
                const albumIds = albumIdsByArtistEntity.get(entityId) ?? new Set<string>();
                albumIds.add(albumEntityId);
                albumIdsByArtistEntity.set(entityId, albumIds);
            });
        });
    }

    // 补齐重定向链：从给定的 id 出发，沿 mergedInto 一直取到头。要取的 id 先同步算好，没有就不 await（见文件头）。
    const missingIds = new Set<string>();
    const pendingOf = (ids: Iterable<string>) => Array.from(new Set(ids)).filter(id => !entitiesById.has(id) && !missingIds.has(id));
    const recordChainStep = (requested: string[], rows: Array<LocalLibraryEntity | undefined>) => {
        requested.forEach((id, position) => {
            const entity = rows[position];
            if (entity) entitiesById.set(id, entity);
            else missingIds.add(id);
        });
        return pendingOf(rows.flatMap(entity => (entity?.mergedInto ? [entity.mergedInto] : [])));
    };
    let pending = pendingOf([
        ...aliasRows.flatMap(entity => (entity.mergedInto ? [entity.mergedInto] : [])),
        ...Array.from(currentAssignments.values()).flatMap(assignment => [
            ...assignment.artistEntityIds,
            ...(assignment.albumEntityId ? [assignment.albumEntityId] : []),
        ]),
        ...Array.from(contextAlbumIds.values()).filter((id): id is string => Boolean(id)),
        ...Array.from(albumIdsByArtistEntity.values()).flatMap(albumIds => Array.from(albumIds)),
    ]);
    while (pending.length > 0) pending = recordChainStep(pending, await appDatabase.local_library_entities.bulkGet(pending));

    const lookup: ImportAssignmentLookup = {
        index: { entitiesById, entityIdsByAlias, assignmentsBySongId: new Map() },
        currentAssignments,
        contextAlbumIds,
        artistAliasEntityIds,
        albumIdsByArtistEntity,
        albumMembers: new Map(),
    };

    // 专辑成员：只为需要按专辑推歌手的歌、它们会落到的现有专辑取。
    if (songs.some(song => needsAlbumArtistContext(song, lookup, preserveNonImportAssignments))) {
        const albumIds = planAlbumMemberLookups(songs, lookup, preserveNonImportAssignments);
        if (albumIds.length > 0) {
            const rows = await appDatabase.local_library_assignments.where('albumEntityId').anyOf(albumIds).toArray();
            const members = new Map<string, LocalLibraryAssignment[]>();
            rows.sort((left, right) => byPrimaryKey(left.songId, right.songId)).forEach(assignment => {
                const { albumEntityId } = assignment;
                if (albumEntityId) members.set(albumEntityId, [...(members.get(albumEntityId) || []), assignment]);
            });
            lookup.albumMembers = members;
            pending = pendingOf(rows.flatMap(assignment => assignment.artistEntityIds));
            while (pending.length > 0) pending = recordChainStep(pending, await appDatabase.local_library_entities.bulkGet(pending));
        }
    }
    return lookup;
};
