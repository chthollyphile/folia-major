import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { FolderOpen, KeyRound, X } from 'lucide-react';
import type { Theme } from '../../../types';
import {
    ensureVideoLayerFileRestored,
    useVideoLayerSettingsStore,
    VIDEO_LAYER_OPACITY_BOUNDS,
    type VideoLayerFit,
} from '../../../stores/useVideoLayerSettingsStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';

// src/components/modal/settings/VideoLayerSettingsSection.tsx
// Settings for the built-in video layer behind the lyrics. Reads the store directly, the way
// GridViewSettingsSection does. Deliberately outside the appearance import/export payload and the
// OBS sources (see useVideoLayerSettingsStore).

type VideoLayerSettingsSectionProps = {
    settingsCardClass: string;
    toggleOffBackgroundClass: string;
    getAccentOptionStyle: (active: boolean) => React.CSSProperties;
    theme?: Theme;
};

const FIT_OPTIONS: Array<[VideoLayerFit, string]> = [
    ['cover', 'options.videoLayerFitCover'],
    ['contain', 'options.videoLayerFitContain'],
];

const VideoLayerSettingsSection: React.FC<VideoLayerSettingsSectionProps> = ({
    settingsCardClass,
    toggleOffBackgroundClass,
    getAccentOptionStyle,
    theme,
}) => {
    const { t } = useTranslation();
    const settings = useVideoLayerSettingsStore(useShallow(state => ({
        enabled: state.videoLayerEnabled,
        url: state.videoLayerUrl,
        opacity: state.videoLayerOpacity,
        fit: state.videoLayerFit,
        localFileName: state.localFileName,
        localFileStatus: state.localFileStatus,
        canPersistLocalFile: state.canPersistLocalFile,
    })));
    const actions = useVideoLayerSettingsStore(useShallow(state => ({
        setEnabled: state.setVideoLayerEnabled,
        setUrl: state.setVideoLayerUrl,
        setOpacity: state.setVideoLayerOpacity,
        setFit: state.setVideoLayerFit,
        pickLocalFile: state.pickLocalFile,
        clearLocalFile: state.clearLocalFile,
        regrantLocalFile: state.regrantLocalFile,
    })));
    // The URL commits on blur/Enter, so a half-typed address never reaches the <video>.
    const [urlDraft, setUrlDraft] = useState(settings.url);

    useEffect(() => {
        ensureVideoLayerFileRestored();
    }, []);

    useEffect(() => {
        setUrlDraft(settings.url);
    }, [settings.url]);

    const handlePick = async () => {
        try {
            await actions.pickLocalFile();
        } catch (error) {
            console.error('[VideoLayer] Failed to pick a video:', error);
            setStatusMessage({ type: 'error', text: t('options.videoLayerPickFailed') });
        }
    };

    const hasLocalFile = settings.localFileStatus !== 'none';

    return (
        <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.videoLayerEnabled')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[400px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.videoLayerDesc')}
                    </div>
                </div>
                <button
                    onClick={() => actions.setEnabled(!settings.enabled)}
                    className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!settings.enabled ? toggleOffBackgroundClass : ''}`}
                    style={{ backgroundColor: settings.enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    aria-pressed={settings.enabled}
                    aria-label={t('options.videoLayerEnabled')}
                >
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>

            <div className="border-t border-black/5 pt-4 space-y-2 dark:border-white/5">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.videoLayerLocalFile')}
                </div>
                <div className="text-xs opacity-50 max-w-[400px]" style={{ color: 'var(--text-secondary)' }}>
                    {t(settings.canPersistLocalFile ? 'options.videoLayerLocalFileDesc' : 'options.videoLayerLocalFileSessionDesc')}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                        type="button"
                        onClick={() => void handlePick()}
                        className="px-3 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                        style={getAccentOptionStyle(false)}
                    >
                        <FolderOpen size={12} className="opacity-70" />
                        <span>{t('options.videoLayerPickFile')}</span>
                    </button>
                    {settings.localFileStatus === 'needs-permission' && (
                        <button
                            type="button"
                            onClick={() => void actions.regrantLocalFile()}
                            className="px-3 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                            style={getAccentOptionStyle(true)}
                        >
                            <KeyRound size={12} className="opacity-70" />
                            <span>{t('options.videoLayerRegrant')}</span>
                        </button>
                    )}
                    {hasLocalFile && (
                        <span className="flex min-w-0 items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                            <span className="truncate max-w-[220px]" title={settings.localFileName ?? undefined}>
                                {settings.localFileName}
                            </span>
                            <button
                                type="button"
                                onClick={() => void actions.clearLocalFile()}
                                className="rounded p-0.5 opacity-60 hover:opacity-100"
                                aria-label={t('options.videoLayerClearFile')}
                                title={t('options.videoLayerClearFile')}
                            >
                                <X size={12} />
                            </button>
                        </span>
                    )}
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.videoLayerUrl')}
                </div>
                <div className="text-xs opacity-50 max-w-[400px]" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.videoLayerUrlDesc')}
                </div>
                <input
                    type="url"
                    value={urlDraft}
                    placeholder="https://example.com/loop.mp4"
                    onChange={event => setUrlDraft(event.target.value)}
                    onBlur={() => actions.setUrl(urlDraft)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') actions.setUrl(urlDraft);
                    }}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-white/30 transition-colors font-mono"
                    style={{ color: 'var(--text-primary)' }}
                />
            </div>

            <div className="border-t border-black/5 pt-4 space-y-4 dark:border-white/5">
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.videoLayerOpacity')}
                        </div>
                        <span className="font-mono text-xs shrink-0" style={{ color: 'var(--text-primary)' }}>
                            {Math.round(settings.opacity * 100)}%
                        </span>
                    </div>
                    <input
                        type="range"
                        min={VIDEO_LAYER_OPACITY_BOUNDS.min}
                        max={VIDEO_LAYER_OPACITY_BOUNDS.max}
                        step={0.05}
                        value={settings.opacity}
                        onChange={event => actions.setOpacity(Number(event.currentTarget.value))}
                        className="w-full accent-current"
                        style={{ accentColor: theme?.accentColor }}
                        aria-label={t('options.videoLayerOpacity')}
                    />
                </div>

                <div className="space-y-2">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.videoLayerFit')}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {FIT_OPTIONS.map(([value, labelKey]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => actions.setFit(value)}
                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                                style={getAccentOptionStyle(settings.fit === value)}
                            >
                                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                    {t(labelKey)}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                {t('options.videoLayerNotInExport')}
            </div>
        </div>
    );
};

export default VideoLayerSettingsSection;
