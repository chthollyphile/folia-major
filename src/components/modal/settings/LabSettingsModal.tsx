import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Boxes, Check, ChevronLeft, ChevronRight, ChevronsLeftRight, Cpu, GamepadDirectional, Mic, Monitor, Moon, PlayCircle, RotateCcw, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme, VisualizerFrameRate } from '../../../types';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { VISUALIZER_FRAME_RATE_OPTIONS } from '../../../utils/frameRateLimiter';
import ThemedDialog from '../../shared/ThemedDialog';

// src/components/modal/settings/LabSettingsModal.tsx
// Experimental settings subview kept outside SettingsModal to avoid another giant inline panel.

type LabSettingsModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onOpenLyricFilterSettings: () => void;
    theme?: Theme;
    voiceInputPause?: {
        enabled: boolean;
        supported: boolean;
        onToggle: () => void;
    };
    embedded?: boolean;
};

const shellTransition = { duration: 0.24, ease: 'easeOut' as const };
const panelMotion = {
    initial: { opacity: 0, scale: 0.98, y: 18 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: 18 },
};

const getFrameRateLabel = (frameRate: VisualizerFrameRate) => `${frameRate} FPS`;

const LabSettingsModal: React.FC<LabSettingsModalProps> = ({
    isOpen,
    onClose,
    onOpenLyricFilterSettings,
    theme,
    voiceInputPause,
    embedded,
}) => {
    const { t } = useTranslation();
    const isMouseDownOnOverlayRef = useRef(false);
    const [isNativeBlurNoticeOpen, setIsNativeBlurNoticeOpen] = useState(false);
    const {
        disableHomeDynamicBackground,
        hidePlayerProgressBar,
        hidePlayerRightPanelButton,
        alwaysShowPlayerBackButton,
        alwaysShowTrackSwitchButtons,
        alwaysShowMainWindowTitlebar,
        hidePlayerTranslationSubtitle,
        isDaylight,
        showOpenPanelCloseButton,
        staticMode,
        visualizerFrameRate,
        onToggleDisableHomeDynamicBackground,
        onToggleHidePlayerProgressBar,
        onToggleHidePlayerRightPanelButton,
        onToggleAlwaysShowPlayerBackButton,
        onToggleAlwaysShowTrackSwitchButtons,
        onToggleAlwaysShowMainWindowTitlebar,
        onToggleHidePlayerTranslationSubtitle,
        onToggleHideTaskbarIcon,
        onToggleMinimizeToTray,
        onToggleOpenPanelCloseButton,
        onToggleOpenPlayerOnLaunch,
        onToggleStaticMode,
        onVisualizerFrameRateChange,
        enablePlayerPageNativeBlur,
        onTogglePlayerPageNativeBlur,
        preventDisplaySleepDuringPlayback,
        onTogglePreventDisplaySleepDuringPlayback,
        modSystemEnabled,
        onToggleModSystem,
    } = useSettingsUiStore(useShallow(state => ({
        disableHomeDynamicBackground: state.disableHomeDynamicBackground,
        hidePlayerProgressBar: state.hidePlayerProgressBar,
        hidePlayerRightPanelButton: state.hidePlayerRightPanelButton,
        alwaysShowPlayerBackButton: state.alwaysShowPlayerBackButton,
        alwaysShowTrackSwitchButtons: state.alwaysShowTrackSwitchButtons,
        alwaysShowMainWindowTitlebar: state.alwaysShowMainWindowTitlebar,
        hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
        isDaylight: state.isDaylight,
        showOpenPanelCloseButton: state.showOpenPanelCloseButton,
        staticMode: state.staticMode,
        visualizerFrameRate: state.visualizerFrameRate,
        enablePlayerPageNativeBlur: state.enablePlayerPageNativeBlur,
        onToggleDisableHomeDynamicBackground: state.handleToggleDisableHomeDynamicBackground,
        onToggleHidePlayerProgressBar: state.handleToggleHidePlayerProgressBar,
        onToggleHidePlayerRightPanelButton: state.handleToggleHidePlayerRightPanelButton,
        onToggleAlwaysShowPlayerBackButton: state.handleToggleAlwaysShowPlayerBackButton,
        onToggleAlwaysShowTrackSwitchButtons: state.handleToggleAlwaysShowTrackSwitchButtons,
        onToggleAlwaysShowMainWindowTitlebar: state.handleToggleAlwaysShowMainWindowTitlebar,
        onToggleHidePlayerTranslationSubtitle: state.handleToggleHidePlayerTranslationSubtitle,
        onToggleHideTaskbarIcon: state.handleToggleHideTaskbarIcon,
        onToggleMinimizeToTray: state.handleToggleMinimizeToTray,
        onToggleOpenPanelCloseButton: state.handleToggleOpenPanelCloseButton,
        onToggleOpenPlayerOnLaunch: state.handleToggleOpenPlayerOnLaunch,
        onToggleStaticMode: state.handleToggleStaticMode,
        onVisualizerFrameRateChange: state.handleSetVisualizerFrameRate,
        onTogglePlayerPageNativeBlur: state.handleTogglePlayerPageNativeBlur,
        preventDisplaySleepDuringPlayback: state.preventDisplaySleepDuringPlayback,
        onTogglePreventDisplaySleepDuringPlayback: state.handleTogglePreventDisplaySleepDuringPlayback,
        modSystemEnabled: state.modSystemEnabled,
        onToggleModSystem: state.handleToggleModSystem,
    })));
    const borderColor = isDaylight ? 'border-zinc-300/70' : 'border-white/10';
    const overlayBackground = isDaylight ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.5)';
    const subviewPanelBg = isDaylight ? 'bg-zinc-200' : 'bg-zinc-900';
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-300/90' : 'bg-white/10';
    const settingsCardClass = isDaylight
        ? 'border-zinc-300/70 bg-white/55'
        : 'border-white/10 bg-white/5';
    const settingsCardInteractiveClass = isDaylight
        ? 'border-zinc-300/70 bg-white/60 hover:bg-white/80'
        : 'border-white/10 bg-white/5 hover:bg-white/10';
    const utilityGhostButtonClass = isDaylight
        ? 'border-zinc-300 bg-white/50 hover:bg-white/80'
        : 'border-white/10 bg-white/5 hover:bg-white/10';
    const rangeInputClass = [
        'w-full accent-current',
        isDaylight ? 'text-zinc-900' : 'text-white',
    ].join(' ');
    const isVisualizerFrameRateLimiterEnabled = visualizerFrameRate !== 'off';
    const selectedVisualizerFrameRate = isVisualizerFrameRateLimiterEnabled ? visualizerFrameRate : 120;
    const selectedVisualizerFrameRateIndex = VISUALIZER_FRAME_RATE_OPTIONS.indexOf(selectedVisualizerFrameRate);
    const isLinux = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('linux');
    const isElectron = typeof window !== 'undefined' && Boolean(window.electron);

    const handleNativeBlurToggle = () => {
        if (enablePlayerPageNativeBlur) {
            onTogglePlayerPageNativeBlur(false);
            return;
        }

        setIsNativeBlurNoticeOpen(true);
    };

    const confirmNativeBlur = () => {
        onTogglePlayerPageNativeBlur(true);
        setIsNativeBlurNoticeOpen(false);
    };

    const renderToggle = (checked: boolean, onChange: () => void) => (
        <button
            type="button"
            onClick={onChange}
            className={`w-12 h-6 rounded-full p-1 transition-colors ${checked ? '' : toggleOffBackgroundClass}`}
            style={{ backgroundColor: checked ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
        >
            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
    );

    const handleToggleVisualizerFrameRateLimiter = () => {
        onVisualizerFrameRateChange(isVisualizerFrameRateLimiterEnabled ? 'off' : selectedVisualizerFrameRate);
    };

    const handleFrameRateSliderChange = (value: string) => {
        const nextIndex = Math.min(VISUALIZER_FRAME_RATE_OPTIONS.length - 1, Math.max(0, Number(value)));
        onVisualizerFrameRateChange(VISUALIZER_FRAME_RATE_OPTIONS[nextIndex]);
    };
    const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        isMouseDownOnOverlayRef.current = event.target === event.currentTarget;
    };

    const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && isMouseDownOnOverlayRef.current) {
            onClose();
        }
    };

    const content = (
        <>
            <div className={embedded ? "space-y-4" : "flex-1 overflow-y-auto custom-scrollbar px-4 py-5 sm:px-6 relative z-10"}>
            <div className={embedded ? "space-y-4" : "space-y-4"}>
                <div className="pt-1">
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {t('options.labPerformanceSection')}
                    </div>
                    <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.labPerformanceSectionDesc')}
                    </div>
                </div>
                <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                            <Monitor size={14} />
                                            {t('options.enableStaticMode')}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.enableStaticModeDesc')}
                                        </div>
                                        <div className="text-[11px] opacity-40 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.enableStaticModeDescSub')}
                                        </div>
                                    </div>
                                    {renderToggle(staticMode, () => onToggleStaticMode(!staticMode))}
                                </div>

                                <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                            <PlayCircle size={14} />
                                            {t('options.disableHomeDynamicBackground')}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.disableHomeDynamicBackgroundDesc')}
                                        </div>
                                        <div className="text-[11px] opacity-40 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.disableHomeDynamicBackgroundWarning')}
                                        </div>
                                    </div>
                                    {renderToggle(disableHomeDynamicBackground, () => onToggleDisableHomeDynamicBackground(!disableHomeDynamicBackground))}
                                </div>

                                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-1">
                                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                                <Cpu size={14} />
                                                {t('options.visualizerFrameRate')}
                                            </div>
                                            <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.visualizerFrameRateDesc')}
                                            </div>
                                        </div>
                                        {renderToggle(isVisualizerFrameRateLimiterEnabled, handleToggleVisualizerFrameRateLimiter)}
                                    </div>
                                    <div className={`space-y-3 transition-opacity ${isVisualizerFrameRateLimiterEnabled ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}>
                                        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                            <span>{t('options.visualizerFrameRateValue')}</span>
                                            <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                                {getFrameRateLabel(selectedVisualizerFrameRate)}
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max={VISUALIZER_FRAME_RATE_OPTIONS.length - 1}
                                            step="1"
                                            value={Math.max(0, selectedVisualizerFrameRateIndex)}
                                            onChange={(event) => handleFrameRateSliderChange(event.target.value)}
                                            className={rangeInputClass}
                                            aria-label={t('options.visualizerFrameRateValue')}
                                            disabled={!isVisualizerFrameRateLimiterEnabled}
                                        />
                                        <div className="grid grid-cols-3 text-[11px] font-mono opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                            {VISUALIZER_FRAME_RATE_OPTIONS.map((frameRate, index) => (
                                                <span
                                                    key={frameRate}
                                                    className={index === 1 ? 'text-center' : index === 2 ? 'text-right' : ''}
                                                >
                                                    {frameRate}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="border-t border-white/10 pt-5">
                                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.labPlayerUiSection')}
                                    </div>
                                    <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.labPlayerUiSectionDesc')}
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                            <Settings2 size={14} />
                                            {t('options.labHidePlayerUi')}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.labHidePlayerUiDesc')}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onToggleHidePlayerProgressBar(!hidePlayerProgressBar)}
                                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${hidePlayerProgressBar ? 'bg-white/12 border-white/20' : utilityGhostButtonClass}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <span className={`flex h-4 w-4 items-center justify-center rounded-sm border ${hidePlayerProgressBar ? 'border-white/30 bg-white/15' : 'border-white/20 bg-transparent'}`}>
                                                {hidePlayerProgressBar ? <Check size={12} /> : null}
                                            </span>
                                            <span>{t('options.hidePlayerProgressBar')}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onToggleHidePlayerTranslationSubtitle(!hidePlayerTranslationSubtitle)}
                                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${hidePlayerTranslationSubtitle ? 'bg-white/12 border-white/20' : utilityGhostButtonClass}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <span className={`flex h-4 w-4 items-center justify-center rounded-sm border ${hidePlayerTranslationSubtitle ? 'border-white/30 bg-white/15' : 'border-white/20 bg-transparent'}`}>
                                                {hidePlayerTranslationSubtitle ? <Check size={12} /> : null}
                                            </span>
                                            <span>{t('options.hidePlayerTranslationSubtitle')}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onToggleHidePlayerRightPanelButton(!hidePlayerRightPanelButton)}
                                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${hidePlayerRightPanelButton ? 'bg-white/12 border-white/20' : utilityGhostButtonClass}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <span className={`flex h-4 w-4 items-center justify-center rounded-sm border ${hidePlayerRightPanelButton ? 'border-white/30 bg-white/15' : 'border-white/20 bg-transparent'}`}>
                                                {hidePlayerRightPanelButton ? <Check size={12} /> : null}
                                            </span>
                                            <span>{t('options.hidePlayerRightPanelButton')}</span>
                                        </button>
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                            <GamepadDirectional size={14} />
                                            {t('options.showOpenPanelCloseButton')}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.showOpenPanelCloseButtonDesc')}
                                        </div>
                                    </div>
                                    {renderToggle(showOpenPanelCloseButton, () => onToggleOpenPanelCloseButton(!showOpenPanelCloseButton))}
                                </div>

                                <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                            <ChevronLeft size={14} />
                                            {t('options.alwaysShowPlayerBackButton')}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.alwaysShowPlayerBackButtonDesc')}
                                        </div>
                                    </div>
                                    {renderToggle(alwaysShowPlayerBackButton, () => onToggleAlwaysShowPlayerBackButton(!alwaysShowPlayerBackButton))}
                                </div>

                                <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                            <ChevronsLeftRight size={14} />
                                            {t('options.alwaysShowTrackSwitchButtons')}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.alwaysShowTrackSwitchButtonsDesc')}
                                        </div>
                                    </div>
                                    {renderToggle(alwaysShowTrackSwitchButtons, () => onToggleAlwaysShowTrackSwitchButtons(!alwaysShowTrackSwitchButtons))}
                                </div>

                                <div className="border-t border-white/10 pt-5">
                                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.labWindowAndToolsSection')}
                                    </div>
                                    <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.labWindowAndToolsSectionDesc')}
                                    </div>
                                </div>

                                <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                            <Monitor size={14} />
                                            {t('options.alwaysShowMainWindowTitlebar')}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.alwaysShowMainWindowTitlebarDesc')}
                                        </div>
                                    </div>
                                    {renderToggle(alwaysShowMainWindowTitlebar, () => onToggleAlwaysShowMainWindowTitlebar(!alwaysShowMainWindowTitlebar))}
                                </div>

                                {isElectron && (
                                    <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                        <div className="space-y-1">
                                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                                <Moon size={14} />
                                                {t('options.preventDisplaySleepDuringPlayback')}
                                            </div>
                                            <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.preventDisplaySleepDuringPlaybackDesc')}
                                            </div>
                                        </div>
                                        {renderToggle(preventDisplaySleepDuringPlayback, () => onTogglePreventDisplaySleepDuringPlayback(!preventDisplaySleepDuringPlayback))}
                                    </div>
                                )}

                                {isElectron && (
                                    <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${settingsCardClass}`}>
                                        <div className="space-y-1">
                                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                                <Boxes size={14} />
                                                {t('options.enableModSystem')}
                                                <span
                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-normal border ${
                                                        isDaylight
                                                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-800'
                                                            : 'border-amber-400/25 bg-amber-400/10 text-amber-200'
                                                    }`}
                                                >
                                                    {t('mods.experimental')}
                                                </span>
                                            </div>
                                            <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.enableModSystemDesc')}
                                            </div>
                                            <div className="text-[11px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.enableModSystemDescSub')}
                                            </div>
                                        </div>
                                        {renderToggle(modSystemEnabled, () => onToggleModSystem(!modSystemEnabled))}
                                    </div>
                                )}

                                {!isLinux && (
                                    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors hover:bg-white/8 ${settingsCardInteractiveClass}`} onClick={handleNativeBlurToggle}>
                                        <div className="flex flex-col pr-8">
                                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {t('options.enablePlayerPageNativeBlur')}
                                            </span>
                                            <span className="text-xs opacity-50 mt-1 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.enablePlayerPageNativeBlurDesc')}
                                            </span>
                                        </div>
                                        {renderToggle(enablePlayerPageNativeBlur, handleNativeBlurToggle)}
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={onOpenLyricFilterSettings}
                                    className={`w-full p-4 rounded-xl border transition-colors hover:bg-white/8 text-left ${settingsCardInteractiveClass}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="space-y-1">
                                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {t('options.lyricFilterRegex')}
                                            </div>
                                            <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.lyricFilterRegexDesc')}
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </div>
                                </button>

                                {voiceInputPause?.supported && (
                                    <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors hover:bg-white/8 ${settingsCardInteractiveClass}`} onClick={voiceInputPause.onToggle}>
                                        <div className="flex flex-col pr-8">
                                            <span className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                                <Mic size={14} />
                                                {t('options.voiceInputPause')}
                                            </span>
                                            <span className="text-xs opacity-50 mt-1 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.voiceInputPauseDesc')}
                                            </span>
                                        </div>
                                        {renderToggle(voiceInputPause.enabled, voiceInputPause.onToggle)}
                                    </div>
                                )}
            </div>
            </div>
            <ThemedDialog
                isOpen={isNativeBlurNoticeOpen}
                onClose={() => setIsNativeBlurNoticeOpen(false)}
                isDaylight={isDaylight}
                title={t('options.nativeBlurConfirmTitle')}
                footer={(
                    <>
                        <button
                            type="button"
                            onClick={() => setIsNativeBlurNoticeOpen(false)}
                            className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {t('localMusic.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={confirmNativeBlur}
                            className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ backgroundColor: theme?.accentColor || '#3b82f6' }}
                        >
                            {t('options.nativeBlurConfirmAction')}
                        </button>
                    </>
                )}
            >
                <p className="text-sm leading-6 opacity-75" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.nativeBlurConfirmDesc')}
                </p>
            </ThemedDialog>
        </>
    );

    if (embedded) {
        return content;
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={shellTransition}
                    className="fixed inset-0 z-[136] backdrop-blur-xl p-3 sm:p-5"
                    style={{ backgroundColor: overlayBackground }}
                    onMouseDown={handleOverlayMouseDown}
                    onClick={handleBackdropClick}
                >
                    <motion.div
                        {...panelMotion}
                        transition={shellTransition}
                        className={`mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${subviewPanelBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)] relative`}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="absolute inset-0 pointer-events-none z-0">
                            <div 
                                className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-[80px] ${isDaylight ? 'opacity-20' : 'opacity-10'}`} 
                                style={{ backgroundColor: theme?.accentColor || (isDaylight ? '#60a5fa' : '#3b82f6') }} 
                            />
                            <div 
                                className={`absolute -bottom-24 -left-24 w-64 h-64 rounded-full blur-[80px] ${isDaylight ? 'opacity-20' : 'opacity-10'}`} 
                                style={{ backgroundColor: theme?.secondaryColor || theme?.accentColor || (isDaylight ? '#c084fc' : '#a855f7') }} 
                            />
                        </div>
                        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6 relative z-10">
                            <div className="flex items-center gap-3 min-w-0">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className={`h-10 w-10 rounded-full border flex items-center justify-center transition-colors ${utilityGhostButtonClass}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <div className="min-w-0">
                                    <div className="text-lg sm:text-xl font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.labSettings')}
                                    </div>
                                    <div className="text-xs opacity-50 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.labSettingsDesc')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {content}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default LabSettingsModal;
