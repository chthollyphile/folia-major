import React, { useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { UnifiedSong, LocalSong } from '../../types';
import { FileAudio, RefreshCw, FileText, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LocalTabProps {
    currentSong: UnifiedSong;
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean) => void;
    onChangeLyricsSource: (source: 'local' | 'embedded' | 'online') => void;
    isDaylight: boolean;
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const LocalTab: React.FC<LocalTabProps> = ({ currentSong, onMatchOnline, onUpdateLocalLyrics, onChangeLyricsSource, isDaylight }) => {
    const { t } = useTranslation();
    const lrcInputRef = useRef<HTMLInputElement>(null);

    const localData = currentSong.localData;

    if (!currentSong.isLocal || !localData) {
        return (
            <div className="flex items-center justify-center h-full opacity-60">
                {t('localMusic.notALocalSong')}
            </div>
        );
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isTranslation: boolean) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            if (content) {
                onUpdateLocalLyrics(content, isTranslation);
            }
        };
        reader.readAsText(file);

        // Reset input
        e.target.value = '';
    };

    // Compute available lyrics sources
    const availableSources = useMemo(() => {
        const sources: { key: 'local' | 'embedded' | 'online'; label: string }[] = [];
        if (localData.hasLocalLyrics) {
            sources.push({ key: 'local', label: t('localMusic.statusLocal') });
        }
        if (localData.hasEmbeddedLyrics) {
            sources.push({ key: 'embedded', label: t('localMusic.statusEmbedded') });
        }
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) {
            sources.push({ key: 'online', label: t('localMusic.statusOnline') });
        }
        return sources;
    }, [localData, t]);

    // Determine currently active source
    const activeSource = useMemo(() => {
        if (localData.lyricsSource) return localData.lyricsSource;
        // Default priority: local > embedded > online
        if (localData.hasLocalLyrics) return 'local';
        if (localData.hasEmbeddedLyrics) return 'embedded';
        if ((localData.matchedLyrics?.lines?.length ?? 0) > 0) return 'online';
        return null;
    }, [localData]);

    // Style helpers
    const tabActiveBg = isDaylight ? 'bg-blue-500/15 text-blue-600' : 'bg-blue-500/20 text-blue-300';
    const tabInactiveBg = isDaylight ? 'bg-black/5 text-zinc-500 hover:bg-black/10' : 'bg-white/5 text-zinc-400 hover:bg-white/10';

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col space-y-6 pt-4 px-2"
        >
            {/* File Info */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                    <FileAudio size={14} /> {t('localMusic.fileInfo')}
                </h3>
                <div className="bg-white/5 rounded-xl p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="opacity-60">{t('localMusic.filename')}</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={localData.fileName}>
                            {localData.fileName}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="opacity-60">{t('localMusic.size')}</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={`${formatBytes(localData.fileSize)}${localData.bitrate ? ` / ${Math.round(localData.bitrate / 1000)} kbps` : ''}`}>
                            {formatBytes(localData.fileSize)}{localData.bitrate && ` / ${Math.round(localData.bitrate / 1000)} kbps`}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="opacity-60">{t('localMusic.path')}</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={localData.filePath}>
                            {localData.folderName}/{localData.fileName}
                        </span>
                    </div>
                </div>
            </div>

            {/* Lyrics Management */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                        <FileText size={14} /> {t('localMusic.lyrics')}
                    </h3>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => lrcInputRef.current?.click()}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                            title={t('localMusic.selectLrcFile')}
                        >
                            <Upload size={14} />
                        </button>
                        <input
                            type="file"
                            accept=".lrc,.txt"
                            ref={lrcInputRef}
                            className="hidden"
                            onChange={(e) => handleFileChange(e, false)}
                        />
                        <button
                            onClick={onMatchOnline}
                            className="px-3 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors rounded-lg text-xs font-medium flex items-center gap-1.5"
                        >
                            <RefreshCw size={12} />
                            {t('localMusic.matchOnline')}
                        </button>
                    </div>
                </div>

                {/* Lyrics Source Selector */}
                {availableSources.length === 0 ? (
                    <div className={`text-xs px-3 py-2 rounded-lg bg-white/5 ${isDaylight ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        {t('localMusic.statusNone')}
                    </div>
                ) : availableSources.length === 1 ? (
                    <div className={`text-xs px-3 py-2 rounded-lg ${tabActiveBg} font-medium`}>
                        {availableSources[0].label}
                    </div>
                ) : (
                    <div className="flex gap-1.5">
                        {availableSources.map((source) => (
                            <button
                                key={source.key}
                                onClick={() => onChangeLyricsSource(source.key)}
                                className={`flex-1 text-xs py-1.5 px-2 rounded-lg font-medium transition-all ${
                                    activeSource === source.key ? tabActiveBg : tabInactiveBg
                                }`}
                            >
                                {source.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default LocalTab;
