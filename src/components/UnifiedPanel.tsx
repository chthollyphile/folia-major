import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings2, X, Disc, SlidersHorizontal, ListMusic, User as UserIcon, Home as HomeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme } from '../types';
import CoverTab from './panelTab/CoverTab';
import ControlsTab from './panelTab/ControlsTab';
import QueueTab from './panelTab/QueueTab';
import AccountTab from './panelTab/AccountTab';

export type PanelTab = 'cover' | 'controls' | 'queue' | 'account';

interface UnifiedPanelProps {
    isOpen: boolean;
    currentTab: PanelTab;
    onTabChange: (tab: PanelTab) => void;
    onToggle: () => void;
    onNavigateHome: () => void;
    coverUrl: string | null;
    // Cover Tab Props
    currentSong: SongResult | null;
    onAlbumSelect: (albumId: number) => void;
    // Controls Tab Props
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
    // Queue Tab Props
    playQueue: SongResult[];
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement>;
    onShuffle: () => void;
    // Account Tab Props
    user: any; // NeteaseUser | null
    onLogout: () => void;
    audioQuality: 'exhigh' | 'lossless' | 'hires';
    onAudioQualityChange: (quality: 'exhigh' | 'lossless' | 'hires') => void;
    cacheSize: string;
    onClearCache: () => void;
    onSyncData: () => void;
    isSyncing: boolean;
}

const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
    isOpen,
    currentTab,
    onTabChange,
    onToggle,
    onNavigateHome,
    coverUrl,
    currentSong,
    onAlbumSelect,
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
    playQueue,
    onPlaySong,
    queueScrollRef,
    onShuffle,
    user,
    onLogout,
    audioQuality,
    onAudioQualityChange,
    cacheSize,
    onClearCache,
    onSyncData,
    isSyncing,
}) => {
    const { t } = useTranslation();

    const tabs = [
        { id: 'cover' as PanelTab, label: t('panel.cover'), icon: Disc },
        { id: 'controls' as PanelTab, label: t('panel.controls'), icon: SlidersHorizontal },
        { id: 'queue' as PanelTab, label: t('panel.playlist'), icon: ListMusic },
        { id: 'account' as PanelTab, label: t('panel.account'), icon: UserIcon },
    ];

    const handleCoverClick = () => {
        onToggle();
        onNavigateHome();
    };

    return (
        <div
            className="absolute bottom-8 right-0 z-[60] flex flex-col items-end gap-4 pointer-events-none"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="pointer-events-auto pr-4 md:pr-8 pb-16 md:pb-0">
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, originY: 1, originX: 1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="w-80 bg-black/40 backdrop-blur-3xl rounded-3xl shadow-2xl flex flex-col mb-2 overflow-hidden"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <div className="p-5 flex flex-col h-full">
                                {/* Top: Cover Art */}
                                <div
                                    onClick={handleCoverClick}
                                    className="w-full aspect-square rounded-2xl overflow-hidden shadow-lg relative mb-4 bg-zinc-900 flex items-center justify-center group cursor-pointer"
                                >
                                    {coverUrl ? (
                                        <img src={coverUrl} alt="Art" className="w-full h-full object-cover" />
                                    ) : (
                                        <Disc size={40} className="text-white/20" />
                                    )}
                                    {/* Overlay to switch visual */}
                                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
                                        <HomeIcon className="text-white" size={32} />
                                    </div>
                                </div>

                                {/* Tab Switcher */}
                                <div className="flex bg-white/5 p-1 rounded-xl mb-4">
                                    {tabs.map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => onTabChange(tab.id)}
                                            className={`flex-1 py-2 flex items-center justify-center transition-all rounded-lg
                                                ${currentTab === tab.id ? 'bg-white/10 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
                                            title={tab.label}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <tab.icon size={16} />
                                        </button>
                                    ))}
                                </div>

                                {/* Tab Content */}
                                <div
                                    className={`flex-1 overflow-hidden ${currentTab === 'cover' ? '' : 'min-h-[120px]'}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {currentTab === 'cover' && (
                                        <CoverTab
                                            currentSong={currentSong}
                                            onAlbumSelect={(albumId) => {
                                                onAlbumSelect(albumId);
                                                onToggle();
                                            }}
                                        />
                                    )}
                                    {currentTab === 'controls' && (
                                        <ControlsTab
                                            loopMode={loopMode}
                                            onToggleLoop={onToggleLoop}
                                            onLike={onLike}
                                            isLiked={isLiked}
                                            onGenerateAITheme={onGenerateAITheme}
                                            isGeneratingTheme={isGeneratingTheme}
                                            hasLyrics={hasLyrics}
                                            theme={theme}
                                            onThemeChange={onThemeChange}
                                            bgMode={bgMode}
                                            onBgModeChange={onBgModeChange}
                                            onResetTheme={onResetTheme}
                                            defaultTheme={defaultTheme}
                                        />
                                    )}
                                    {currentTab === 'queue' && (
                                        <QueueTab
                                            playQueue={playQueue}
                                            currentSong={currentSong}
                                            onPlaySong={onPlaySong}
                                            queueScrollRef={queueScrollRef}
                                            shouldScrollToCurrent={isOpen && currentTab === 'queue'}
                                            onShuffle={onShuffle}
                                        />
                                    )}
                                    {currentTab === 'account' && (
                                        <AccountTab
                                            user={user}
                                            onLogout={onLogout}
                                            audioQuality={audioQuality}
                                            onAudioQualityChange={onAudioQualityChange}
                                            cacheSize={cacheSize}
                                            onClearCache={onClearCache}
                                            onSyncData={onSyncData}
                                            isSyncing={isSyncing}
                                            onNavigateHome={() => {
                                                onToggle();
                                                onNavigateHome();
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Toggle Button */}
            <div className="pointer-events-auto fixed bottom-8 right-0 z-[60] pr-4 md:pr-8 group">
                <button
                    onClick={onToggle}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg backdrop-blur-md transform
                        translate-x-1/2 opacity-60 hover:translate-x-0 hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105 border-none
                        ${isOpen ? 'bg-white text-black translate-x-0 opacity-100' : 'bg-black/40 text-white'}`}
                >
                    {isOpen ? <X size={20} /> : <Settings2 size={20} />}
                </button>
            </div>
        </div>
    );
};

export default UnifiedPanel;

