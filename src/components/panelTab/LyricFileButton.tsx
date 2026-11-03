import React, { useCallback, useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { openCommandPaletteCommand, setIsPanelOpen } from '../../stores/useAppViewStore';
import { exportCurrentSongLyrics } from '../../services/lyricExport/currentSongExport';
import type { LyricExportFormat } from '../../services/lyricExport/types';
import { hasExportableLyrics } from '../../utils/lyrics/exportableLyrics';
import { LYRIC_EXPORT_COMMAND_ID } from '../command-palette/commands/lyricExportCommands';
import LyricFileDialog from './LyricFileDialog';
import { PanelButton } from './shell/PanelButton';

// src/components/panelTab/LyricFileButton.tsx
// The one lyric-file button of the player panel's source tab (local, Navidrome and online share
// it), beside online matching. Import and export open one dialog (LyricFileDialog). This component
// owns the dialog's state and runs its actions: it reads the file chosen for import and hands its
// text on, and it exports.

type LyricFileButtonProps = {
    isDaylight: boolean;
    /** Takes the text of the chosen file. Left out where the source cannot take an imported file. */
    onImportLyrics?: (content: string, fileName: string) => void;
};

const LyricFileButton: React.FC<LyricFileButtonProps> = ({ isDaylight, onImportLyrics }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const canExportCurrent = Boolean(currentSong) && hasExportableLyrics(lyrics);

    const close = useCallback(() => setIsOpen(false), []);

    const handleImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // Emptied, so that choosing the same file again is a change too.
        event.target.value = '';
        close();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const content = reader.result as string | null;
            if (content) {
                onImportLyrics?.(content, file.name);
            }
        };
        reader.readAsText(file);
    };

    const exportCurrent = async (format: LyricExportFormat) => {
        if (!currentSong || isExporting) return;
        setIsExporting(true);
        try {
            // Read the stores at click time: the export re-reads the song's raw lyric source, and
            // the source choice may have changed since this row last rendered.
            const exported = await exportCurrentSongLyrics({
                song: currentSong,
                onScreenLyrics: usePlaybackStore.getState().lyrics,
                activeLocalLyricsSource: usePlaybackStore.getState().activeLocalLyricsSource,
                localLyricsPriority: useLyricSettingsStore.getState().localLyricsPriority,
            }, format);
            setStatusMessage({
                type: exported ? 'success' : 'info',
                text: exported ? t('lyricExport.exported') : t('lyricExport.noLyrics'),
            });
            if (exported) close();
        } catch (error) {
            console.error('[LyricFileButton] Export failed', error);
            setStatusMessage({ type: 'error', text: t('lyricExport.failed') });
        } finally {
            setIsExporting(false);
        }
    };

    const openBatchExport = () => {
        close();
        openCommandPaletteCommand(LYRIC_EXPORT_COMMAND_ID);
        // Same hand-off as the segmentation toggle in AppearanceSection: the palette takes over,
        // so the panel underneath gets out of the way.
        setIsPanelOpen(false);
    };

    return (
        <>
            <PanelButton
                grow
                icon={ArrowDownUp}
                data-ponder-panel-source-lyrics-file
                onClick={() => setIsOpen(true)}
                aria-haspopup="dialog"
            >
                {t('lyricFile.button')}
            </PanelButton>
            <LyricFileDialog
                isOpen={isOpen}
                onClose={close}
                isDaylight={isDaylight}
                onImportChange={onImportLyrics ? handleImportChange : undefined}
                canExportCurrent={canExportCurrent}
                isExporting={isExporting}
                onExportCurrent={format => void exportCurrent(format)}
                onOpenBatchExport={openBatchExport}
            />
        </>
    );
};

export default LyricFileButton;
