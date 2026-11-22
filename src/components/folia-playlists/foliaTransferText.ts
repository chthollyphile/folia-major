import type { TFunction } from 'i18next';
import type {
    FoliaPlayViaUnavailable,
    FoliaPlaylistOrigin,
    FoliaRefreshFromOriginResult,
    FoliaSaveCollectionResult,
} from '../../types/foliaPlaylist';
import { FOLIA_ORIGIN_NAVIDROME, FoliaOriginUnreadableError } from '../../library/app/foliaOriginSongs';
import { omni } from '../../services/onlineMusic/omni';
import { onlineMutationFailureText } from '../../services/onlineMusic/failure/onlineMutationFailure';
import type { FoliaNothingToSaveError } from '../../utils/foliaPlaylistTransfer';

// src/components/folia-playlists/foliaTransferText.ts
// 转存与「从原歌单更新」要说的话：来源的称呼、歌单详情里的出处、做完之后的提示。只有字，不用任何平台的商标。

export type FoliaTransferMessage = { type: 'success' | 'info' | 'error'; text: string; note?: string };

/** 出处里一个来源的称呼：音源的名字（没装时只剩它的 id），Navidrome。 */
export const getFoliaSourceLabel = (sourceId: string, t: TFunction): string => (
    sourceId === FOLIA_ORIGIN_NAVIDROME ? t('navidrome.title') : omni.getProviderLabel(sourceId)
);

const formatMoment = (timestamp: number, language: string | undefined): string => {
    try {
        return new Date(timestamp).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return new Date(timestamp).toLocaleString();
    }
};

/**
 * 转存来的歌单在详情页的出处：来自哪个来源的哪张歌单（或专辑）、上次更新时间（没更新过就是转存的时间）、现在改由谁播放。
 */
export const describeFoliaProvenance = (origin: FoliaPlaylistOrigin, t: TFunction, language?: string): string => {
    const source = getFoliaSourceLabel(origin.sourceId, t);
    const from = origin.collectionType === 'album'
        ? t('foliaTransfer.fromAlbum', { source, name: origin.name })
        : t('foliaTransfer.fromPlaylist', { source, name: origin.name });
    const when = origin.refreshedAt
        ? t('foliaTransfer.refreshedAt', { time: formatMoment(origin.refreshedAt, language) })
        : origin.savedAt > 0 ? t('foliaTransfer.savedAt', { time: formatMoment(origin.savedAt, language) }) : '';
    const via = origin.playVia ? t('foliaTransfer.playedVia', { source: getFoliaSourceLabel(origin.playVia, t) }) : '';
    return [from, when, via].filter(Boolean).join(' · ');
};

/** 目标音源现在问不了的原因（选择里置灰的那一行、结果提示里都用）。 */
export const describePlayViaUnavailable = (reason: FoliaPlayViaUnavailable, t: TFunction): string => {
    switch (reason) {
        case 'not-registered': return t('foliaTransfer.targetNotRegistered');
        case 'switched-off': return t('foliaTransfer.targetSwitchedOff');
        case 'not-configured': return t('foliaTransfer.targetNotConfigured');
        case 'unsupported': return t('foliaTransfer.targetUnsupported');
        case 'failed': return t('foliaTransfer.targetFailed');
    }
};

const joinNotes = (notes: readonly (string | false | undefined)[]): string | undefined => {
    const kept = notes.filter((note): note is string => Boolean(note));
    return kept.length > 0 ? kept.join(' ') : undefined;
};

const playViaAskedNote = (
    playVia: string | undefined,
    unavailable: FoliaPlayViaUnavailable | undefined,
    t: TFunction,
): string | undefined => (
    playVia && unavailable
        ? t('foliaTransfer.playViaNotAsked', { source: getFoliaSourceLabel(playVia, t), reason: describePlayViaUnavailable(unavailable, t) })
        : undefined
);

/**
 * 转存完的提示。要紧的数都写在主句里（提示条的附注放不下会被截掉）：存了几首；选了目标音源的，
 * 其中几首换了、几首没有对应的保持原样；目标音源问不成时照实说，只问成一部分时说出没问成的有几首。
 */
