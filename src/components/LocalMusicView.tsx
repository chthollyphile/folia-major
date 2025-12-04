import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FolderOpen, Play, Music, Trash2, Search, Loader2, Disc } from 'lucide-react';
import { motion } from 'framer-motion';
import { LocalSong } from '../types';
import { importFiles, importFolder, matchLyrics, deleteLocalSong } from '../services/localMusicService';
import LyricMatchModal from './LyricMatchModal';

interface LocalMusicViewProps {
    localSongs: LocalSong[];
    onRefresh: () => void;
    onPlaySong: (song: LocalSong) => void;
}

const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const LocalMusicView: React.FC<LocalMusicViewProps> = ({ localSongs, onRefresh, onPlaySong }) => {
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isImporting, setIsImporting] = useState(false);
    const [matchingLyricsFor, setMatchingLyricsFor] = useState<string | null>(null);
    const [showMatchModal, setShowMatchModal] = useState(false);
    const [selectedSong, setSelectedSong] = useState<LocalSong | null>(null);

    const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsImporting(true);
        try {
            await importFiles(files);
            onRefresh();
        } catch (error) {
            console.error('Failed to import files:', error);
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleFolderImport = async () => {
        setIsImporting(true);
        try {
            await importFolder();
            onRefresh();
        } catch (error) {
            console.error('Failed to import folder:', error);
            alert('Folder import not supported in this browser or cancelled');
        } finally {
            setIsImporting(false);
        }
    };

    const handleMatchLyrics = async (song: LocalSong) => {
        setMatchingLyricsFor(song.id);
        try {
            const lyrics = await matchLyrics(song);
            if (lyrics) {
                onRefresh();
            } else {
                // Show manual selection modal
                setSelectedSong(song);
                setShowMatchModal(true);
            }
        } catch (error) {
            console.error('Failed to match lyrics:', error);
        } finally {
            setMatchingLyricsFor(null);
        }
    };

    const handleDelete = async (song: LocalSong) => {
        if (!confirm(`Delete "${song.title || song.fileName}"?`)) return;

        try {
            await deleteLocalSong(song.id);
            onRefresh();
        } catch (error) {
            console.error('Failed to delete song:', error);
        }
    };

    const handleManualLyricMatch = () => {
        onRefresh();
        setShowMatchModal(false);
        setSelectedSong(null);
    };

    return (
        <div className="w-full h-full flex flex-col p-6 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold opacity-90">Local Music</h2>

                <div className="flex gap-3">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*"
                        multiple
                        onChange={handleFileImport}
                        className="hidden"
                    />

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting}
                        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {isImporting ? (
                            <Loader2 className="animate-spin" size={18} />
                        ) : (
                            <Upload size={18} />
                        )}
                        <span className="text-sm font-medium">Import Files</span>
                    </button>

                    <button
                        onClick={handleFolderImport}
                        disabled={isImporting}
                        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <FolderOpen size={18} />
                        <span className="text-sm font-medium">Import Folder</span>
                    </button>
                </div>
            </div>

            {/* Info Banner */}
            {localSongs.length > 0 && (
                <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm opacity-80">
                    <p className="text-blue-300">
                        <strong>提示：</strong>通过"选择文件"导入的文件在刷新页面后需要重新导入。建议使用"导入文件夹"功能以获得更好的体验（支持刷新后继续访问）。
                    </p>
                </div>
            )}

            {/* Song List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {localSongs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full opacity-50">
                        <Music size={64} className="mb-4" />
                        <p className="text-lg">No local music imported yet</p>
                        <p className="text-sm mt-2 opacity-60">Click "Import Files" or "Import Folder" to get started</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {localSongs.map((song, index) => (
                            <motion.div
                                key={song.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05 }}
                                className="group relative bg-white/5 hover:bg-white/10 rounded-xl overflow-hidden transition-all duration-300 border border-white/5 hover:border-white/10 hover:shadow-lg hover:shadow-black/20"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                {/* Cover Image */}
                                <div className="relative aspect-square w-full overflow-hidden bg-zinc-800">
                                    {song.matchedCoverUrl ? (
                                        <img
                                            src={song.matchedCoverUrl}
                                            alt={song.title || song.fileName}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                // Fallback to icon if image fails to load
                                                e.currentTarget.style.display = 'none';
                                                const parent = e.currentTarget.parentElement;
                                                if (parent) {
                                                    parent.innerHTML = '';
                                                    const icon = document.createElement('div');
                                                    icon.className = 'w-full h-full flex items-center justify-center';
                                                    icon.innerHTML = '<svg class="w-16 h-16 opacity-20" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
                                                    parent.appendChild(icon);
                                                }
                                            }}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
                                            <Disc size={48} className="opacity-20" />
                                        </div>
                                    )}
                                    
                                    {/* Play Button Overlay */}
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                                        <button
                                            onClick={() => onPlaySong(song)}
                                            className="w-16 h-16 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md flex items-center justify-center transition-all transform hover:scale-110"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <Play size={24} fill="currentColor" />
                                        </button>
                                    </div>

                                    {/* Lyrics Badge */}
                                    {song.matchedLyrics && (
                                        <div className="absolute top-2 right-2 px-2 py-1 bg-green-500/80 backdrop-blur-sm rounded-full text-xs font-medium text-white">
                                            ✓ Lyrics
                                        </div>
                                    )}
                                </div>

                                {/* Song Info */}
                                <div className="p-4">
                                    <div className="font-semibold text-base truncate mb-1" style={{ color: 'var(--text-primary)' }}>
                                        {song.title || song.fileName}
                                    </div>
                                    <div className="text-sm truncate mb-2" style={{ color: 'var(--text-secondary)' }}>
                                        {song.artist || 'Unknown Artist'}
                                    </div>
                                    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        <span>{formatTime(song.duration)}</span>
                                        <span className="opacity-60">{formatBytes(song.fileSize)}</span>
                                    </div>
                                </div>

                                {/* Actions Bar */}
                                <div className="px-4 pb-4 flex items-center gap-2">
                                    {!song.matchedLyrics && (
                                        <button
                                            onClick={() => handleMatchLyrics(song)}
                                            disabled={matchingLyricsFor === song.id}
                                            className="flex-1 px-3 py-2 text-xs bg-blue-500/20 hover:bg-blue-500/30 rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                                            style={{ color: 'var(--text-accent)' }}
                                        >
                                            {matchingLyricsFor === song.id ? (
                                                <>
                                                    <Loader2 className="animate-spin" size={12} />
                                                    <span>Matching...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Search size={12} />
                                                    <span>Match</span>
                                                </>
                                            )}
                                        </button>
                                    )}

                                    <button
                                        onClick={() => onPlaySong(song)}
                                        className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 rounded-lg transition-colors flex items-center gap-1.5"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        <Play size={12} fill="currentColor" />
                                        <span>Play</span>
                                    </button>

                                    <button
                                        onClick={() => handleDelete(song)}
                                        className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                                        style={{ color: 'var(--text-secondary)' }}
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>

            {/* Manual Lyric Match Modal */}
            {showMatchModal && selectedSong && (
                <LyricMatchModal
                    song={selectedSong}
                    onClose={() => {
                        setShowMatchModal(false);
                        setSelectedSong(null);
                    }}
                    onMatch={handleManualLyricMatch}
                />
            )}
        </div>
    );
};

export default LocalMusicView;
