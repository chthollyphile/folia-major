import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { UnifiedSong, LocalSong } from '../../types';
import { FileAudio, RefreshCw, FileText, Languages, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LocalTabProps {
    currentSong: UnifiedSong;
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean) => void;
    isDaylight: boolean;
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const LocalTab: React.FC<LocalTabProps> = ({ currentSong, onMatchOnline, onUpdateLocalLyrics, isDaylight }) => {
    const { t } = useTranslation();
    const lrcInputRef = useRef<HTMLInputElement>(null);
    const tlrcInputRef = useRef<HTMLInputElement>(null);

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
                    <button
                        onClick={onMatchOnline}
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors rounded-lg text-xs font-medium flex items-center gap-1.5"
                    >
                        <RefreshCw size={12} />
                        {t('localMusic.matchOnline')}
                    </button>
                </div>

                {/* Original Lyrics */}
                <div className="flex items-center justify-between bg-white/5 rounded-lg p-2 pl-3">
                    <div className="flex items-center gap-2">
                        <FileText size={16} className="opacity-60" />
                        <span className="text-sm">{t('localMusic.original')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${localData.hasLocalLyrics
                            ? 'bg-green-500/20 text-green-300'
                            : (localData.matchedLyrics?.lines?.length ?? 0) > 0
                                ? isDaylight ? 'bg-[#1686eb]/10 text-[#1686eb]' : 'bg-blue-500/20 text-blue-300'
                                : 'bg-white/10 opacity-60'
                            }`}>
                            {localData.hasLocalLyrics
                                ? t('localMusic.statusLocal')
                                : (localData.matchedLyrics?.lines?.length ?? 0) > 0
                                    ? t('localMusic.statusOnline')
                                    : t('localMusic.statusNone')}
                        </span>
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
                    </div>
                </div>

                {/* Translation Lyrics */}
                <div className="flex items-center justify-between bg-white/5 rounded-lg p-2 pl-3">
                    <div className="flex items-center gap-2">
                        <Languages size={16} className="opacity-60" />
                        <span className="text-sm">{t('localMusic.translation')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${localData.hasLocalTranslationLyrics
                            ? 'bg-green-500/20 text-green-300'
                            : (localData.matchedLyrics?.lines?.some(l => l.translation) ?? false)
                                ? isDaylight ? 'bg-[#1686eb]/10 text-[#1686eb]' : 'bg-blue-500/20 text-blue-300'
                                : 'bg-white/10 opacity-60'
                            }`}>
                            {localData.hasLocalTranslationLyrics
                                ? t('localMusic.statusLocal')
                                : (localData.matchedLyrics?.lines?.some(l => l.translation) ?? false)
                                    ? t('localMusic.statusOnline')
                                    : t('localMusic.statusNone')}
                        </span>
                        <button
                            onClick={() => tlrcInputRef.current?.click()}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                            title={t('localMusic.selectTranslationLrc')}
                        >
                            <Upload size={14} />
                        </button>
                        <input
                            type="file"
                            accept=".lrc,.txt"
                            ref={tlrcInputRef}
                            className="hidden"
                            onChange={(e) => handleFileChange(e, true)}
                        />
                    </div>
                </div>
            </div>
        </motion.div >
    );
};

export default LocalTab;
