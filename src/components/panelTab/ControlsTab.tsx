import React from 'react';
import { motion } from 'framer-motion';
import { Repeat, Repeat1, Heart, Sparkles, RotateCcw } from 'lucide-react';
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
}) => {
    const { t } = useTranslation();

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
                        ${loopMode !== 'off' ? 'bg-white text-black' : 'bg-white/5 hover:bg-white/10'}`}
                >
                    {loopMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
                </button>

                <button
                    onClick={onLike}
                    className={`h-12 rounded-xl flex items-center justify-center transition-colors
                        ${isLiked ? 'bg-red-500/20 text-red-500' : 'bg-white/5 hover:bg-white/10'}`}
                >
                    <Heart size={20} fill={isLiked ? "currentColor" : "none"} />
                </button>

                <button
                    onClick={onGenerateAITheme}
                    disabled={isGeneratingTheme || !hasLyrics}
                    className={`h-12 rounded-xl flex items-center justify-center transition-colors
                        ${isGeneratingTheme ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 hover:bg-white/10'}`}
                >
                    <Sparkles size={20} className={isGeneratingTheme ? "animate-pulse" : ""} />
                </button>
            </div>

            {/* Appearance Intensity */}
            <div className="pt-2 border-t border-white/5">
                <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest block mb-2">
                    {t('ui.animationIntensity')}
                </label>
                <div className="flex bg-black/20 p-1 rounded-xl mb-3">
                    {['calm', 'normal', 'chaotic'].map((mode) => (
                        <button
                            key={mode}
                            onClick={() => onThemeChange({ ...theme, animationIntensity: mode as any })}
                            className={`flex-1 py-1.5 text-[10px] font-medium capitalize rounded-lg transition-all
                                ${theme.animationIntensity === mode ? 'bg-white/20 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
                        >
                            {t(`animation.${mode}`)}
                        </button>
                    ))}
                </div>

                {/* Background Mode Select */}
                <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest block mb-2">
                    {t('ui.background')}
                </label>
                <div className="flex bg-black/20 p-1 rounded-xl">
                    <button
                        onClick={() => onBgModeChange('default')}
                        className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all
                            ${bgMode === 'default' ? 'bg-white/20 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
                    >
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: defaultTheme.backgroundColor }}></div>
                        {t('ui.default')}
                    </button>
                    <button
                        onClick={() => onBgModeChange('ai')}
                        className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all
                            ${bgMode === 'ai' ? 'bg-white/20 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
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
                        {theme.name === defaultTheme.name ? "Midnight Default" : theme.name}
                    </span>
                    {theme.name !== defaultTheme.name && (
                        <button
                            onClick={onResetTheme}
                            className="p-1 rounded-full hover:bg-white/10 transition-colors"
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

