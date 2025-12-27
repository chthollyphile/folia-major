import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { UnifiedSong, LocalSong } from '../../types';
import { FileAudio, RefreshCw, FileText, Languages, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface LocalTabProps {
    currentSong: UnifiedSong;
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean) => void;
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const LocalTab: React.FC<LocalTabProps> = ({ currentSong, onMatchOnline, onUpdateLocalLyrics }) => {
    const { t } = useTranslation();
    const lrcInputRef = useRef<HTMLInputElement>(null);
    const tlrcInputRef = useRef<HTMLInputElement>(null);

    const localData = currentSong.localData;

    if (!currentSong.isLocal || !localData) {
        return (
            <div className="flex items-center justify-center h-full opacity-60">
                Not a local song
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
                    <FileAudio size={14} /> File Info
                </h3>
                <div className="bg-white/5 rounded-xl p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="opacity-60">Filename</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={localData.fileName}>
                            {localData.fileName}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="opacity-60">Size</span>
                        <span className="font-mono text-xs opacity-80">{formatBytes(localData.fileSize)}</span>
                    </div>
                    {localData.bitrate && (
                        <div className="flex justify-between">
                            <span className="opacity-60">Bitrate</span>
                            <span className="font-mono text-xs opacity-80">{Math.round(localData.bitrate / 1000)} kbps</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="opacity-60">Path</span>
                        <span className="font-mono text-xs opacity-80 truncate max-w-[150px]" title={localData.filePath}>
                            {localData.folderName}/{localData.fileName}
                        </span>
                    </div>
                </div>
            </div>

            {/* Metadata Match */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw size={14} /> Metadata
                </h3>
                <button
                    onClick={onMatchOnline}
                    className="w-full py-2 bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                >
                    <RefreshCw size={14} />
                    Match Online Info
                </button>
            </div>

            {/* Lyrics Management */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold opacity-50 uppercase tracking-wider flex items-center gap-2">
                    <FileText size={14} /> Lyrics
                </h3>

                {/* Original Lyrics */}
                <div className="flex items-center justify-between bg-white/5 rounded-lg p-2 pl-3">
                    <div className="flex items-center gap-2">
                        <FileText size={16} className="opacity-60" />
                        <span className="text-sm">Original</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${localData.hasLocalLyrics ? 'bg-green-500/20 text-green-300' : 'bg-white/10 opacity-60'}`}>
                            {localData.hasLocalLyrics ? 'Local' : 'None'}
                        </span>
                        <button
                            onClick={() => lrcInputRef.current?.click()}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                            title="Select LRC File"
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
                        <span className="text-sm">Translation</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${localData.hasLocalTranslationLyrics ? 'bg-green-500/20 text-green-300' : 'bg-white/10 opacity-60'}`}>
                            {localData.hasLocalTranslationLyrics ? 'Local' : 'None'}
                        </span>
                        <button
                            onClick={() => tlrcInputRef.current?.click()}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors"
                            title="Select Translation LRC"
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
        </motion.div>
    );
};

export default LocalTab;
