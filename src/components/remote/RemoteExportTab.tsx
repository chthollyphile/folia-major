import React from 'react';
import { Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VideoExportState } from '../../types/videoExport';
import { isAlphaVideoFormatId } from '../../types/videoExport';
import { useVideoExportFfmpegStatus } from '../../hooks/useVideoExportFfmpegStatus';
import { REMOTE_NO_DRAG_STYLE, sendRemoteCommand } from './remoteWindowBridge';
import { RemoteSeg } from './RemoteSheetControls';
import { formatRemoteSize, RemoteSizeSeg } from './RemoteSizeRows';
import type { RemoteExportBackground, RemoteExportChoices } from './useRemoteExportChoices';

// src/components/remote/RemoteExportTab.tsx
// The "export video" tab of the remote window's sheet. Before a recording: range, size, start.
// While one is busy: a large line with the countdown number or the percent, and stop / cancel.
// The controls live only in this window, which the recording does not capture. The background row
// says plainly which of the two exports runs: opaque records the window with sound; transparent
// renders a video with alpha through the user's full ffmpeg (no sound), in one of the formats that
// ffmpeg can write, picked beside it.

const ALPHA_FORMAT_LABEL_KEYS = {
    prores: 'remote.formatProres',
    vp9: 'remote.formatVp9',
    qtrle: 'remote.formatQtrle',
} as const;

export const isRemoteExportBusy = (status: VideoExportState['status']) => (
    status === 'preparing'
    || status === 'countdown'
    || status === 'recording'
    || status === 'finalizing'
);

type RemoteExportTabProps = {
    exportState: VideoExportState;
    choices: RemoteExportChoices;
    /** No song, or the main window has the controls locked: a recording cannot start. */
    startDisabled: boolean;
    onOpenSize: () => void;
};

const RemoteExportTab: React.FC<RemoteExportTabProps> = ({ exportState, choices, startDisabled, onOpenSize }) => {
    const { t } = useTranslation();
    const { status } = exportState;
    const ffmpeg = useVideoExportFfmpegStatus().status;
    const alphaFormats = (ffmpeg?.formats ?? []).filter(isAlphaVideoFormatId);
    const canExportAlpha = alphaFormats.length > 0;
    // Transparent only while the ffmpeg in use can write it; a format it lacks falls back to its first.
    const transparent = choices.background === 'transparent' && canExportAlpha;
    const alphaFormat = alphaFormats.includes(choices.alphaFormat) ? choices.alphaFormat : alphaFormats[0];
    const isAlpha = exportState.kind === 'alpha';

    if (isRemoteExportBusy(status)) {
        const preset = choices.presets.find(item => item.id === exportState.presetId) ?? choices.selectedPreset;
        const sizeText = `${t(preset.orientation === 'portrait' ? 'remote.portrait' : 'remote.landscape')} ${formatRemoteSize(preset.width, preset.height)}`;
        const headline = status === 'recording'
            ? `${Math.round(exportState.progress * 100)}%`
            : status === 'countdown'
                ? `${exportState.countdown ?? ''}`
                : t(status === 'finalizing' ? 'remote.saving' : 'remote.preparing');
        const phase = status === 'recording'
            ? t(isAlpha ? 'remote.rendering' : 'remote.recording')
            : status === 'countdown' ? t('remote.startingSoon') : '';

        return (
            <>
                <div className="remote-sheet__status" aria-live="polite">
                    <div className="remote-sheet__hero">
                        <span className="remote-sheet__dot" data-tone={status === 'recording' ? 'live' : 'wait'} />
                        {headline}
                    </div>
                    <div className="remote-sheet__sub">{phase ? `${phase}　${sizeText}` : sizeText}</div>
                </div>
                <div className="remote-sheet__acts">
                    {/* A transparent render ends at its end time; stopping early would leave half a file. */}
                    {!isAlpha && <button
                        type="button"
                        disabled={status !== 'recording'}
                        className="remote-btn remote-btn--primary"
                        style={REMOTE_NO_DRAG_STYLE}
                        onClick={() => sendRemoteCommand({ type: 'stop-export' })}
                    >
                        <Square size={9} fill="currentColor" />
                        {t('remote.stopAndSave')}
                    </button>}
                    <button
                        type="button"
                        className="remote-btn"
                        style={REMOTE_NO_DRAG_STYLE}
                        onClick={() => sendRemoteCommand({ type: 'cancel-export' })}
                    >
                        {t('remote.cancel')}
                    </button>
                </div>
            </>
        );
    }

    return (
        <>
            <div className="remote-rows">
                <div className="remote-row">
                    <span className="remote-row__label">{t('remote.rowRange')}</span>
                    <RemoteSeg
                        label={t('remote.rowRange')}
                        value={choices.startMode}
                        options={[
                            { value: 'from-start', label: t('remote.exportFullSong') },
                            { value: 'current', label: t('remote.exportFromHere') },
                        ]}
                        onChange={choices.setStartMode}
                    />
                    {status === 'done' && <span className="remote-row__note">{t('remote.saved')}</span>}
                    <span className="remote-row__space" />
                    <button
                        type="button"
                        disabled={startDisabled}
                        className="remote-btn remote-btn--primary"
                        style={REMOTE_NO_DRAG_STYLE}
                        onClick={() => sendRemoteCommand({
                            type: 'start-export',
                            preset: choices.selectedPreset,
                            startMode: choices.startMode,
                            ...(transparent ? { alphaFormat } : {}),
                        })}
                    >
                        {t(transparent ? 'remote.startRendering' : 'remote.startRecording')}
                    </button>
                </div>
                <div className="remote-row">
                    <span className="remote-row__label">{t('remote.rowSize')}</span>
                    <RemoteSizeSeg choices={choices} onCustom={onOpenSize} />
                </div>
                <div className="remote-row">
                    <span className="remote-row__label">{t('remote.rowBackground')}</span>
                    <RemoteSeg<RemoteExportBackground>
                        label={t('remote.rowBackground')}
                        value={transparent ? 'transparent' : 'opaque'}
                        options={[
                            { value: 'opaque', label: t('remote.exportOpaque') },
                            { value: 'transparent', label: t('remote.exportTransparent'), disabled: !canExportAlpha },
                        ]}
                        onChange={choices.setBackground}
                    />
                    {transparent && (
                        <RemoteSeg
                            quiet
                            label={t('remote.rowFormat')}
                            value={alphaFormat}
                            options={alphaFormats.map(id => ({ value: id, label: t(ALPHA_FORMAT_LABEL_KEYS[id]) }))}
                            onChange={choices.setAlphaFormat}
                        />
                    )}
                    {status === 'error' ? (
                        <span className="remote-row__note remote-row__note--error" role="alert" title={exportState.error ?? undefined}>
                            {exportState.error ? `${t('remote.error')}　${exportState.error}` : t('remote.error')}
                        </span>
                    ) : !transparent && (
                        <span
                            className="remote-row__note"
                            title={ffmpeg && !canExportAlpha ? t('remote.alphaNeedsFfmpegHint') : undefined}
                        >
                            {ffmpeg && !canExportAlpha ? t('remote.alphaNeedsFfmpeg') : t('remote.opaqueNote')}
                        </span>
                    )}
                </div>
            </div>
        </>
    );
};

export default RemoteExportTab;
