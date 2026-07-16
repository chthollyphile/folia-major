import type { LocalSong } from '../types';
import type { LocalLibraryAssignmentOrigin } from '../types/localLibrary';
import { isBlob } from '../utils/blobGuards';
import { applyLocalSongMatchSelection } from './localSongMatchSelectionService';
import {
    findAutomaticOnlineMetadataCandidate,
    type OnlineMetadataCandidate,
} from './onlineMetadataSearchService';

// src/services/localSongMetadataMatchService.ts
// Applies metadata-only matches and orchestrates cancellable two-worker folder batches.

export type LocalSongMetadataMatchStatus = 'matched' | 'matched-cover-failed' | 'no-match' | 'skipped' | 'failed';

export interface LocalSongMetadataMatchUpdate {
    songId: string;
    status: LocalSongMetadataMatchStatus;
    candidate?: OnlineMetadataCandidate;
    error?: unknown;
}

export interface BatchLocalSongMetadataMatchResult {
    updates: LocalSongMetadataMatchUpdate[];
    cancelled: boolean;
}

export interface ApplyOnlineMetadataCandidateOptions {
    mode: 'automatic' | 'manual';
    protectOrigins?: LocalLibraryAssignmentOrigin[];
    useOnlineMetadata?: boolean;
    useOnlineCover?: boolean;
}

// Stores one provider candidate while allowing metadata and cover display sources to be chosen independently.
export const applyOnlineMetadataCandidate = async (
    song: LocalSong,
    candidate: OnlineMetadataCandidate,
    options: ApplyOnlineMetadataCandidateOptions,
): Promise<{ song?: LocalSong; coverAttempted: boolean; coverCached: boolean }> => {
    const useOnlineMetadata = options.useOnlineMetadata ?? true;
    const useOnlineCover = options.mode === 'manual'
        ? Boolean(options.useOnlineCover && candidate.coverUrl)
        : Boolean(candidate.coverUrl && !isBlob(song.embeddedCover));
    const result = await applyLocalSongMatchSelection({
        songId: song.id,
        candidate,
        metadata: useOnlineMetadata ? 'online' : 'imported',
        cover: useOnlineCover ? 'online' : options.mode === 'manual' ? 'embedded' : 'keep',
        lyrics: 'keep',
        setNoAutoMatch: options.mode === 'manual' && (useOnlineMetadata || useOnlineCover) ? false : undefined,
        matchMode: options.mode,
        protectOrigins: options.protectOrigins,
    });
    return { coverAttempted: result.coverAttempted, coverCached: result.coverCached };
};

// Restores the complete imported snapshot and keeps future automatic matching from replacing it.
export const useImportedSnapshotForLocalSong = async (songId: string): Promise<void> => {
    await applyLocalSongMatchSelection({
        songId,
        metadata: 'imported',
        cover: 'embedded',
        lyrics: 'automatic',
        setNoAutoMatch: true,
    });
};

// Processes at most two songs concurrently and reports every completed item immediately.
export async function batchAutoMatchLocalSongMetadata(
    songs: LocalSong[],
    options: {
        signal?: AbortSignal;
        onUpdate?: (update: LocalSongMetadataMatchUpdate) => void;
        concurrency?: number;
    } = {},
): Promise<BatchLocalSongMetadataMatchResult> {
    const updates: LocalSongMetadataMatchUpdate[] = [];
    let nextIndex = 0;
    const record = (update: LocalSongMetadataMatchUpdate) => {
        updates.push(update);
        options.onUpdate?.(update);
    };
    const worker = async () => {
        while (nextIndex < songs.length && !options.signal?.aborted) {
            const song = songs[nextIndex++];
            if (song.noAutoMatch) {
                record({ songId: song.id, status: 'skipped' });
                continue;
            }
            try {
                const candidate = await findAutomaticOnlineMetadataCandidate(song, options.signal);
                if (options.signal?.aborted) return;
                if (!candidate) {
                    record({ songId: song.id, status: 'no-match' });
                    continue;
                }
                const applied = await applyOnlineMetadataCandidate(song, candidate, {
                    mode: 'automatic',
                    protectOrigins: ['manual', 'manual-match', 'split'],
                });
                record({
                    songId: song.id,
                    status: applied.coverAttempted && !applied.coverCached ? 'matched-cover-failed' : 'matched',
                    candidate,
                });
            } catch (error) {
                if ((error as Error).name === 'AbortError') return;
                record({ songId: song.id, status: 'failed', error });
            }
        }
    };
    const workerCount = Math.max(1, Math.min(options.concurrency ?? 2, 2, songs.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { updates, cancelled: Boolean(options.signal?.aborted) };
}
