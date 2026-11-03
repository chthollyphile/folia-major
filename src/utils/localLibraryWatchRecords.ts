import type { LocalLibraryChangeRecordLike } from '../types/localLibraryWatch';

// src/utils/localLibraryWatchRecords.ts
// Decides which FileSystemObserver records are worth an incremental rescan.
//
// The observer reports every write under a watched root, including the temp files an editor or a
// downloader leaves next to the real one. Reacting to those would rescan the whole tree twice for
// one added song, so the names are filtered here before anything is queued.

const RELEVANT_EXTENSIONS = new Set([
    'mp3', 'flac', 'm4a', 'wav', 'ogg', 'opus', 'aac',
    'alac', 'ape', 'wv', 'tta', 'wma', 'aif', 'aiff', 'caf', 'dsf', 'dff',
    'lrc', 'vtt', 'ttml', 'qrc', 'yrc', 'krc', 'fia',
    'png', 'jpg', 'jpeg',
]);

const IGNORED_EXTENSIONS = new Set(['tmp', 'temp', 'part', 'partial', 'crdownload', 'download', 'bak']);

/** `errored` means the observation itself broke; it is handled as a watch failure, not as a change. */
export const isObserverErrorRecord = (record: LocalLibraryChangeRecordLike): boolean => record.type === 'errored';

/**
 * Whether a record names something the local-library scan actually reads.
 *
 * A record with no path components, or one whose type is `unknown` (the observer lost track and
 * cannot say what moved), counts as relevant: dropping it would silently lose a real change.
 * Extension-less names are kept too, since those are almost always directories appearing,
 * disappearing or being renamed.
 */
export const isRelevantLocalLibraryChange = (record: LocalLibraryChangeRecordLike): boolean => {
    if (isObserverErrorRecord(record)) return false;
    if (record.type === 'unknown') return true;

    const components = record.relativePathComponents;
    if (!components || components.length === 0) return true;

    const name = components[components.length - 1];
    if (!name || name.startsWith('.') || name.startsWith('~')) return false;

    const dotIndex = name.lastIndexOf('.');
    if (dotIndex <= 0) return true;

    const extension = name.slice(dotIndex + 1).toLowerCase();
    if (IGNORED_EXTENSIONS.has(extension)) return false;

    return RELEVANT_EXTENSIONS.has(extension);
};

export interface LocalLibraryChangeSummary {
    /** How many records ask for a rescan. */
    relevantCount: number;
    /** True when the observer reported that it stopped observing this root. */
    errored: boolean;
}

export const summarizeLocalLibraryChanges = (
    records: readonly LocalLibraryChangeRecordLike[],
): LocalLibraryChangeSummary => records.reduce<LocalLibraryChangeSummary>((summary, record) => {
    if (isObserverErrorRecord(record)) {
        summary.errored = true;
        return summary;
    }
    if (isRelevantLocalLibraryChange(record)) {
        summary.relevantCount += 1;
    }
    return summary;
}, { relevantCount: 0, errored: false });
