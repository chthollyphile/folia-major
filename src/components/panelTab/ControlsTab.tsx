import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Repeat, Repeat1, Heart, Sparkles, RotateCcw, Cone, Sun, Moon, Volume2, Volume1, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Theme } from '../../types';

interface ControlsTabProps {
    loopMode: 'off' | 'all' | 'one';
    onToggleLoop: () => void;
    onLike: () => void;
    isLiked: boolean;
    onGenerateAITheme: () => void;
    isGeneratingTheme: boolean;
    hasLyrics: boolean;
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    bgMode: 'default' | 'ai';
    onBgModeChange: (mode: 'default' | 'ai') => void;
    onResetTheme: () => void;
    defaultTheme: Theme;
    daylightTheme: Theme;
    useCoverColorBg: boolean;
    onToggleCoverColorBg: (enable: boolean) => void;
    isDaylight: boolean;
    onToggleDaylight: () => void;
    volume: number;
    isMuted: boolean;
    onVolumePreview: (val: number) => void;
    onVolumeChange: (val: number) => void;
    onToggleMute: () => void;
}

const ControlsTab: React.FC<ControlsTabProps> = ({
    loopMode,
    onToggleLoop,
    onLike,
    isLiked,
    onGenerateAITheme,
    isGeneratingTheme,
    hasLyrics,
    theme,
    onThemeChange,
    bgMode,
    onBgModeChange,
    onResetTheme,
    defaultTheme,
    daylightTheme,
    useCoverColorBg,
    onToggleCoverColorBg,
    isDaylight,
    onToggleDaylight,
    volume,
    isMuted,
    onVolumePreview,
    onVolumeChange,
    onToggleMute
}) => {
    const { t } = useTranslation();
    const [sliderVolume, setSliderVolume] = useState(isMuted ? 0 : volume);
    const isDraggingRef = useRef(false);
    const pendingVolumeRef = useRef(sliderVolume);

    useEffect(() => {
        if (!isDraggingRef.current) {
            const nextVolume = isMuted ? 0 : volume;
            setSliderVolume(nextVolume);
            pendingVolumeRef.current = nextVolume;
        }
    }, [volume, isMuted]);

    const buttonBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10';
    const activeIconBg = isDaylight ? 'bg-black text-white' : 'bg-white text-black';
    const wellBg = isDaylight ? 'bg-black/5' : 'bg-black/20';
    const activeOptionBg = isDaylight ? 'bg-white shadow-sm' : 'bg-white/20 shadow-sm';

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

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
        >
            {/* Action Buttons: Loop, Like, AI (Compact) */}
            <div className="grid grid-cols-3 gap-3">
                <button
                    onClick={onToggleLoop}
                    className={`h-12 rounded-xl flex items-center justify-center transition-colors
                        ${loopMode !== 'off' ? activeIconBg : buttonBg}`}
                >
                    {loopMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
                </button>

                <button
                    onClick={onLike}
                    className={`h-12 rounded-xl flex items-center justify-center transition-colors
                        ${isLiked ? 'bg-red-500/20 text-red-500' : buttonBg}`}
                >
                    <Heart size={20} fill={isLiked ? "currentColor" : "none"} />
                </button>

                <button
                    onClick={onGenerateAITheme}
                    disabled={isGeneratingTheme || !hasLyrics}
                    className={`h-12 rounded-xl flex items-center justify-center transition-colors
                        ${isGeneratingTheme ? 'bg-blue-500/20 text-blue-300' : buttonBg}`}
                >
                    <Sparkles size={20} className={isGeneratingTheme ? "animate-pulse" : ""} />
                </button>
            </div>

            {/* Appearance Settings Row */}
            <div className="pt-2 border-t border-white/5 space-y-4">
                {/* Volume Control */}
                <div className="">
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

                {/* Animation Intensity */}
                <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest">
                        {t('ui.animationIntensity')}
                    </label>
                    <button
                        onClick={() => {
                            const modes: ('calm' | 'normal' | 'chaotic')[] = ['calm', 'normal', 'chaotic'];
                            const currentIndex = modes.indexOf(theme.animationIntensity);
                            const nextIndex = (currentIndex + 1) % modes.length;
                            onThemeChange({ ...theme, animationIntensity: modes[nextIndex] });
                        }}
                        className={`px-3 py-1 text-[10px] font-bold capitalize rounded-lg transition-all ${activeOptionBg}`}
                    >
                        {t(`animation.${theme.animationIntensity}`)}
                    </button>
                </div>

                {/* Background Mode Select */}
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
                            className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all
                                ${bgMode === 'default' ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                        >
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor }}></div>
                            {t('ui.default')}
                        </button>
                        <button
                            onClick={() => onBgModeChange('ai')}
                            className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all
                                ${bgMode === 'ai' ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                        >
                            <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: theme.backgroundColor }}></div>
                            {t('ui.aiTheme')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Theme Name Display & Reset */}
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
        </motion.div>
    );
};

export default ControlsTab;
