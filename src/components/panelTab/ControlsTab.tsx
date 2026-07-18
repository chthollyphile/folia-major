import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Repeat, Repeat1, RepeatOff, Heart, Sparkles, Sparkle, ArrowUpDown, Check, Copy, RefreshCw, Cone, Layers, Sun, Moon, Settings, Volume2, Volume1, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type LatentBackgroundDisplayMode, Theme, ThemeMode, type VisualizerBackgroundMode, VisualizerMode } from '../../types';
import type { ThemeSourceModel } from '../../hooks/themeControllerState';
import { getVisualizerModeLabel, VISUALIZER_REGISTRY } from '../visualizer/registry';
import { getVisualizerBackgroundModeLabel, VISUALIZER_BACKGROUND_REGISTRY } from '../visualizer/backgrounds/registry';
import { useThemeQuickEditorStore } from '../../stores/useThemeQuickEditorStore';
import { resolveVisualizerBackgroundMode, useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { syncNow } from '../../services/sync/syncCoordinator';
import { isSyncConfigured } from '../../services/sync/syncConfig';
import QuickEffectPicker from './QuickEffectPicker';

// Controls tab composes compact visualizer and background pickers without changing player state flow.

interface ControlsTabProps {
    loopMode: 'off' | 'all' | 'one';
    onToggleLoop: () => void;
    onLike: () => void;
    isLiked: boolean;
    onGenerateAITheme: () => void;
    isGeneratingTheme: boolean;
    canGenerateAITheme: boolean;
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    bgMode: ThemeMode;
    onBgModeChange: (mode: ThemeMode) => void;
    hasCustomTheme: boolean;
    themeSourceModel: ThemeSourceModel;
    defaultTheme: Theme;
    daylightTheme: Theme;
    visualizerMode: VisualizerMode;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    useCoverColorBg: boolean;
    onToggleCoverColorBg: (enable: boolean) => void;
    isDaylight: boolean;
    onToggleDaylight: () => void;
    volume: number;
    isMuted: boolean;
    onVolumePreview: (val: number) => void;
    onVolumeChange: (val: number) => void;
    onToggleMute: () => void;
    loopToggleDisabled?: boolean;
    onClosePanel?: () => void;
}

const ControlsTab: React.FC<ControlsTabProps> = ({
    loopMode,
    onToggleLoop,
    onLike,
    isLiked,
    onGenerateAITheme,
    isGeneratingTheme,
    canGenerateAITheme,
    theme,
    onThemeChange,
    bgMode,
    onBgModeChange,
    hasCustomTheme,
    themeSourceModel,
    defaultTheme,
    daylightTheme,
    visualizerMode,
    onVisualizerModeChange,
    useCoverColorBg,
    onToggleCoverColorBg,
    isDaylight,
    onToggleDaylight,
    volume,
    isMuted,
    onVolumePreview,
    onVolumeChange,
    onToggleMute,
    loopToggleDisabled = false,
    onClosePanel,
}) => {
    const { t } = useTranslation();
    const openThemeQuickEditor = useThemeQuickEditorStore(state => state.openEditor);
    const openSettings = useSettingsUiStore(state => state.openSettings);
    const statusSetter = useSettingsUiStore(state => state.statusSetter);
    const visualizerBackgroundMode = useSettingsUiStore(state => state.visualizerBackgroundMode);
    const monetBackgroundTuning = useSettingsUiStore(state => state.monetBackgroundTuning);
    const setMonetBackgroundTuning = useSettingsUiStore(state => state.handleSetMonetBackgroundTuning);
    const nomandBackgroundTuning = useSettingsUiStore(state => state.nomandBackgroundTuning);
    const setNomandBackgroundTuning = useSettingsUiStore(state => state.handleSetNomandBackgroundTuning);
    const latentBackgroundTuning = useSettingsUiStore(state => state.latentBackgroundTuning);
    const setLatentBackgroundTuning = useSettingsUiStore(state => state.handleSetLatentBackgroundTuning);
    const [sliderVolume, setSliderVolume] = useState(isMuted ? 0 : volume);
    const [themeSyncState, setThemeSyncState] = useState<'idle' | 'syncing' | 'complete'>('idle');
    const isDraggingRef = useRef(false);
    const themeSyncCompleteTimerRef = useRef<number | null>(null);
    const pendingVolumeRef = useRef(sliderVolume);
    const setVisualizerBackgroundMode = useSettingsUiStore(state => state.handleSetVisualizerBackgroundMode);

    useEffect(() => () => {
        if (themeSyncCompleteTimerRef.current !== null) {
            window.clearTimeout(themeSyncCompleteTimerRef.current);
        }
    }, []);

    const handleThemeSync = async () => {
        if (themeSyncState === 'syncing') return;

        if (!isSyncConfigured()) {
            statusSetter?.({
                type: 'info',
                text: t('commandPalette.syncNotConfigured'),
            });
            return;
        }

        if (themeSyncCompleteTimerRef.current !== null) {
            window.clearTimeout(themeSyncCompleteTimerRef.current);
        }
        setThemeSyncState('syncing');
        const result = await syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false });
        if (!result) {
            setThemeSyncState('idle');
            return;
        }

        setThemeSyncState('complete');
        themeSyncCompleteTimerRef.current = window.setTimeout(() => {
            setThemeSyncState('idle');
            themeSyncCompleteTimerRef.current = null;
        }, 1600);
    };

    useEffect(() => {
        if (!isDraggingRef.current) {
            const nextVolume = isMuted ? 0 : volume;
            setSliderVolume(nextVolume);
            pendingVolumeRef.current = nextVolume;
        }
    }, [volume, isMuted]);

    const loopButtonBg = isDaylight ? 'bg-black/5 hover:bg-zinc-300/85' : 'bg-white/5 hover:bg-white/10';
    const buttonBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10';
    const wellBg = isDaylight ? 'bg-black/5' : 'bg-black/20';
    const activeOptionBg = isDaylight ? 'bg-white shadow-sm hover:bg-white/90' : 'bg-white/20 shadow-sm hover:bg-white/30';

    const handleSliderInput = (nextVolume: number) => {
        isDraggingRef.current = true;
        pendingVolumeRef.current = nextVolume;
        setSliderVolume(nextVolume);
        onVolumePreview(nextVolume);
    };

    const commitVolumeChange = () => {
        if (!isDraggingRef.current) {
            return;
        }
        isDraggingRef.current = false;
        onVolumeChange(pendingVolumeRef.current);
    };

    const toggleAnimationIntensity = () => {
        const modes: ('calm' | 'normal' | 'chaotic')[] = ['calm', 'normal', 'chaotic'];
        const currentIndex = modes.indexOf(theme.animationIntensity);
        const nextIndex = (currentIndex + 1) % modes.length;
        onThemeChange({ ...theme, animationIntensity: modes[nextIndex] });
    };

    const formatThemeDisplayName = (name: string) => {
        if (themeSourceModel.activeSource !== 'default') {
            return name;
        }

        return name === defaultTheme.name
            ? t('theme.midnightDefault')
            : (name === daylightTheme.name ? t('theme.daylightDefault') : name);
    };
    const activeThemeSource = themeSourceModel.current;
    const aiThemeSource = themeSourceModel.options.ai;
    const customThemeSource = themeSourceModel.options.custom;
    const currentEditableSource = themeSourceModel.editableSource;
    const themeDisplayName = formatThemeDisplayName(activeThemeSource.label || theme.name);
    const aiSwatchColor = aiThemeSource.theme?.backgroundColor ?? 'rgba(114,119,134,0.4)';
    const customSwatchColor = customThemeSource.theme?.accentColor ?? 'rgba(114,119,134,0.4)';
    const resolvedVisualizerBackgroundMode = resolveVisualizerBackgroundMode(visualizerBackgroundMode, visualizerMode);
    const visualizerOptions = VISUALIZER_REGISTRY.map(entry => ({
        value: entry.mode,
        label: getVisualizerModeLabel(entry.mode, t),
    }));
    const backgroundOptions = VISUALIZER_BACKGROUND_REGISTRY.map(entry => ({
        value: entry.mode,
        label: getVisualizerBackgroundModeLabel(entry.mode, t),
    }));
    const isMonetFullOverlay = monetBackgroundTuning.backgroundLayout === 'full-overlay';
    const monetLayoutLabel = t(isMonetFullOverlay ? 'options.monetLayoutFullOverlay' : 'options.monetLayoutHalfPane');
    const latentDisplayModes: LatentBackgroundDisplayMode[] = ['dithering', 'mesh', 'both'];
    const latentDisplayLabel = t(`options.latentDisplay${latentBackgroundTuning.displayMode === 'dithering' ? 'Dithering' : latentBackgroundTuning.displayMode === 'mesh' ? 'Mesh' : 'Both'}`);
    const cycleLatentDisplayMode = () => {
        const currentIndex = latentDisplayModes.indexOf(latentBackgroundTuning.displayMode);
        setLatentBackgroundTuning({
            displayMode: latentDisplayModes[(currentIndex + 1) % latentDisplayModes.length],
        });
    };
    const openCurrentThemeQuickEditor = () => {
        if (currentEditableSource) {
            openThemeQuickEditor(currentEditableSource);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative"
        >
            <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                    <button
                        onClick={onToggleLoop}
                        disabled={loopToggleDisabled}
                        className={`h-12 rounded-xl flex items-center justify-center transition-colors ${loopButtonBg} ${loopToggleDisabled ? 'opacity-35 cursor-not-allowed' : ''}`}
                    >
                        {loopMode === 'off' ? <RepeatOff size={20} /> : loopMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
                    </button>

                    <button
                        onClick={onLike}
                        className={`h-12 rounded-xl flex items-center justify-center transition-colors ${isLiked ? 'bg-red-500/20 text-red-500' : buttonBg}`}
                    >
                        <Heart size={20} fill={isLiked ? 'currentColor' : 'none'} />
                    </button>

                    <button
                        onClick={onGenerateAITheme}
                        disabled={isGeneratingTheme || !canGenerateAITheme}
                        className={`h-12 rounded-xl flex items-center justify-center transition-colors ${
                            isGeneratingTheme
                                ? 'bg-blue-500/20 text-blue-300'
                                : buttonBg
                        }`}
                    >
                        {themeSourceModel.hasLocalAiTheme && !isGeneratingTheme ? (
                            <Sparkles size={20} />
                        ) : (
                            <Sparkle size={20} className={isGeneratingTheme ? 'animate-pulse' : ''} />
                        )}
                    </button>
                </div>

                <div className="pt-2 border-t border-white/5 space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest">
                                {t('ui.volume') || 'Volume'}
                            </label>
                            <span className="text-[10px] font-bold opacity-60">
                                {Math.round(sliderVolume * 100)}%
                            </span>
                        </div>
                        <div className={`flex items-center gap-3 ${wellBg} p-2 rounded-xl`}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleMute();
                                }}
                                className="opacity-40 hover:opacity-100 transition-opacity"
                            >
                                {isMuted || sliderVolume === 0 ? <VolumeX size={16} /> : sliderVolume < 0.5 ? <Volume1 size={16} /> : <Volume2 size={16} />}
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={sliderVolume}
                                onInput={(e) => handleSliderInput(parseFloat(e.currentTarget.value))}
                                onChange={(e) => handleSliderInput(parseFloat(e.currentTarget.value))}
                                onMouseUp={commitVolumeChange}
                                onTouchEnd={commitVolumeChange}
                                onKeyUp={commitVolumeChange}
                                onBlur={commitVolumeChange}
                                className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-(--text-primary)"
                                style={{ accentColor: theme.primaryColor }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-0.5">
                            <button
                                type="button"
                                onClick={() => {
                                    openSettings('options', 'visualizer', 'common');
                                    onClosePanel?.();
                                }}
                                className="text-[10px] font-bold opacity-40 hover:opacity-100 transition-opacity uppercase tracking-widest text-left"
                                title={t('ui.openVisualizerSettings') || 'Open Visualizer Settings'}
                            >
                                {t('ui.animationMode')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    openSettings('options', 'visualizer', 'visualizer');
                                    onClosePanel?.();
                                }}
                                className="rounded-md p-1 opacity-40 transition-opacity hover:opacity-100"
                                title={t('options.openLyricsStyleSettings')}
                                aria-label={t('options.openLyricsStyleSettings')}
                            >
                                <Settings size={13} />
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <QuickEffectPicker
                                value={visualizerMode}
                                options={visualizerOptions}
                                onChange={onVisualizerModeChange}
                                isDaylight={isDaylight}
                                primaryColor={theme.primaryColor}
                                ariaLabel={t('ui.animationMode')}
                            />

                            <button
                                onClick={toggleAnimationIntensity}
                                className={`px-3 py-1 text-[10px] font-bold capitalize rounded-lg transition-all ${activeOptionBg}`}
                            >
                                {t(`animation.${theme.animationIntensity}`)}
                            </button>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-0.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        openSettings('options', 'visualizer', 'background');
                                        onClosePanel?.();
                                    }}
                                    className="text-[10px] font-bold opacity-40 uppercase tracking-widest transition-opacity hover:opacity-100"
                                    title={t('options.previewBackgroundSettings')}
                                >
                                    {t('ui.background')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        openSettings('options', 'visualizer', 'background');
                                        onClosePanel?.();
                                    }}
                                    className="rounded-md p-1 opacity-40 transition-opacity hover:opacity-100"
                                    title={t('options.previewBackgroundSettings')}
                                    aria-label={t('options.previewBackgroundSettings')}
                                >
                                    <Settings size={13} />
                                </button>
                            </div>
                            <div className="flex items-center gap-1">
                                <QuickEffectPicker<VisualizerBackgroundMode>
                                    value={resolvedVisualizerBackgroundMode}
                                    options={backgroundOptions}
                                    onChange={setVisualizerBackgroundMode}
                                    isDaylight={isDaylight}
                                    primaryColor={theme.primaryColor}
                                    ariaLabel={t('options.visualizerBackgroundMode')}
                                />
                                {resolvedVisualizerBackgroundMode === 'common' && (
                                    <button
                                        onClick={() => onToggleCoverColorBg(!useCoverColorBg)}
                                        className={`p-1 rounded-md transition-all ${useCoverColorBg ? 'text-blue-400' : 'opacity-40 hover:opacity-100'}`}
                                        title={useCoverColorBg ? t('theme.addCoverColor') : t('theme.useDefaultColor')}
                                    >
                                        <Cone size={14} />
                                    </button>
                                )}
                                {resolvedVisualizerBackgroundMode === 'monet' && (
                                    <button
                                        type="button"
                                        onClick={() => setMonetBackgroundTuning({ backgroundLayout: isMonetFullOverlay ? 'half-pane-gradient' : 'full-overlay' })}
                                        className={`rounded-md px-1.5 py-1 text-[10px] font-bold transition-all ${activeOptionBg}`}
                                        title={`${t('options.monetBackgroundLayout')}: ${monetLayoutLabel}`}
                                        aria-label={`${t('options.monetBackgroundLayout')}: ${monetLayoutLabel}`}
                                        aria-pressed={isMonetFullOverlay}
                                    >
                                        {monetLayoutLabel}
                                    </button>
                                )}
                                {resolvedVisualizerBackgroundMode === 'nomand' && (
                                    <button
                                        type="button"
                                        onClick={() => setNomandBackgroundTuning({
                                            overlayEnabled: !nomandBackgroundTuning.overlayEnabled,
                                        })}
                                        className={`p-1 rounded-md transition-all ${nomandBackgroundTuning.overlayEnabled ? 'text-blue-400' : 'opacity-40 hover:opacity-100'}`}
                                        title={t('options.nomandBackgroundOverlay')}
                                        aria-label={t('options.nomandBackgroundOverlay')}
                                        aria-pressed={nomandBackgroundTuning.overlayEnabled}
                                    >
                                        <Layers size={14} />
                                    </button>
                                )}
                                {resolvedVisualizerBackgroundMode === 'latent' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={cycleLatentDisplayMode}
                                            className={`rounded-md px-1.5 py-1 text-[10px] font-bold transition-all ${activeOptionBg}`}
                                            title={`${t('options.latentDisplayMode')}: ${latentDisplayLabel}`}
                                            aria-label={`${t('options.latentDisplayMode')}: ${latentDisplayLabel}`}
                                        >
                                            {latentDisplayLabel}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setLatentBackgroundTuning({
                                                overlayEnabled: !latentBackgroundTuning.overlayEnabled,
                                            })}
                                            className={`p-1 rounded-md transition-all ${latentBackgroundTuning.overlayEnabled ? 'text-blue-400' : 'opacity-40 hover:opacity-100'}`}
                                            title={t('options.nomandBackgroundOverlay')}
                                            aria-label={t('options.nomandBackgroundOverlay')}
                                            aria-pressed={latentBackgroundTuning.overlayEnabled}
                                        >
                                            <Layers size={14} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className={`flex ${wellBg} p-1 rounded-xl`}>
                            <button
                                onClick={() => onBgModeChange('default')}
                                className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all ${themeSourceModel.activeSource === 'default' ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                            >
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor }}></div>
                                {t('ui.default')}
                            </button>
                            <button
                                onClick={() => aiThemeSource.available && onBgModeChange('ai')}
                                disabled={!aiThemeSource.available}
                                className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all ${themeSourceModel.activeSource === 'ai' ? activeOptionBg : aiThemeSource.available ? 'opacity-40 hover:opacity-100' : 'opacity-25 cursor-not-allowed'}`}
                            >
                                <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: aiSwatchColor }}></div>
                                {t('ui.aiTheme')}
                            </button>
                            {hasCustomTheme && (
                                <button
                                    onClick={() => onBgModeChange('custom')}
                                    className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all ${themeSourceModel.activeSource === 'custom' ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                                >
                                    <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: customSwatchColor }}></div>
                                    {t('options.customTheme') || 'Custom'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onToggleDaylight}
                            className={`rounded-md p-1 transition-all ${isDaylight ? 'text-amber-500' : 'text-blue-300'}`}
                            title={isDaylight ? t('theme.switchToDark') : t('theme.switchToLight')}
                            aria-label={isDaylight ? t('theme.switchToDark') : t('theme.switchToLight')}
                        >
                            {isDaylight ? <Sun size={14} /> : <Moon size={14} />}
                        </button>
                        {currentEditableSource ? (
                            <button
                                type="button"
                                onClick={openCurrentThemeQuickEditor}
                                className={`max-w-[120px] truncate rounded-md px-1.5 py-1 text-left text-xs font-bold transition-colors ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                                title={currentEditableSource === 'custom'
                                    ? (t('options.customThemeQuickEditTitle') || 'Edit Custom Theme')
                                    : (t('options.aiThemeQuickEditTitle') || 'Edit AI Theme')}
                            >
                                {themeDisplayName}
                            </button>
                        ) : (
                            <span className="text-xs font-bold truncate max-w-[120px]">
                                {themeDisplayName}
                            </span>
                        )}
                        {themeSourceModel.activeSource !== 'default' && (
                            <button
                                onClick={() => void handleThemeSync()}
                                disabled={themeSyncState === 'syncing'}
                                className={`p-1 rounded-full ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'} transition-colors disabled:cursor-wait`}
                                title={themeSyncState === 'syncing'
                                    ? t('options.syncing')
                                    : themeSyncState === 'complete'
                                        ? t('ui.synced')
                                        : t('commandPalette.commands.sync-now.title')}
                            >
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.span
                                        key={themeSyncState}
                                        initial={{ opacity: 0, scale: 0.55, rotate: -35 }}
                                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                        exit={{ opacity: 0, scale: 0.55, rotate: 35 }}
                                        transition={{ duration: 0.16, ease: 'easeOut' }}
                                        className="block"
                                    >
                                        {themeSyncState === 'syncing' ? (
                                            <RefreshCw size={12} className="animate-spin" />
                                        ) : themeSyncState === 'complete' ? (
                                            <Check size={12} className="text-green-500" strokeWidth={3} />
                                        ) : (
                                            <ArrowUpDown size={12} />
                                        )}
                                    </motion.span>
                                </AnimatePresence>
                            </button>
                        )}
                    </div>
                </div>

            </div>

        </motion.div>
    );
};

export default ControlsTab;
