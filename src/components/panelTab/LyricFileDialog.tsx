import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from '../shared/Sheet';
import { Group, Row, type SettingsGroupDef } from '../modal/settings/kit';
import type { LyricExportFormat } from '../../services/lyricExport/types';

// src/components/panelTab/LyricFileDialog.tsx
// The lyric file dialog behind the panel's import / export button: import a file, export this song
// as .fia or .lrc, or hand off to the batch export page. It is the app's sheet with the settings
// kit's groups and rows. Presentational: the button owns the state and the actions.
//
// The dialog's sheet is drawn outside the panel. React events still bubble to the panel root,
// where they are stopped, so clicking in here never closes the panel.

/** Every format the local-file adapter reads, `.fia` included. */
const LYRIC_IMPORT_ACCEPT = '.lrc,.vtt,.ttml,.qrc,.yrc,.krc,.txt,.fia,.json';

const IMPORT_GROUP: SettingsGroupDef = { id: 'lyricFileImport', titleKey: 'lyricFile.importHeading' };
const EXPORT_GROUP: SettingsGroupDef = { id: 'lyricFileExport', titleKey: 'lyricFile.exportHeading' };
const BATCH_GROUP: SettingsGroupDef = { id: 'lyricFileBatch', titleKey: 'lyricFile.batchTitle' };

type LyricFileDialogProps = {
    isOpen: boolean;
    onClose: () => void;
    isDaylight: boolean;
    /** Left out where the source cannot take an imported file; the import section is then hidden. */
    onImportChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    canExportCurrent: boolean;
    isExporting: boolean;
    onExportCurrent: (format: LyricExportFormat) => void;
    onOpenBatchExport: () => void;
};

const LyricFileDialog: React.FC<LyricFileDialogProps> = ({
    isOpen,
    onClose,
    isDaylight,
    onImportChange,
    canExportCurrent,
    isExporting,
    onExportCurrent,
    onOpenBatchExport,
}) => {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const exportDisabled = !canExportCurrent || isExporting;

    return (
        <Sheet
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            size="m"
            title={t('lyricFile.title')}
            subtitle={t(onImportChange ? 'lyricFile.description' : 'lyricFile.descriptionExportOnly')}
        >
            {/* A group keeps the space a settings page has above its first card; here the sheet's header is close above it. */}
            <div data-ponder="lyric-file-dialog" className="-mt-4">
                {onImportChange && (
                    <Group def={IMPORT_GROUP}>
                        <Row
                            label={t('lyricFile.importChoose')}
                            hint={t('lyricFile.importFormats')}
                            onClick={() => inputRef.current?.click()}
                        />
                    </Group>
                )}

                <Group def={EXPORT_GROUP} foot={canExportCurrent ? undefined : t('lyricExport.noLyrics')}>
                    <Row
                        label={t('lyricExport.formatFia')}
                        hint={t('lyricExport.formatFiaDesc')}
                        disabled={exportDisabled}
                        onClick={() => onExportCurrent('fia')}
                    />
                    <Row
                        label={t('lyricExport.formatLrc')}
                        hint={t('lyricExport.formatLrcDesc')}
                        disabled={exportDisabled}
                        onClick={() => onExportCurrent('lrc')}
                    />
                </Group>

                <Group def={BATCH_GROUP} bare>
                    <Row label={t('lyricFile.batchTitle')} hint={t('lyricFile.batchDesc')} onClick={onOpenBatchExport} />
                </Group>

                {onImportChange && (
                    <input
                        type="file"
                        accept={LYRIC_IMPORT_ACCEPT}
                        ref={inputRef}
                        className="hidden"
                        onChange={onImportChange}
                    />
                )}
            </div>
        </Sheet>
    );
};

export default LyricFileDialog;
