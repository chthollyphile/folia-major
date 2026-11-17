import type { LocalSong } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity, LocalLibraryEntityKind } from '../types/localLibrary';
import type { LocalLibraryIndex } from './localLibraryIndex';
import {
    getAlbumImportContextKey,
    getImportedAlbumName,
    getImportedArtistNames,
    normalizeLocalLibraryName,
} from './localLibraryNames';
import { resolveLocalLibraryEntity } from './localLibraryResolver';

// src/utils/localLibraryImportAssignment.ts
// 导入归属的规则（纯计算）：给一批导入或重扫的歌定歌手、专辑实体。用到的库内数据由
// services/localLibraryImportLookup 按索引预取好交进来，这里不碰数据库，也就不随曲库大小变慢。

/** 一批歌定归属要用到的库内数据，全部是这一批开始前的状态。 */
export interface ImportAssignmentLookup {
    /**
     * 这一批用得到的实体：别名与批内某个名字相同的、现有归属和推断出的专辑指向的，以及它们 mergedInto 链上的全部实体。
     * entityIdsByAlias 只含批内名字的别名，键是 `${kind}:${alias}`，同一个键下的 id 按主键顺序。
     */
    index: LocalLibraryIndex;
    /** 这一批歌现有的归属。 */
    currentAssignments: Map<string, LocalLibraryAssignment>;
    /** 每个专辑上下文键在批前对应的专辑：同键的歌按 songId 顺序最后一条有专辑的归属。 */
    contextAlbumIds: Map<string, string | undefined>;
    /** 别名与批内某个歌手名相同的实体（不分种类），按规范化的名字。 */
    artistAliasEntityIds: Map<string, string[]>;
    /** 上面这些实体在批前归属里出现过的专辑。没有歌需要按歌手重叠推专辑时为空。 */
    albumIdsByArtistEntity: Map<string, Set<string>>;
    /** 批前的专辑成员，按 songId 顺序。只含需要按专辑推歌手的歌会落到的专辑。 */
    albumMembers: Map<string, LocalLibraryAssignment[]>;
}

interface Resolution {
    index: LocalLibraryIndex;
    created: LocalLibraryEntity[];
    createId: () => string;
}

const cloneIndex = (index: LocalLibraryIndex): LocalLibraryIndex => ({
    entitiesById: new Map(index.entitiesById),
    entityIdsByAlias: new Map(Array.from(index.entityIdsByAlias, ([key, ids]) => [key, [...ids]] as const)),
    assignmentsBySongId: index.assignmentsBySongId,
});

// 逐个名字解析；新建的实体记进索引，同一批后面同名的歌能找到它。
const resolveNames = (
    resolution: Resolution,
    kind: LocalLibraryEntityKind,
    names: string[],
    preferredEntityIds: string[],
): string[] => {
    const ids: string[] = [];
    names.forEach(name => {
        const resolved = resolveLocalLibraryEntity({
            entities: [],
            index: resolution.index,
            kind,
            name,
            preferredEntityIds,
            createId: resolution.createId,
        });
        if (!resolved) return;
        if (resolved.created) {
            const { entity } = resolved;
            resolution.created.push(entity);
            resolution.index.entitiesById.set(entity.id, entity);
            entity.normalizedAliases.forEach(alias => {
                const key = `${entity.kind}:${alias}`;
                resolution.index.entityIdsByAlias.set(key, [...(resolution.index.entityIdsByAlias.get(key) || []), entity.id]);
            });
        }
        ids.push(resolved.entity.id);
    });
    return Array.from(new Set(ids));
};

const getProtection = (song: LocalSong, lookup: ImportAssignmentLookup, preserveNonImportAssignments: boolean) => {
    const current = lookup.currentAssignments.get(song.id);
    return {
        current,
        preserveArtist: Boolean(preserveNonImportAssignments && current && current.artistOrigin !== 'import'),
        preserveAlbum: Boolean(preserveNonImportAssignments && current && current.albumOrigin !== 'import'),
    };
};

/** 同名专辑有歧义时的退路：这首歌的歌手在批前恰好只出现在一张专辑里，就用那张。 */
const getArtistOverlapAlbumId = (song: LocalSong, lookup: ImportAssignmentLookup): string | undefined => {
    const albumIds = new Set<string>();
    new Set(getImportedArtistNames(song).map(normalizeLocalLibraryName)).forEach(name => {
        lookup.artistAliasEntityIds.get(name)?.forEach(entityId => {
            lookup.albumIdsByArtistEntity.get(entityId)?.forEach(albumId => albumIds.add(albumId));
        });
    });
    return albumIds.size === 1 ? Array.from(albumIds)[0] : undefined;
};

