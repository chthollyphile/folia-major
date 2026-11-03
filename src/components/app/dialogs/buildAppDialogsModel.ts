import type { LyricMatchDialogProps } from '../../modal/lyric-match/LyricMatchDialog';
import type UnavailableReplacementDialog from '../../modal/UnavailableReplacementDialog';
import type SettingsModal from '../../modal/SettingsModal';
import type ConfirmDialog from '../../shared/ConfirmDialog';
import type { StatusMessage, SongResult, LocalSong } from '../../../types';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from '../../../utils/appPlaybackGuards';
import type React from 'react';

// src/components/app/dialogs/buildAppDialogsModel.ts

type UnavailableReplacementDialogProps = React.ComponentProps<typeof UnavailableReplacementDialog>;
type SettingsDialogProps = React.ComponentProps<typeof SettingsModal>;
type ConfirmDialogProps = React.ComponentProps<typeof ConfirmDialog>;

export type AppStatusToast = StatusMessage & {
    isDaylight: boolean;
    toastKey: string;
};

export type AppDialogsModel = {
    statusToast?: AppStatusToast | null;
    lyricMatchDialog?: LyricMatchDialogProps | null;
    unavailableReplacementDialog?: UnavailableReplacementDialogProps | null;
    settingsDialog?: SettingsDialogProps | null;
    wallpaperEntryConfirmDialog?: ConfirmDialogProps | null;
};

// What this file can read for itself, so the caller never names it. See useAppDialogsModel below.
type AppDialogsAmbient = {
    statusMsg: StatusMessage | null;
    isDaylight: boolean;
    currentSong: SongResult | null;
    wallpaperEntryConfirmDialog: ConfirmDialogProps;
};

export type AppDialogsDeps = {
    /** The window for matching lyrics by hand is open for the playing song. */
    isLyricMatchOpen: boolean;
    localSongs: LocalSong[];
    closeLyricMatch: () => void;
    /** Each is given the song its window was opened for: the save may end after another song started. */
    handleLyricMatchComplete: (matchedFor: SongResult, failureMessage?: string) => Promise<void>;
    handleLyricMatchPureMusicMarkChanged: (marked: boolean) => Promise<void>;
    handleNaviLyricMatchComplete: (matchedFor: SongResult) => Promise<void>;
    handleOnlineLyricMatchComplete: (matchedFor: SongResult) => Promise<void>;
    pendingUnavailableReplacement: {
        originalSong: SongResult;
        replacementSong: SongResult;
        typeDesc?: string;
    } | null;
    setPendingUnavailableReplacement: React.Dispatch<React.SetStateAction<any>>;
    handleUnavailableReplacementConfirm: () => Promise<void>;
    settingsDialog?: SettingsDialogProps | null;
};

type BuildAppDialogsModelParams = AppDialogsAmbient & AppDialogsDeps;

// Builds the centralized dialog model for toast, lyric matching, and unavailable-song replacement.
export const buildAppDialogsModel = ({
    statusMsg,
    isDaylight,
    isLyricMatchOpen,
    currentSong,
    wallpaperEntryConfirmDialog,
    localSongs,
    closeLyricMatch,
    handleLyricMatchComplete,
    handleLyricMatchPureMusicMarkChanged,
    handleNaviLyricMatchComplete,
    handleOnlineLyricMatchComplete,
    pendingUnavailableReplacement,
    setPendingUnavailableReplacement,
    handleUnavailableReplacementConfirm,
    settingsDialog = null,
}: BuildAppDialogsModelParams): AppDialogsModel => ({
    statusToast: statusMsg
        ? {
            ...statusMsg,
            isDaylight,
            toastKey: `${statusMsg.type}:${statusMsg.text}:${statusMsg.nonce ?? 0}`,
        }
        : null,
    // The window for matching lyrics by hand is one; the playing song's kind says how it is filled.
    lyricMatchDialog: !isLyricMatchOpen || !currentSong
        ? null
        : isLocalPlaybackSong(currentSong)
            ? localSongs.some(song => song.id === currentSong.localRef.songId)
                ? {
                    kind: 'local',
                    song: localSongs.find(song => song.id === currentSong.localRef.songId)!,
                    onClose: closeLyricMatch,
                    onMatch: failureMessage => handleLyricMatchComplete(currentSong, failureMessage),
                    onPureMusicMarkChanged: handleLyricMatchPureMusicMarkChanged,
                    isDaylight,
                }
                : null
            : isNavidromePlaybackSong(currentSong)
                ? {
                    kind: 'navidrome',
                    song: (currentSong as SongResult & { navidromeData: any }).navidromeData,
                    onClose: closeLyricMatch,
                    onMatch: () => handleNaviLyricMatchComplete(currentSong),
                    isDaylight,
                }
                : !isStagePlaybackSong(currentSong)
                    ? {
                        kind: 'online',
                        song: currentSong,
                        onClose: closeLyricMatch,
                        onMatch: () => handleOnlineLyricMatchComplete(currentSong),
                        isDaylight,
                    }
                    : null,
    unavailableReplacementDialog: {
        isOpen: Boolean(pendingUnavailableReplacement),
        originalSong: pendingUnavailableReplacement?.originalSong || null,
        replacementSong: pendingUnavailableReplacement?.replacementSong || null,
        typeDesc: pendingUnavailableReplacement?.typeDesc,
        isDaylight,
        onClose: () => setPendingUnavailableReplacement(null),
        onConfirm: handleUnavailableReplacementConfirm,
    },
    settingsDialog,
    wallpaperEntryConfirmDialog,
});