export const describeFoliaSaveResult = (
    result: FoliaSaveCollectionResult,
    playlistName: string,
    playVia: string | undefined,
    t: TFunction,
): FoliaTransferMessage => {
    const saved = result.swapped + result.notSwapped;
    if (saved === 0) return { type: 'error', text: t('foliaTransfer.savedNothing') };
    const text = !playVia
        ? t('foliaTransfer.saved', { name: playlistName, count: saved })
        : result.playViaUnavailable
            ? t('foliaTransfer.savedNotAsked', {
                name: playlistName,
                count: saved,
                source: getFoliaSourceLabel(playVia, t),
                reason: describePlayViaUnavailable(result.playViaUnavailable, t),
            })
            : result.playViaFailed
                ? t('foliaTransfer.savedViaPartly', {
                    name: playlistName,
                    count: saved,
                    source: getFoliaSourceLabel(playVia, t),
                    swapped: result.swapped,
                    kept: result.notSwapped,
                    failed: result.playViaFailed,
                })
                : t('foliaTransfer.savedVia', {
                    name: playlistName,
                    count: saved,
                    source: getFoliaSourceLabel(playVia, t),
                    swapped: result.swapped,
                    kept: result.notSwapped,
                });
    return {
        type: 'success',
        text,
        note: joinNotes([
            playVia && Boolean(result.playViaUnavailable || result.playViaFailed) && t('foliaTransfer.playViaRetryNote'),
            result.duplicates > 0 && t('foliaTransfer.duplicatesNote', { count: result.duplicates }),
            result.rejected > 0 && t('foliaPlaylist.rejectedNote', { count: result.rejected }),
        ]),
    };
};

/**
 * 更新完的提示：主句里是加了几首、几首已不在原歌单里（留在歌单里）；这次换了几首在附注；原歌单读回来是空的就说没动。
 * 目标音源只问成一部分时，没问成的有几首排在附注的最前面（附注放不下时先截后面的）。
 */
export const describeFoliaRefreshResult = (
    result: FoliaRefreshFromOriginResult,
    playlistName: string,
    playVia: string | undefined,
    t: TFunction,
): FoliaTransferMessage => {
    if (result.originEmpty) return { type: 'info', text: t('foliaTransfer.originEmpty', { name: playlistName }) };
    const changed = result.added > 0 || result.swapped > 0 || result.detached > 0;
    const counts = { name: playlistName, count: result.added, detached: result.detached };
    const text = result.added > 0
        ? t(result.detached > 0 ? 'foliaTransfer.refreshedAddedDetached' : 'foliaTransfer.refreshedAdded', counts)
        : t(result.detached > 0 ? 'foliaTransfer.refreshedNoNewDetached' : 'foliaTransfer.refreshedNoNew', counts);
    return {
        type: changed ? 'success' : 'info',
        text,
        note: joinNotes([
            playVia && Boolean(result.playViaFailed) && t('foliaTransfer.playViaPartlyFailedNote', { source: getFoliaSourceLabel(playVia, t), count: result.playViaFailed ?? 0 }),
            playVia && result.swapped > 0 && t('foliaTransfer.swappedNote', { source: getFoliaSourceLabel(playVia, t), count: result.swapped }),
            playViaAskedNote(playVia, result.playViaUnavailable, t),
            result.rejected > 0 && t('foliaPlaylist.rejectedNote', { count: result.rejected }),
        ]),
    };
};

/** 集合里的歌一首都放不进歌单（全是舞台歌）：没有建歌单，照实说有几首不收。 */
export const describeFoliaNothingSavable = (error: FoliaNothingToSaveError, t: TFunction): FoliaTransferMessage => ({
    type: 'error',
    text: t('foliaTransfer.nothingSavable', { count: error.rejected }),
    note: t('foliaTransfer.noPlaylistCreated'),
});

/** 读不到原歌单时的提示：来源不在的说来源，读失败的带上能说清的原因（没登录、歌单不存在之类由音源的错给）。 */
export const describeFoliaOriginUnreadable = (error: unknown, sourceId: string, t: TFunction): FoliaTransferMessage => {
    const source = getFoliaSourceLabel(sourceId, t);
    if (error instanceof FoliaOriginUnreadableError) {
        if (error.reason === 'source-missing') return { type: 'error', text: t('foliaTransfer.originSourceMissing', { source }), note: t('foliaTransfer.nothingWritten') };
        if (error.reason === 'source-off') return { type: 'error', text: t('foliaTransfer.originSourceOff', { source }), note: t('foliaTransfer.nothingWritten') };
        if (error.reason === 'navidrome-unconfigured') return { type: 'error', text: t('foliaPlaylist.navidromeUnconfigured'), note: t('foliaTransfer.nothingWritten') };
        return {
            type: 'error',
            text: onlineMutationFailureText(error.cause, t('foliaTransfer.originReadFailed', { source }), t),
            note: t('foliaTransfer.originReadFailedNote'),
        };
    }
    return { type: 'error', text: t('foliaTransfer.failed'), note: t('foliaTransfer.nothingWritten') };
};
