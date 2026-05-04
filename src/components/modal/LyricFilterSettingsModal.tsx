import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Loader2, RotateCcw } from 'lucide-react';
import type { LyricData } from '../../types';
import {
    buildLyricFilterPreview,
    getLyricFilterError,
    LYRIC_FILTER_REGEX_EXAMPLE,
} from '../../utils/lyrics/filtering';

interface LyricFilterSettingsModalProps {
    isOpen: boolean;
    isDaylight: boolean;
    currentSongTitle?: string | null;
    initialPattern: string;
    loadPreviewLyrics: () => Promise<LyricData | null>;
    onClose: () => void;
    onSave: (pattern: string) => Promise<void> | void;
}

const shellTransition = {
    duration: 0.28,
    ease: [0.22, 1, 0.36, 1] as const,
};

const panelMotion = {
    initial: { y: 24, opacity: 0, scale: 0.985 },
    animate: { y: 0, opacity: 1, scale: 1 },
    exit: { y: 24, opacity: 0, scale: 0.985 },
};

const LyricFilterSettingsModal: React.FC<LyricFilterSettingsModalProps> = ({
    isOpen,
    isDaylight,
    currentSongTitle,
    initialPattern,
    loadPreviewLyrics,
    onClose,
    onSave,
}) => {
    const [draftPattern, setDraftPattern] = useState(initialPattern);
    const [isFilterEnabled, setIsFilterEnabled] = useState(Boolean(initialPattern.trim()));
    const [previewLyrics, setPreviewLyrics] = useState<LyricData | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setDraftPattern(initialPattern);
        setIsFilterEnabled(Boolean(initialPattern.trim()));
        setIsLoadingPreview(true);
        let active = true;

        loadPreviewLyrics()
            .then((lyrics) => {
                if (active) {
                    setPreviewLyrics(lyrics);
                }
            })
            .finally(() => {
                if (active) {
                    setIsLoadingPreview(false);
                }
            });

        return () => {
            active = false;
        };
    }, [initialPattern, isOpen, loadPreviewLyrics]);

    const effectivePattern = isFilterEnabled ? draftPattern : '';
    const error = isFilterEnabled ? getLyricFilterError(draftPattern) : null;
    const preview = useMemo(
        () => buildLyricFilterPreview(previewLyrics, effectivePattern),
        [effectivePattern, previewLyrics]
    );

    const glassBg = isDaylight ? 'bg-white/70' : 'bg-black/40';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const overlayBackground = isDaylight ? 'rgba(244, 244, 245, 0.9)' : 'rgba(10, 10, 12, 0.82)';
    const cardBg = isDaylight ? 'bg-black/[0.03]' : 'bg-white/[0.04]';
    const inputBg = isDaylight ? 'bg-black/5 border-black/10' : 'bg-white/5 border-white/10';
    const mutedText = isDaylight ? 'text-zinc-500' : 'text-white/50';
    const dangerText = isDaylight ? 'text-red-600' : 'text-red-300';
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-300/90' : 'bg-white/10';

    const handleSave = async () => {
        if (error) {
            return;
        }

        setIsSaving(true);
        try {
            await onSave(isFilterEnabled ? draftPattern.trim() : '');
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={shellTransition}
                    className="fixed inset-0 z-[137] backdrop-blur-xl px-3 pt-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-5"
                    style={{ backgroundColor: overlayBackground }}
                    onClick={onClose}
                >
                    <motion.div
                        {...panelMotion}
                        transition={shellTransition}
                        className={`mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6">
                            <div className="flex min-w-0 items-center gap-3">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="h-10 w-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center transition-colors hover:bg-white/10"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <div className="min-w-0">
                                    <div className="truncate text-lg font-semibold sm:text-xl" style={{ color: 'var(--text-primary)' }}>
                                        歌词过滤正则
                                    </div>
                                    <div className={`mt-1 text-xs ${mutedText}`}>
                                        {currentSongTitle ? `预览当前歌曲：${currentSongTitle}` : '预览当前播放歌曲的歌词过滤效果'}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setDraftPattern('')}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <RotateCcw size={14} />
                                    <span>清空</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={Boolean(error) || isSaving}
                                    onClick={handleSave}
                                    className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/15 disabled:opacity-50"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {isSaving ? '保存中...' : '保存'}
                                </button>
                            </div>
                        </div>

                        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1.15fr_0.85fr]">
                            <div className={`flex min-h-0 flex-col border-b ${borderColor} lg:border-b-0 lg:border-r`}>
                                <div className="flex items-center justify-between px-4 py-4 sm:px-6">
                                    <div>
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            预览
                                        </div>
                                        <div className={`mt-1 text-xs ${mutedText}`}>
                                            {preview.totalCount > 0
                                                ? `已过滤 ${preview.removedCount} / 总计 ${preview.totalCount}`
                                                : '当前没有可预览的歌词'}
                                        </div>
                                    </div>
                                </div>
                                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 sm:px-6">
                                    {isLoadingPreview ? (
                                        <div className="flex h-full items-center justify-center">
                                            <Loader2 className={`animate-spin ${mutedText}`} size={28} />
                                        </div>
                                    ) : preview.lines.length === 0 ? (
                                        <div className={`flex h-full items-center justify-center text-sm ${mutedText}`}>
                                            当前没有可预览的歌词内容
                                        </div>
                                    ) : (
                                        <div className="space-y-4 py-4 text-center">
                                            {preview.lines.map(({ line, removed, index }) => (
                                                <div
                                                    key={`${index}-${line.startTime}-${line.fullText}`}
                                                    className="px-3 transition-colors"
                                                >
                                                    <div className="flex flex-col items-center gap-1">
                                                        <div className={`min-w-0 text-sm ${removed ? 'line-through opacity-55' : ''}`} style={{ color: 'var(--text-primary)' }}>
                                                            {line.fullText}
                                                        </div>
                                                    </div>
                                                    {line.translation && (
                                                        <div className={`mt-1 text-xs ${removed ? 'line-through opacity-45' : mutedText}`}>
                                                            {line.translation}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
                                <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                                    <div>
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            开启过滤
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsFilterEnabled(previous => !previous)}
                                        className={`w-12 h-6 rounded-full p-1 transition-colors ${!isFilterEnabled ? toggleOffBackgroundClass : ''}`}
                                        style={{ backgroundColor: isFilterEnabled ? 'var(--text-secondary)' : undefined }}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isFilterEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>

                                <div className={`rounded-[24px] border p-4 ${cardBg} ${borderColor}`}>
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        正则表达式
                                    </div>
                                    <div className={`mt-1 text-xs ${mutedText}`}>
                                        按整首歌的正文歌词逐行匹配，命中后删除整行。
                                    </div>
                                    <input
                                        type="text"
                                        value={draftPattern}
                                        onChange={(event) => setDraftPattern(event.target.value)}
                                        placeholder="输入正则表达式"
                                        disabled={!isFilterEnabled}
                                        className={`mt-4 w-full rounded-2xl border px-4 py-3 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${inputBg}`}
                                        style={{ color: 'var(--text-primary)' }}
                                    />
                                    <div className="mt-3 px-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        示例：<code>{LYRIC_FILTER_REGEX_EXAMPLE}</code>
                                    </div>
                                    {error && (
                                        <div className={`mt-3 text-xs ${dangerText}`}>
                                            正则无效：{error}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default LyricFilterSettingsModal;
