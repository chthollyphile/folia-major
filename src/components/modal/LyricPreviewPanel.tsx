import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Music, Sparkles, Languages } from 'lucide-react';
import { SongResult, LyricData } from '../../types';
import { neteaseApi } from '../../services/netease';
import { processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';
import { fetchQQLyrics } from '../../utils/lyrics/providers/qqLyricProvider';
import { fetchKugouLyrics } from '../../utils/lyrics/providers/kugouLyricProvider';

// src/components/modal/LyricPreviewPanel.tsx

interface LyricPreviewPanelProps {
    selectedResult: SongResult | null;
    source: 'netease' | 'qq' | 'kugou';
    isDaylight: boolean;
}

/**
 * 歌词预览面板组件：
 * 负责根据传入的选中歌曲与搜索源，异步加载其歌词，并展示带“逐字”和“翻译”特征标识的预览内容。
 */
export const LyricPreviewPanel: React.FC<LyricPreviewPanelProps> = ({
    selectedResult,
    source,
    isDaylight
}) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [lyricData, setLyricData] = useState<LyricData | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Dynamic styling
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const btnBg = isDaylight ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600' : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300';
    const previewBoxBg = isDaylight ? 'bg-black/[0.02] border-black/5' : 'bg-white/[0.02] border-white/5';

    // 当选择的歌曲结果或源改变时重置状态，只有在用户主动点击按钮时才加载
    useEffect(() => {
        setLyricData(null);
        setError(null);
        setIsLoading(false);
    }, [selectedResult?.id, source]);

    if (!selectedResult) {
        return (
            <div className={`w-full flex-1 flex flex-col items-center justify-center p-4 border rounded-xl border-dashed opacity-40 ${borderColor} ${textSecondary}`}>
                <Music size={24} className="mb-1" />
                <span className="text-xs">{t('localMusic.noSelection')}</span>
            </div>
        );
    }

    // 核心函数：根据所选的源异步拉取并解析对应的歌词
    const handleLoadPreview = async () => {
        setIsLoading(true);
        setError(null);
        setLyricData(null);
        try {
            let processed: { lyrics: any; isPureMusic: boolean } | null = null;
            if (source === 'netease') {
                const lyricRes = await neteaseApi.getLyric(selectedResult.id);
                processed = await processNeteaseLyrics(
                    {
                        type: 'netease',
                        ...lyricRes
                    },
                    { songId: selectedResult.id }
                );
            } else if (source === 'qq') {
                const parsedLyrics = await fetchQQLyrics(selectedResult);
                processed = {
                    lyrics: parsedLyrics,
                    isPureMusic: false,
                };
            } else if (source === 'kugou') {
                const parsedLyrics = await fetchKugouLyrics(selectedResult);
                processed = {
                    lyrics: parsedLyrics,
                    isPureMusic: false,
                };
            }

            if (processed && processed.lyrics) {
                setLyricData(processed.lyrics);
            } else {
                setError(t('localMusic.noLyricsAvailable'));
            }
        } catch (e) {
            console.error('Failed to load lyric preview:', e);
            setError(t('localMusic.matchFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className={`w-full flex-1 flex flex-col items-center justify-center p-4 border rounded-xl ${previewBoxBg}`}>
                <Loader2 className="animate-spin opacity-50 mb-2" size={20} />
                <span className={`text-xs opacity-60 ${textPrimary}`}>{t('localMusic.loadingLyrics')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`w-full flex-1 flex flex-col items-center justify-center p-4 border rounded-xl ${previewBoxBg} ${textSecondary}`}>
                <span className="text-xs mb-2">{error}</span>
                <button
                    onClick={handleLoadPreview}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${btnBg}`}
                >
                    {t('localMusic.reimport')}
                </button>
            </div>
        );
    }

    if (!lyricData) {
        return (
            <div className={`w-full flex-1 flex flex-col items-center justify-center p-4 border rounded-xl border-dashed ${previewBoxBg} ${textSecondary}`}>
                <button
                    onClick={handleLoadPreview}
                    className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all border ${isDaylight ? 'bg-blue-50 border-blue-200/50 text-blue-600 hover:bg-blue-100/50' : 'bg-blue-500/10 border-blue-500/10 text-blue-400 hover:bg-blue-500/20'}`}
                >
                    {t('localMusic.clickToPreview')}
                </button>
            </div>
        );
    }

    // 判断特征
    const isWordByWord = lyricData.isWordByWord || lyricData.lines?.some(line => line.words && line.words.length > 0);
    const hasTranslation = lyricData.lines?.some(line => !!line.translation);

    return (
        <div className={`w-full flex-1 flex flex-col min-h-0 border rounded-xl ${previewBoxBg} overflow-hidden`}>
            {/* 顶栏：标明预览及特征 */}
            <div className={`flex items-center gap-2 p-2 border-b ${borderColor} shrink-0 bg-black/[0.01]`}>
                <span className={`text-[10px] font-bold ${textPrimary} mr-auto pl-1`}>
                    {t('localMusic.lyricPreview')}
                </span>
                
                {isWordByWord && (
                    <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 rounded font-medium border border-indigo-500/10">
                        <Sparkles size={8} />
                        {t('localMusic.wordByWord')}
                    </span>
                )}
                
                {hasTranslation && (
                    <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-medium border border-emerald-500/10">
                        <Languages size={8} />
                        {t('localMusic.hasTranslation')}
                    </span>
                )}
            </div>

            {/* 滚动歌词内容 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2.5 text-left min-h-0">
                {lyricData.lines && lyricData.lines.length > 0 ? (
                    lyricData.lines.map((line, idx) => (
                        <div key={idx} className="group/line">
                            <p className={`text-xs leading-relaxed font-medium transition-colors ${textPrimary}`}>
                                {line.fullText}
                            </p>
                            {line.translation && (
                                <p className={`text-[11px] leading-relaxed mt-0.5 ${textSecondary} opacity-80`}>
                                    {line.translation}
                                </p>
                            )}
                        </div>
                    ))
                ) : (
                    <div className={`text-center py-6 text-xs opacity-50 ${textSecondary}`}>
                        {t('localMusic.statusNone')}
                    </div>
                )}
            </div>
        </div>
    );
};
