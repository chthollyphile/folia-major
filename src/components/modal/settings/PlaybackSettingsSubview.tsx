import React, { useEffect, useState } from 'react';
import { Monitor, PlayCircle, RefreshCw, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { QueueAddBehavior, Theme } from '../../../types';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { CustomSelect } from '../../shared/CustomSelect';
import { LYRIC_MATCH_SOURCES } from '../../../utils/lyrics/lyricMatchSources';
import { getLyricProviderPreferenceLabel } from '../../../utils/lyrics/lyricSourceLabels';

// src/components/modal/settings/PlaybackSettingsSubview.tsx
// Playback behavior and output-device settings extracted from the global settings modal.

interface AudioOutputDeviceOption {
    deviceId: string;
    label: string;
}

interface MediaDevicesWithAudioOutput extends MediaDevices {
    selectAudioOutput?: (options?: { deviceId?: string; }) => Promise<{ deviceId: string; label?: string; }>;
}

type PlaybackSettingsSubviewProps = {
    isOpen: boolean;
    isDaylight: boolean;
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
    settingsCardClass: string;
    theme?: Theme;
    utilityGhostButtonClass: string;
};

const stopMediaStream = (stream: MediaStream | null) => {
    stream?.getTracks().forEach(track => track.stop());
};

const PlaybackSettingsSubview: React.FC<PlaybackSettingsSubviewProps> = ({
    isOpen,
    isDaylight,
    onAudioOutputDeviceChange,
    settingsCardClass,
    theme,
    utilityGhostButtonClass,
}) => {
    const { t } = useTranslation();
    const {
        audioOutputDeviceId,
        autoUseBestLyric,
        enableAlternativeLyricSources,
        preferredAlternativeLyricSource,
        queueAddBehavior,
        onToggleAlternativeLyricSources,
        onToggleAutoUseBestLyric,
        onPreferredAlternativeLyricSourceChange,
        onQueueAddBehaviorChange,
    } = useSettingsUiStore(useShallow(state => ({
        audioOutputDeviceId: state.audioOutputDeviceId,
        autoUseBestLyric: state.autoUseBestLyric,
        enableAlternativeLyricSources: state.enableAlternativeLyricSources,
        preferredAlternativeLyricSource: state.preferredAlternativeLyricSource,
        queueAddBehavior: state.queueAddBehavior,
        onToggleAlternativeLyricSources: state.handleToggleAlternativeLyricSources,
        onToggleAutoUseBestLyric: state.handleToggleAutoUseBestLyric,
        onPreferredAlternativeLyricSourceChange: state.handleSetPreferredAlternativeLyricSource,
        onQueueAddBehaviorChange: state.handleSetQueueAddBehavior,
    })));
    const [audioOutputDevices, setAudioOutputDevices] = useState<AudioOutputDeviceOption[]>([]);
    const [isAudioOutputDevicesLoading, setIsAudioOutputDevicesLoading] = useState(false);
    const [audioOutputDevicesError, setAudioOutputDevicesError] = useState<string | null>(null);
    const [isSelectingAudioOutput, setIsSelectingAudioOutput] = useState(false);
    const mediaDevicesWithAudioOutput = navigator.mediaDevices as MediaDevicesWithAudioOutput | undefined;
    const supportsAudioOutputSelection = typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && typeof navigator.mediaDevices?.enumerateDevices === 'function'
        && 'setSinkId' in HTMLMediaElement.prototype;
    const accentOutlineColor = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-300/90' : 'bg-white/10';

    const renderToggle = (checked: boolean, onChange: () => void) => (
        <button
            type="button"
            onClick={onChange}
            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${checked ? '' : toggleOffBackgroundClass}`}
            style={{ backgroundColor: checked ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
            aria-pressed={checked}
        >
            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
    );

    const getAccentOptionStyle = (selected: boolean) => (
        selected
            ? {
                borderColor: accentOutlineColor,
                boxShadow: `inset 0 0 0 1px ${accentOutlineColor}`,
                backgroundColor: isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`,
            }
            : {
                borderColor: isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                backgroundColor: isDaylight ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.05)',
            }
    );

    const loadAudioOutputDevices = async () => {
        if (!supportsAudioOutputSelection) {
            setAudioOutputDevices([]);
            setAudioOutputDevicesError(t('options.audioOutputUnsupported'));
            return;
        }

        setIsAudioOutputDevicesLoading(true);
        setAudioOutputDevicesError(null);

        let permissionProbeStream: MediaStream | null = null;

        try {
            let devices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
            const hasMissingLabels = audioOutputs.some(device => !device.label?.trim());

            if (hasMissingLabels && typeof navigator.mediaDevices.getUserMedia === 'function') {
                try {
                    permissionProbeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    devices = await navigator.mediaDevices.enumerateDevices();
                } catch (permissionError) {
                    console.warn('[PlaybackSettingsSubview] Audio permission probe failed', permissionError);
                }
            }

            const outputs = devices
                .filter(device => device.kind === 'audiooutput')
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    label: device.label || `${t('options.audioOutputUnnamed')} ${index + 1}`,
                }));
            setAudioOutputDevices(outputs);
        } catch (error) {
            console.error('[PlaybackSettingsSubview] Failed to enumerate audio output devices', error);
            setAudioOutputDevicesError(t('options.audioOutputLoadFailed'));
        } finally {
            stopMediaStream(permissionProbeStream);
            setIsAudioOutputDevicesLoading(false);
        }
    };

    const handleSelectAudioOutputDevice = async (deviceId: string) => {
        setAudioOutputDevicesError(null);

        if (!deviceId) {
            await onAudioOutputDeviceChange('');
            return;
        }

        if (!mediaDevicesWithAudioOutput?.selectAudioOutput) {
            await onAudioOutputDeviceChange(deviceId);
            return;
        }

        setIsSelectingAudioOutput(true);
        try {
            const selected = await mediaDevicesWithAudioOutput.selectAudioOutput({ deviceId });
            const applied = await onAudioOutputDeviceChange(selected.deviceId);
            if (applied) {
                await loadAudioOutputDevices();
            } else {
                setAudioOutputDevicesError(t('options.audioOutputSelectFailed'));
            }
        } catch (error) {
            console.error('[PlaybackSettingsSubview] Failed to select audio output device', error);
            setAudioOutputDevicesError(t('options.audioOutputSelectFailed'));
        } finally {
            setIsSelectingAudioOutput(false);
        }
    };

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        void loadAudioOutputDevices();
    }, [isOpen]);

    return (
        <div className="space-y-5">
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <PlayCircle size={14} />                    {t('options.queueSettings')}

                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.queueDefaultBehavior')}
                        </div>
                        <div className="text-[11px] opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.queueDefaultBehaviorDesc')}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {([
                            { value: 'append', label: t('options.queueAppendLabel'), desc: t('options.queueAppendDesc') },
                            { value: 'next', label: t('options.queueNextLabel'), desc: t('options.queueNextDesc') },
                        ] as Array<{ value: QueueAddBehavior; label: string; desc: string }>).map((option) => {
                            const selected = queueAddBehavior === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => onQueueAddBehaviorChange(option.value)}
                                    className="rounded-xl border px-3 py-3 text-left transition-colors"
                                    style={getAccentOptionStyle(selected)}
                                >
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {option.label}
                                    </div>
                                    <div className="mt-1 text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {option.desc}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Settings2 size={14} /> {t('options.lyrics')}
                </h3>
                <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <Settings2 size={14} />
                                {t('options.enableAlternativeLyricSources')}
                            </div>
                            <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.enableAlternativeLyricSourcesDesc')}
                            </div>
                        </div>
                        {renderToggle(enableAlternativeLyricSources, () => onToggleAlternativeLyricSources(!enableAlternativeLyricSources))}
                    </div>
                    {enableAlternativeLyricSources && (
                        <div className="p-4 flex items-center justify-between gap-4 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <Settings2 size={14} />
                                    {t('options.autoUseBestLyric')}
                                </div>
                                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.autoUseBestLyricDesc')}
                                </div>
                            </div>
                            {renderToggle(autoUseBestLyric, () => onToggleAutoUseBestLyric(!autoUseBestLyric))}
                        </div>
                    )}
                    {enableAlternativeLyricSources && (
                        <div className="p-4 space-y-3 border-t" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('settings.lyricMatchPriority')}
                                </div>
                                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('settings.lyricMatchPriorityDesc')}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                                {LYRIC_MATCH_SOURCES.map((source) => {
                                    const option = { value: source, label: getLyricProviderPreferenceLabel(source) };
                                    const selected = preferredAlternativeLyricSource === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => onPreferredAlternativeLyricSourceChange(option.value)}
                                            className="rounded-xl border px-3 py-2 text-center transition-colors"
                                            style={getAccentOptionStyle(selected)}
                                        >
                                            <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {option.label}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </section>

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Monitor size={14} /> {t('options.audioOutputSettings')}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.audioOutputDevice')}
                            </div>
                            <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.audioOutputDeviceDesc')}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => void loadAudioOutputDevices()}
                            disabled={!supportsAudioOutputSelection || isAudioOutputDevicesLoading || isSelectingAudioOutput}
                            className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors ${utilityGhostButtonClass} disabled:cursor-not-allowed disabled:opacity-45`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <RefreshCw size={13} className={isAudioOutputDevicesLoading ? 'animate-spin' : ''} />
                            <span>{t('options.audioOutputRefresh')}</span>
                        </button>
                    </div>

                    {!supportsAudioOutputSelection ? (
                        <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.audioOutputUnsupported')}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <CustomSelect
                                value={audioOutputDeviceId}
                                onChange={(val) => {
                                    void handleSelectAudioOutputDevice(val);
                                }}
                                options={[
                                    { value: '', label: t('options.audioOutputDefault') },
                                    ...audioOutputDevices.map((device, index) => ({
                                        value: device.deviceId,
                                        label: device.label || `${t('options.audioOutputUnnamed')} ${index + 1}`,
                                    })),
                                ]}
                                disabled={isAudioOutputDevicesLoading || isSelectingAudioOutput}
                                isDaylight={isDaylight}
                                theme={theme}
                            />

                            <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {isSelectingAudioOutput
                                    ? (t('options.audioOutputSelecting'))
                                    : isAudioOutputDevicesLoading
                                        ? (t('options.audioOutputLoading'))
                                        : (t('options.audioOutputDefaultDesc'))}
                            </div>

                            {audioOutputDevicesError && (
                                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {audioOutputDevicesError}
                                </div>
                            )}

                            {!isAudioOutputDevicesLoading && audioOutputDevices.length === 0 && !audioOutputDevicesError && (
                                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.audioOutputEmpty')}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
};

export default PlaybackSettingsSubview;
