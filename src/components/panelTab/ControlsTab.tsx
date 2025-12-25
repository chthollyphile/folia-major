import React from 'react';
import { motion } from 'framer-motion';
import { Repeat, Repeat1, Heart, Sparkles, RotateCcw, Cone, Sun, Moon } from 'lucide-react';
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
}) => {
    const { t } = useTranslation();
    // const isDaylight = theme.name === 'Daylight Default'; // Deprecated, passed as prop
    const buttonBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10';
    const activeIconBg = isDaylight ? 'bg-black text-white' : 'bg-white text-black';
    const wellBg = isDaylight ? 'bg-black/5' : 'bg-black/20';
    const activeOptionBg = isDaylight ? 'bg-white shadow-sm' : 'bg-white/20 shadow-sm';

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

            {/* Appearance Intensity */}
            <div className="pt-2 border-t border-white/5">
                <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest block mb-2">
                    {t('ui.animationIntensity')}
                </label>
                <div className={`flex ${wellBg} p-1 rounded-xl mb-3`}>
                    {['calm', 'normal', 'chaotic'].map((mode) => (
                        <button
                            key={mode}
                            onClick={() => onThemeChange({ ...theme, animationIntensity: mode as any })}
                            className={`flex-1 py-1.5 text-[10px] font-medium capitalize rounded-lg transition-all
                                ${theme.animationIntensity === mode ? activeOptionBg : 'opacity-40 hover:opacity-100'}`}
                        >
                            {t(`animation.${mode}`)}
                        </button>
                    ))}
                </div>

                {/* Background Mode Select */}
                <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest">
                        {t('ui.background')}
                    </label>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={onToggleDaylight}
                            className={`p-1 rounded-md transition-all ${isDaylight ? 'text-amber-500' : 'text-blue-300'}`}
                            title={isDaylight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                        >
                            {isDaylight ? <Sun size={14} /> : <Moon size={14} />}
                        </button>
                        <button
                            onClick={() => onToggleCoverColorBg(!useCoverColorBg)}
                            className={`p-1 rounded-md transition-all ${useCoverColorBg ? 'text-blue-400' : 'opacity-40 hover:opacity-100'}`}
                            title={useCoverColorBg ? '添加封面色彩' : '使用默认色彩'}
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

            {/* Theme Name Display & Reset */}
            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold truncate max-w-[120px]">
                        {theme.name === defaultTheme.name ? "Midnight Default" : (theme.name === daylightTheme.name ? "Daylight Default" : theme.name)}
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

