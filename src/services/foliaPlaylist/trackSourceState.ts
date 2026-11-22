import type { TFunction } from 'i18next';
import type { SongResult, UnifiedSong } from '../../types';
import { getNavidromeConfig } from '../navidromeService';
import { omni } from '../onlineMusic/omni';
import { getSongUnavailableLabel, isSongUnavailable } from '../onlineMusic/songAvailability';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import type { FoliaEntryAvailability, FoliaEntryAvailabilityDeps } from '../../library/core/foliaPlaylist/foliaPlaylist.contract';
import { resolveFoliaEntryAvailability } from '../../library/core/foliaPlaylist/foliaPlaylistAvailability';

// src/services/foliaPlaylist/trackSourceState.ts
// 一首歌的来源此刻在不在，以及一行歌该不该画成「现在播不了」。Folia 聚合歌单里混着各个来源的歌：音源被停用、
// 模组被卸载、Navidrome 没配置时，那几行留在歌单里但置灰，整张播放时跳过（集合页的「可播放曲目」按这里的判断筛）。
// 别的集合页也走这里：它们的歌都来自正开着的来源，判断恒为可用，行为不变。
// 判断读的是此刻的状态；音源增减或开关变化后要重新判断，用 subscribeTrackSources / readTrackSourcesVersion 订阅。

// 集合页里的本地行都是从曲库里解析出来的（歌单读的时候已经把曲库里没有的行删了），所以这里不再查曲库。
const DEPS: FoliaEntryAvailabilityDeps = {
    hasLocalSong: () => true,
    isSourceRegistered: sourceId => omni.getProviderNaming(sourceId) !== null,
    isSourceSwitchedOn: sourceId => omni.isSourceSwitchedOn(sourceId),
    isNavidromeConfigured: () => getNavidromeConfig() !== null,
};

/** 这首歌的来源现在的状态（规则在 foliaPlaylistAvailability）。 */
export const resolveTrackSourceAvailability = (track: SongResult): FoliaEntryAvailability => (
    resolveFoliaEntryAvailability({ song: track }, DEPS)
);

export const isTrackSourceUnavailable = (track: SongResult): boolean => (
    resolveTrackSourceAvailability(track).state !== 'available'
);

/** 一行歌现在播不了：这首歌本身下架了（平台说的），或者它的来源不在。 */
export const isTrackShownUnplayable = (track: SongResult): boolean => (
    isSongUnavailable(track) || isTrackSourceUnavailable(track)
);

const SOURCE_REASON_KEYS: Record<Exclude<FoliaEntryAvailability['state'], 'available'>, string> = {
    'source-off': 'foliaPlaylist.sourceOff',
    'source-missing': 'foliaPlaylist.sourceMissing',
    'local-missing': 'foliaPlaylist.localMissing',
    'navidrome-unconfigured': 'foliaPlaylist.navidromeUnconfigured',
};

/** 一行歌播不了的原因（行上的小标签）；播得了是 ''。 */
export const getTrackUnplayableLabel = (track: SongResult, t: TFunction, unavailableFallback: string): string => {
    const availability = resolveTrackSourceAvailability(track);
    if (availability.state !== 'available') return t(SOURCE_REASON_KEYS[availability.state]);
    return isSongUnavailable(track) ? getSongUnavailableLabel(track, unavailableFallback) : '';
};

/** 来源的称呼（混合来源的歌单里每行标一下）：音源的名字、Navidrome、本地。只是字，不用平台的商标。 */
export const getTrackSourceLabel = (track: SongResult, t: TFunction): string => {
    const source = getPlaybackSourceRef(track);
    if (source.kind === 'online') return omni.getProviderLabel(source.providerId);
    if (source.kind === 'navidrome') return t('navidrome.title');
    return t('scratchpad.sourceLocal');
};

/**
 * 这一行是不是换过来源（转存时「改由某个音源播放」换的），换过的话原来是哪个来源的歌：一句悬停说明；没换过是 ''。
 * 原来那首的 key 是 `online:<音源>:<id>`、`navidrome:<id>`、`local:<id>`。
 */
export const getTrackSwappedFromLabel = (track: SongResult, t: TFunction): string => {
    const originalKey = (track as UnifiedSong).foliaOriginalKey;
    if (!originalKey) return '';
    const [kind, sourceId] = originalKey.split(':');
    const source = kind === 'online' && sourceId
        ? omni.getProviderLabel(sourceId)
        : kind === 'navidrome' ? t('navidrome.title') : kind === 'local' ? t('scratchpad.sourceLocal') : '';
    return source ? t('foliaTransfer.swappedFrom', { source }) : t('foliaTransfer.swappedFromUnknown');
};

/** 换过来源的行上的小记号（只是一个字符，说明在悬停里）。 */
export const TRACK_SWAPPED_MARK = '\u21C4';

/** 来源的身份（给标签上色用，同一个来源同一种颜色）。 */
export const getTrackSourceKey = (track: SongResult): string => {
    const source = getPlaybackSourceRef(track);
    return source.kind === 'online' ? `online:${source.providerId}` : source.kind;
};

/** 来源标签的色相（0–359）：由来源身份算出来，稳定，不取自任何平台的品牌色。 */
export const trackSourceHue = (sourceKey: string): number => {
    let hash = 0;
    for (let index = 0; index < sourceKey.length; index += 1) {
        hash = (hash * 31 + sourceKey.charCodeAt(index)) % 360;
    }
    return hash;
};

export const subscribeTrackSources = (listener: () => void): (() => void) => omni.subscribeProviders(listener);
export const readTrackSourcesVersion = (): number => omni.getProviderRegistryVersion();
