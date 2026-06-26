import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Search, Upload, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OnlineLyricsState } from '../../types';
import LyricTimelineOffsetControl from './LyricTimelineOffsetControl';

// src/components/panelTab/OnlineLyricsTab.tsx

interface OnlineLyricsTabProps {
    onlineLyricsState: OnlineLyricsState | null;
    onImportLyrics: (content: string, fileName: string) => void;
    onChangeLyricsSource: (source: 'online' | 'imported') => void;
    onMatchOnlineLyrics: () => void;
    onClearOnlineLyricsState: () => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    isDaylight: boolean;
}

const OnlineLyricsTab: React.FC<OnlineLyricsTabProps> = ({
    onlineLyricsState,
    onImportLyrics,
    onChangeLyricsSource,
    onMatchOnlineLyrics,
    onClearOnlineLyricsState,
    lyricTimelineOffsetMs,
    onLyricTimelineOffsetChange,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);

    const activeTabBg = isDaylight ? 'bg-blue-500/15 text-blue-600' : 'bg-blue-500/20 text-blue-300';
    const tabContainerBg = isDaylight ? 'bg-black/5' : 'bg-white/5';
    const activePillBg = isDaylight ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'bg-zinc-800/80 shadow-[0_2px_8px_rgba(0,0,0,0.2)]';
    const activeTextColor = isDaylight ? 'text-blue-600 font-semibold' : 'text-blue-300 font-semibold';
    const inactiveTextColor = isDaylight ? 'text-zinc-500 hover:text-zinc-800' : 'text-zinc-400 hover:text-zinc-200';

    const hasImportedLyrics = Boolean(onlineLyricsState?.importedLyrics);
    const hasOverride = Boolean(onlineLyricsState?.hasOnlineOverride || onlineLyricsState?.importedLyrics);
    const activeSource = onlineLyricsState?.lyricsSource === 'imported' && hasImportedLyrics ? 'imported' : 'online';

    const onlineSourceLabel = useMemo(() => {
        const src = onlineLyricsState?.matchedLyricsSource;
        if (src === 'qq') return 'QQ 音乐';
        if (src === 'kugou') return '酷狗音乐';
        return '网易云音乐';
    }, [onlineLyricsState]);

    const availableSources = useMemo(
        () => (hasImportedLyrics
            ? [
                { key: 'online' as const, label: onlineSourceLabel },
                { key: 'imported' as const, label: t('localMusic.statusImported') },
            ]
            : [{ key: 'online' as const, label: onlineSourceLabel }]),
        [hasImportedLyrics, onlineSourceLabel, t],
    );

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = nextEvent => {
            const content = nextEvent.target?.result as string | null;
            if (content) {
                onImportLyrics(content, file.name);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col pt-0 px-2"
        >
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <label className="text-[12px] font-bold opacity-40 uppercase tracking-widest flex items-center gap-1.5">
                            {t('localMusic.lyrics')}
                        </label>
                        {hasOverride && (
                            <button
                                onClick={onClearOnlineLyricsState}
                                className={`p-1 rounded-md transition-all opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
                                title={t('localMusic.delete') || '清除'}
                            >
                                <RotateCcw size={13} />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => inputRef.current?.click()}
                            className={`p-1 rounded-md transition-all opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
                            title={t('localMusic.importLyricsFile')}
                        >
                            <Upload size={14} />
                        </button>
                        <input
                            type="file"
                            accept=".lrc,.txt"
                            ref={inputRef}
                            className="hidden"
                            onChange={handleImport}
                        />
                        <button
                            onClick={onMatchOnlineLyrics}
                            className={`p-1 rounded-md transition-all opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
                            title={t('localMusic.matchOnline')}
                        >
                            <Search size={14} />
                        </button>
                    </div>
                </div>

                {availableSources.length === 1 ? (
                    <div className={`flex items-center justify-between ${isDaylight ? 'bg-black/5' : 'bg-white/5'} rounded-lg p-2 pl-3`}>
                        <span className="text-[11px] opacity-60">
                            {t('lyricsSource') === 'Lyrics' ? 'Lyrics Source' : '歌词来源'}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${activeTabBg}`}>
                            {availableSources[0].label}
                        </span>
                    </div>
                ) : (
                    <div className={`relative flex p-0.5 ${tabContainerBg} rounded-lg`}>
                        {availableSources.map(source => {
                            const isActive = activeSource === source.key;
                            return (
                                <button
                                    key={source.key}
                                    onClick={() => onChangeLyricsSource(source.key)}
                                    className={`flex-1 relative text-[10px] py-1 px-1.5 rounded-md font-medium transition-colors duration-200 focus:outline-none ${
                                        isActive ? activeTextColor : inactiveTextColor
                                    }`}
                                >
                                    {isActive && (
                                        <motion.span
                                            layoutId="online-lyrics-active-pill"
                                            className={`absolute inset-0 rounded-md ${activePillBg}`}
                                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                                        />
                                    )}
                                    <span className="relative z-10">{source.label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                <LyricTimelineOffsetControl
                    offsetMs={lyricTimelineOffsetMs}
                    onOffsetChange={onLyricTimelineOffsetChange}
                    isDaylight={isDaylight}
                />
            </div>
        </motion.div>
    );
};

export default OnlineLyricsTab;