// 专辑：受保护时沿用；否则按 同文件夹上下文 → 现有归属 → 歌手重叠 的顺序给出偏好，再按名字解析。
const resolveAlbum = (
    song: LocalSong,
    lookup: ImportAssignmentLookup,
    preserveNonImportAssignments: boolean,
    resolution: Resolution,
    batchContext: Map<string, string>,
): string | undefined => {
    const { current, preserveAlbum } = getProtection(song, lookup, preserveNonImportAssignments);
    if (preserveAlbum) return current?.albumEntityId;
    const albumName = getImportedAlbumName(song);
    if (!albumName) return undefined;
    const contextKey = getAlbumImportContextKey(song, albumName);
    const contextAlbumId = batchContext.has(contextKey) ? batchContext.get(contextKey) : lookup.contextAlbumIds.get(contextKey);
    const preferredId = contextAlbumId || current?.albumEntityId || getArtistOverlapAlbumId(song, lookup);
    const albumId = resolveNames(resolution, 'album', [albumName], preferredId ? [preferredId] : [])[0];
    if (albumId) batchContext.set(contextKey, albumId);
    return albumId;
};

/** 这首歌的歌手要不要靠专辑里其他歌的歌手消歧：没有受保护，现有归属里也没有歌手。 */
export const needsAlbumArtistContext = (
    song: LocalSong,
    lookup: ImportAssignmentLookup,
    preserveNonImportAssignments: boolean,
): boolean => {
    const { current, preserveArtist } = getProtection(song, lookup, preserveNonImportAssignments);
    return !preserveArtist && !current?.artistEntityIds.length;
};

/** 批内哪些现有专辑需要取成员：空跑一遍专辑解析（不新建实体），收集需要按专辑推歌手的歌落到的现有专辑。 */
export const planAlbumMemberLookups = (
    songs: LocalSong[],
    lookup: ImportAssignmentLookup,
    preserveNonImportAssignments: boolean,
): string[] => {
    if (!songs.some(song => needsAlbumArtistContext(song, lookup, preserveNonImportAssignments))) return [];
    let placeholder = 0;
    const dryRun: Resolution = { index: cloneIndex(lookup.index), created: [], createId: () => `dry-run-${placeholder++}` };
    const batchContext = new Map<string, string>();
    const albumIds = new Set<string>();
    songs.forEach(song => {
        const albumId = resolveAlbum(song, lookup, preserveNonImportAssignments, dryRun, batchContext);
        if (!albumId || !needsAlbumArtistContext(song, lookup, preserveNonImportAssignments)) return;
        if (!dryRun.created.some(entity => entity.id === albumId)) albumIds.add(albumId);
    });
    return Array.from(albumIds);
};

/** 按批内顺序给每首歌定归属；返回要写的归属和这一批新建的实体。 */
export const computeImportedAssignments = (
    songs: LocalSong[],
    lookup: ImportAssignmentLookup,
    preserveNonImportAssignments: boolean,
    createId: () => string,
): { assignments: LocalLibraryAssignment[]; created: LocalLibraryEntity[] } => {
    const resolution: Resolution = { index: cloneIndex(lookup.index), created: [], createId };
    const batchContext = new Map<string, string>();
    const assignments: LocalLibraryAssignment[] = [];
    songs.forEach(song => {
        const { current, preserveArtist, preserveAlbum } = getProtection(song, lookup, preserveNonImportAssignments);
        const albumId = resolveAlbum(song, lookup, preserveNonImportAssignments, resolution, batchContext);
        let artistEntityIds: string[];
        if (preserveArtist) {
            artistEntityIds = current?.artistEntityIds || [];
        } else {
            const preferred = current?.artistEntityIds.length
                ? current.artistEntityIds
                : albumId
                    ? [...(lookup.albumMembers.get(albumId) || []), ...assignments]
                        .filter(assignment => assignment.albumEntityId === albumId)
                        .flatMap(assignment => assignment.artistEntityIds)
                    : [];
            artistEntityIds = resolveNames(resolution, 'artist', getImportedArtistNames(song), preferred);
        }
        assignments.push({
            songId: song.id,
            artistEntityIds,
            artistOrigin: preserveArtist ? current?.artistOrigin || 'import' : 'import',
            albumEntityId: albumId,
            albumOrigin: preserveAlbum ? current?.albumOrigin || 'import' : 'import',
            updatedAt: Date.now(),
        });
    });
    return { assignments, created: resolution.created };
};
