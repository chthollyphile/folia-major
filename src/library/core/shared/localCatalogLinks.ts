import type { LocalSong } from '../../../types';
import type { LocalLibraryEntity } from '../../../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect, type LocalLibraryIndex } from '../../../utils/localLibraryIndex';
import type { LibraryLocalCatalog } from '../artist/artist.contract';

// src/library/core/shared/localCatalogLinks.ts
// 本地专辑 / 歌手的 catalog 解析：给一个实体 id（或名字），找到它当前的实体（跟随合并重定向）与它的歌。
// 原先有三份几乎一样的实现：宿主 GridViewOverlayHost 的 handlePushAlbumCollection / handlePushArtistCollection
// （嵌套打开）、播放器面板的 createPlayerPanelCollectionEntries（打开正在播放的专辑 / 歌手），以及歌手页自己的
// 本地分支。成员判定统一为「跟随重定向之后指向这个实体」：合并实体时 mergeEntities 会把归属改写到目标上，
// 所以与歌手页原来的 `artistEntityIds.includes(id)` 在实际数据上等价，只是对没改写干净的旧数据更宽容。

export type LocalCatalogEntityKind = 'album' | 'artist';

type CatalogLike = Pick<LibraryLocalCatalog, 'entities' | 'assignments'>;

/** 要解析的实体：优先按 id（跟随重定向）；id 解析不到时才按名字找一个同类、未被合并的实体。 */
export type LocalCatalogEntityRef = {
    kind: LocalCatalogEntityKind;
    entityId?: string;
    name?: string;
};

export type LocalCatalogLink = {
    entity: LocalLibraryEntity;
    /** 这个实体的歌，按 songs 参数的顺序。 */
    songs: LocalSong[];
};

export const buildLocalCatalogIndex = (catalog: CatalogLike): LocalLibraryIndex => (
    buildLocalLibraryIndex(catalog.entities, catalog.assignments)
);

/** 按 id（跟随重定向）或名字找到当前的实体；类型不符时为 null（按 id 找到了但类型不对，不再按名字兜底）。 */
export const resolveLocalCatalogEntity = (
    catalog: CatalogLike,
    ref: LocalCatalogEntityRef,
    index: LocalLibraryIndex = buildLocalCatalogIndex(catalog),
): LocalLibraryEntity | null => {
    const activeId = ref.entityId ? followEntityRedirect(ref.entityId, index.entitiesById) : undefined;
    const entity = activeId
        ? index.entitiesById.get(activeId)
        : ref.name !== undefined
            ? catalog.entities.find(candidate => (
                candidate.kind === ref.kind && !candidate.mergedInto && candidate.displayName === ref.name
            ))
            : undefined;
    return entity?.kind === ref.kind ? entity : null;
};

/** 这个实体名下的歌 id（专辑看 albumEntityId，歌手看 artistEntityIds；都跟随重定向）。 */
export const resolveLocalEntitySongIds = (
    catalog: CatalogLike,
    entity: LocalLibraryEntity,
    index: LocalLibraryIndex = buildLocalCatalogIndex(catalog),
): Set<string> => {
    const owns = entity.kind === 'artist'
        ? (assignment: CatalogLike['assignments'][number]) => assignment.artistEntityIds.some(entityId => (
            followEntityRedirect(entityId, index.entitiesById) === entity.id
        ))
        : (assignment: CatalogLike['assignments'][number]) => Boolean(assignment.albumEntityId && (
            followEntityRedirect(assignment.albumEntityId, index.entitiesById) === entity.id
        ));
    return new Set(catalog.assignments.filter(owns).map(assignment => assignment.songId));
};

/** 解析实体并取出它的歌（按 songs 的顺序）；实体不存在时为 null。 */
export const resolveLocalCatalogLink = (
    catalog: CatalogLike,
    songs: readonly LocalSong[],
    ref: LocalCatalogEntityRef,
    index: LocalLibraryIndex = buildLocalCatalogIndex(catalog),
): LocalCatalogLink | null => {
    const entity = resolveLocalCatalogEntity(catalog, ref, index);
    if (!entity) return null;
    const memberIds = resolveLocalEntitySongIds(catalog, entity, index);
    return { entity, songs: songs.filter(song => memberIds.has(song.id)) };
};

/** 一首本地歌在 catalog 里归属的专辑 / 第一位歌手（未跟随重定向的原始 id，交给 resolveLocalCatalogEntity）。 */
export const resolveLocalSongEntityId = (
    index: LocalLibraryIndex,
    songId: string,
    kind: LocalCatalogEntityKind,
): string | undefined => {
    const assignment = index.assignmentsBySongId.get(songId);
    return kind === 'album' ? assignment?.albumEntityId : assignment?.artistEntityIds[0];
};
