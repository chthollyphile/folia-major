import type React from 'react';
import type LyricMatchModal from '../../modal/LyricMatchModal';
import type NaviLyricMatchModal from '../../modal/NaviLyricMatchModal';
import type OnlineLyricMatchModal from '../../modal/OnlineLyricMatchModal';
import type UnavailableReplacementDialog from '../../modal/UnavailableReplacementDialog';
import type SettingsModal from '../../modal/SettingsModal';
import type { StatusMessage, SongResult, LocalSong } from '../../../types';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from '../../../utils/appPlaybackGuards';

// src/components/app/dialogs/buildAppDialogsModel.ts

type LyricMatchDialogProps = React.ComponentProps<typeof LyricMatchModal>;
type NaviLyricMatchDialogProps = React.ComponentProps<typeof NaviLyricMatchModal>;
type OnlineLyricMatchDialogProps = React.ComponentProps<typeof OnlineLyricMatchModal>;
type UnavailableReplacementDialogProps = React.ComponentProps<typeof UnavailableReplacementDialog>;
type SettingsDialogProps = React.ComponentProps<typeof SettingsModal>;

type AppStatusToast = StatusMessage & {
    isDaylight: boolean;
    toastKey: string;
};

export type AppDialogsModel = {
    statusToast?: AppStatusToast | null;
    lyricMatchDialog?: LyricMatchDialogProps | null;
    naviLyricMatchDialog?: NaviLyricMatchDialogProps | null;
    onlineLyricMatchDialog?: OnlineLyricMatchDialogProps | null;
    unavailableReplacementDialog?: UnavailableReplacementDialogProps | null;
    settingsDialog?: SettingsDialogProps | null;
};

type BuildAppDialogsModelParams = {
    statusMsg: StatusMessage | null;
    isDaylight: boolean;
    showLyricMatchModal: boolean;
    showNaviLyricMatchModal: boolean;
    showOnlineLyricMatchModal: boolean;
    currentSong: SongResult | null;
    localSongs: LocalSong[];
    setShowLyricMatchModal: React.Dispatch<React.SetStateAction<boolean>>;
    setShowNaviLyricMatchModal: React.Dispatch<React.SetStateAction<boolean>>;
    setShowOnlineLyricMatchModal: React.Dispatch<React.SetStateAction<boolean>>;
    handleLyricMatchComplete: () => Promise<void>;
    handleNaviLyricMatchComplete: () => Promise<void>;
    handleOnlineLyricMatchComplete: () => Promise<void>;
    pendingUnavailableReplacement: {
        originalSong: SongResult;
        replacementSong: SongResult;
        typeDesc?: string;
    } | null;
    setPendingUnavailableReplacement: React.Dispatch<React.SetStateAction<any>>;
    handleUnavailableReplacementConfirm: () => Promise<void>;
    settingsDialog?: SettingsDialogProps | null;
};

// Builds the centralized dialog model for toast, lyric matching, and unavailable-song replacement.
export const buildAppDialogsModel = ({
    statusMsg,
    isDaylight,
    showLyricMatchModal,
    showNaviLyricMatchModal,
    showOnlineLyricMatchModal,
    currentSong,
    localSongs,
    setShowLyricMatchModal,
    setShowNaviLyricMatchModal,
    setShowOnlineLyricMatchModal,
    handleLyricMatchComplete,
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
    lyricMatchDialog: showLyricMatchModal
        && currentSong
        && isLocalPlaybackSong(currentSong)
        && localSongs.some(song => song.id === currentSong.localRef.songId)
        ? {
            song: localSongs.find(song => song.id === currentSong.localRef.songId)!,
            onClose: () => setShowLyricMatchModal(false),
            onMatch: handleLyricMatchComplete,
            isDaylight,
        }
        : null,
    naviLyricMatchDialog: showNaviLyricMatchModal && currentSong && (currentSong as SongResult & { isNavidrome?: boolean }).isNavidrome
        ? {
            song: (currentSong as SongResult & { navidromeData: any }).navidromeData,
            onClose: () => setShowNaviLyricMatchModal(false),
            onMatch: handleNaviLyricMatchComplete,
            isDaylight,
        }
        : null,
    onlineLyricMatchDialog: showOnlineLyricMatchModal && currentSong && !isLocalPlaybackSong(currentSong) && !isNavidromePlaybackSong(currentSong) && !isStagePlaybackSong(currentSong)
        ? {
            song: currentSong,
            onClose: () => setShowOnlineLyricMatchModal(false),
            onMatch: handleOnlineLyricMatchComplete,
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
});
