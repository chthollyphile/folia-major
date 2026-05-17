import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Repeat, Repeat1, Heart, Sparkles, RotateCcw, Cone, Sun, Moon, Volume2, Volume1, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Theme, ThemeMode, VisualizerMode } from '../../types';
import { getVisualizerModeLabel, VISUALIZER_REGISTRY } from '../visualizer/registry';

// Controls tab keeps the visualizer picker local so it can expand into a full-tab overlay
// without changing the rest of the player state flow.

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
    onResetTheme: () => void;
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
    onResetTheme,
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
}) => {
    const { t } = useTranslation();
    const [sliderVolume, setSliderVolume] = useState(isMuted ? 0 : volume);
    const [isVisualizerOverlayOpen, setIsVisualizerOverlayOpen] = useState(false);
    const isDraggingRef = useRef(false);
    const pendingVolumeRef = useRef(sliderVolume);
    const visualizerTriggerRef = useRef<HTMLButtonElement>(null);
    const [visualizerOverlayLeft, setVisualizerOverlayLeft] = useState(0);

    useEffect(() => {
        if (!isDraggingRef.current) {
            const nextVolume = isMuted ? 0 : volume;
            setSliderVolume(nextVolume);
            pendingVolumeRef.current = nextVolume;
        }
    }, [volume, isMuted]);

    useLayoutEffect(() => {
        if (!isVisualizerOverlayOpen) {
            return undefined;
        }

        const syncOverlayPosition = () => {
            const trigger = visualizerTriggerRef.current;
            const parent = trigger?.offsetParent as HTMLElement | null;
            if (!trigger || !parent) {
                return;
            }

            const triggerRect = trigger.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            setVisualizerOverlayLeft(triggerRect.left - parentRect.left + triggerRect.width / 2);
        };

        syncOverlayPosition();
        window.addEventListener('resize', syncOverlayPosition);
        return () => window.removeEventListener('resize', syncOverlayPosition);
    }, [isVisualizerOverlayOpen]);

    useEffect(() => {
        if (!isVisualizerOverlayOpen) {
            return undefined;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node)) {
                return;
            }

            const target = event.target as HTMLElement;
            const isInsidePanel = target.closest('[data-visualizer-panel="true"]');
            const isTrigger = target.closest('[data-visualizer-trigger="true"]');

            if (!isInsidePanel && !isTrigger) {
                setIsVisualizerOverlayOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isVisualizerOverlayOpen]);

    const buttonBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10';
    const activeIconBg = isDaylight ? 'bg-zinc-500 text-white' : 'bg-white text-black';
    const wellBg = isDaylight ? 'bg-black/5' : 'bg-black/20';
    const activeOptionBg = isDaylight ? 'bg-white shadow-sm hover:bg-white/90' : 'bg-white/20 shadow-sm hover:bg-white/30';
    const overlaySurfaceClass = isDaylight ? 'text-black border-black/[0.08]' : 'text-white border-white/[0.08]';
    const overlayBodyTextClass = isDaylight ? 'text-black/82' : 'text-white/84';

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

    const handleVisualizerSelect = (mode: VisualizerMode) => {
        onVisualizerModeChange(mode);
        setIsVisualizerOverlayOpen(false);
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
                        className={`h-12 rounded-xl flex items-center justify-center transition-colors ${loopMode !== 'off' ? activeIconBg : buttonBg} ${loopToggleDisabled ? 'opacity-35 cursor-not-allowed' : ''}`}
                    >
                        {loopMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
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
                        className={`h-12 rounded-xl flex items-center justify-center transition-colors ${isGeneratingTheme ? 'bg-blue-500/20 text-blue-300' : buttonBg}`}
                    >
                        <Sparkles size={20} className={isGeneratingTheme ? 'animate-pulse' : ''} />
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
                        <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest">
                            {t('ui.animationMode') || '动画模式'}
                        </label>
                        <div className="flex items-center gap-2">
                            <button
                                ref={visualizerTriggerRef}
                                onClick={() => setIsVisualizerOverlayOpen(prev => !prev)}
                                data-visualizer-trigger="true"
                                className={`px-3 py-1 text-[10px] font-bold rounded-lg transition-all ${activeOptionBg}`}
                                style={isVisualizerOverlayOpen ? { color: theme.primaryColor } : undefined}
                            >
                                {getVisualizerModeLabel(visualizerMode, t)}
                            </button>

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
                            <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest">
                                {t('ui.background')}
                            </label>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={onToggleDaylight}
                                    className={`p-1 rounded-md transition-all ${isDaylight ? 'text-amber-500' : 'text-blue-300'}`}
                                    title={isDaylight ? t('theme.switchToDark') : t('theme.switchToLight')}
                                >
                                    {isDaylight ? <Sun size={14} /> : <Moon size={14} />}
                                </button>
                                <button
                                    onClick={() => onToggleCoverColorBg(!useCoverColorBg)}
                                    className={`p-1 rounded-md transition-all ${useCoverColorBg ? 'text-blue-400' : 'opacity-40 hover:opacity-100'}`}
                                    title={useCoverColorBg ? t('theme.addCoverColor') : t('theme.useDefaultColor')}
                                >
                                    <Cone size={14} />
                                </button>
                            </div>
                        </div>
                        <div className={`flex ${wellBg} p-1 rounded-xl`}>
                            <button
                                onClick={() => onBgModeChange('default')}
                                className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all ${bgMode === 'default' ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                            >
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor }}></div>
                                {t('ui.default')}
                            </button>
                            <button
                                onClick={() => onBgModeChange('ai')}
                                className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all ${bgMode === 'ai' ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                            >
                                <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: theme.backgroundColor }}></div>
                                {t('ui.aiTheme')}
                            </button>
                            {hasCustomTheme && (
                                <button
                                    onClick={() => onBgModeChange('custom')}
                                    className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all ${bgMode === 'custom' ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                                >
                                    <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: theme.accentColor }}></div>
                                    {t('options.customTheme') || 'Custom'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold truncate max-w-[120px]">
                            {theme.name === defaultTheme.name ? t('theme.midnightDefault') : (theme.name === daylightTheme.name ? t('theme.daylightDefault') : theme.name)}
                        </span>
                        {(theme.name !== defaultTheme.name && theme.name !== daylightTheme.name) && (
                            <button
                                onClick={onResetTheme}
                                className={`p-1 rounded-full ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'} transition-colors`}
                                title={t('ui.resetToDefaultTheme')}
                            >
                                <RotateCcw size={12} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {isVisualizerOverlayOpen && (
                    <motion.div
                        key="visualizer-overlay"
                        initial={{ opacity: 0, scale: 0.92, x: -12, y: -10 }}
                        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, x: -8, y: -6 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="absolute top-[4.45rem] z-20 w-[7.25rem] -translate-x-1/2"
                        style={{ left: visualizerOverlayLeft }}
                        onClick={() => setIsVisualizerOverlayOpen(false)}
                    >
                        <motion.div
                            layout
                            data-visualizer-panel="true"
                            className={`relative max-h-[11.25rem] overflow-y-auto rounded-[1.15rem] border shadow-2xl ${overlaySurfaceClass}`}
                            style={{
                                boxShadow: isDaylight
                                    ? '0 18px 44px rgba(15, 23, 42, 0.14)'
                                    : '0 22px 60px rgba(0, 0, 0, 0.42)',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="relative overflow-hidden px-1.5 py-1.5">
                                <div
                                    className="absolute inset-0"
                                    style={{ backgroundColor: isDaylight ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.94)' }}
                                />
                                <div className="relative space-y-0.5">
                                    {VISUALIZER_REGISTRY.map((entry) => {
                                        const isActive = entry.mode === visualizerMode;
                                        return (
                                            <button
                                                key={entry.mode}
                                                onClick={() => handleVisualizerSelect(entry.mode)}
                                                className={`relative flex w-full items-center justify-center rounded-[0.85rem] px-2 text-center transition-all ${isActive ? 'py-1.5' : `py-2.5 ${isDaylight ? 'hover:bg-black/[0.04]' : 'hover:bg-white/[0.04]'}`}`}
                                                style={isActive ? {
                                                    backgroundColor: isDaylight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.12)',
                                                    color: theme.primaryColor,
                                                } : undefined}
                                            >
                                                {isActive && (
                                                    <div
                                                        className="absolute left-2 h-1.5 w-1.5 rounded-full"
                                                        style={{
                                                            backgroundColor: isDaylight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.88)',
                                                            boxShadow: isDaylight
                                                                ? '0 0 0 1px rgba(255,255,255,0.55)'
                                                                : '0 0 0 1px rgba(255,255,255,0.18)',
                                                        }}
                                                    />
                                                )}
                                                <span className={`text-[9px] ${isActive ? 'font-medium' : 'font-normal'} tracking-[0.01em] ${overlayBodyTextClass}`} style={{ color: theme.primaryColor }}>
                                                    {getVisualizerModeLabel(entry.mode, t)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ControlsTab;
