import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Repeat, Repeat1, ChartBar } from 'lucide-react';
import { MotionValue } from 'framer-motion';
import ProgressBar from './ProgressBar';
import { PlayerState, LyricData, Theme } from '../types';
import LyricsTimelineModal from './LyricsTimelineModal';

interface FloatingPlayerControlsProps {
    currentSong: { name: string; } | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    duration: number;
    loopMode: 'off' | 'all' | 'one';
    currentView: 'home' | 'player';
    audioSrc: string | null;
    lyrics: LyricData | null;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    onToggleLoop: () => void;
    onNavigateToPlayer: () => void;
    noTrackText?: string;
    primaryColor?: string;
    secondaryColor?: string;
    theme?: Theme;
}


const FloatingPlayerControls: React.FC<FloatingPlayerControlsProps> = ({
    currentSong,
    playerState,
    currentTime,
    duration,
    loopMode,
    currentView,
    audioSrc,
    lyrics,
    onSeek,
    onTogglePlay,
    onToggleLoop,
    onNavigateToPlayer,
    noTrackText = 'No Track',
    primaryColor = 'var(--text-primary)',
    secondaryColor = 'var(--text-secondary)',
    theme
}) => {
    const isDaylight = theme?.name === 'Daylight Default';
    const glassBgExpanded = isDaylight ? 'bg-white/60 border border-white/20 shadow-xl' : 'bg-black/40 border border-white/5';
    const glassBgCollapsed = isDaylight ? 'bg-white/40 border border-white/20 shadow-lg hover:bg-white/50' : 'bg-black/20 border border-white/5 hover:bg-black/30';
    const trackColor = isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)';
    // Button bg logic
    const buttonBg = isDaylight ? { backgroundColor: primaryColor, color: 'var(--bg-color)' } : { backgroundColor: primaryColor, color: 'var(--bg-color)' }; // Keep primary for play button, looks good

    // Other buttons hover
    const iconBtnExpandedClass = isDaylight ? 'hover:bg-black/5' : 'bg-white/20'; // Wait, loop button has logic
    const iconBtnClass = isDaylight ? 'hover:bg-black/5 text-black/60' : 'hover:bg-white/10 opacity-40 hover:opacity-100';

    const [isHovered, setIsHovered] = useState(false);
    const [isTimelineOpen, setIsTimelineOpen] = useState(false);

    const showExpanded = isHovered || (playerState !== PlayerState.PLAYING && currentView !== 'home');

    const handleClick = () => {
        if (currentView === 'home') {
            onNavigateToPlayer();
        }
    };

    return (
        <>
            <div
                className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-60 w-full flex justify-center transition-all duration-300 pointer-events-none
                    ${currentView === 'home' ? 'max-w-[calc(100vw-120px)] md:max-w-lg' : 'max-w-lg px-4'}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="pointer-events-auto w-full flex justify-center"
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                >
                    <motion.div
                        layout
                        onClick={handleClick}
                        className={`backdrop-blur-3xl shadow-2xl overflow-hidden cursor-pointer rounded-full relative transition-colors duration-300
                            ${showExpanded ? `p-3 ${glassBgExpanded} w-full` : `px-4 py-2 ${glassBgCollapsed} w-[80%] md:w-[60%]`}`}
                    >
                        <motion.div layout className="w-full">
                            {showExpanded ? (
                                <ExpandedView
                                    currentSong={currentSong}
                                    playerState={playerState}
                                    currentTime={currentTime}
                                    duration={duration}
                                    loopMode={loopMode}
                                    audioSrc={audioSrc}
                                    onSeek={onSeek}
                                    onTogglePlay={onTogglePlay}
                                    onToggleLoop={onToggleLoop}
                                    onToggleTimeline={() => setIsTimelineOpen(true)}
                                    noTrackText={noTrackText}
                                    primaryColor={primaryColor}
                                    secondaryColor={secondaryColor}
                                    trackColor={trackColor}
                                    hasLyrics={!!lyrics}
                                    isDaylight={isDaylight}
                                />
                            ) : (
                                <CollapsedView
                                    currentTime={currentTime}
                                    duration={duration}
                                    onSeek={onSeek}
                                    primaryColor={primaryColor}
                                    secondaryColor={secondaryColor}
                                    trackColor={trackColor}
                                />
                            )}
                        </motion.div>
                    </motion.div>
                </div>
            </div>

            <LyricsTimelineModal
                isOpen={isTimelineOpen}
                onClose={() => setIsTimelineOpen(false)}
                lyrics={lyrics}
                duration={duration}
                currentTime={currentTime}
                onSeek={onSeek}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
                accentColor="var(--text-accent)"
                theme={theme}
            />
        </>
    );
};

// 展开视图组件
interface ExpandedViewProps {
    currentSong: { name: string; } | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    duration: number;
    loopMode: 'off' | 'all' | 'one';
    audioSrc: string | null;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    onToggleLoop: () => void;
    onToggleTimeline: () => void;
    noTrackText: string;
    primaryColor: string;
    secondaryColor: string;
    hasLyrics: boolean;
    trackColor?: string;
    isDaylight?: boolean;
}

const ExpandedView: React.FC<ExpandedViewProps> = ({
    currentSong,
    playerState,
    currentTime,
    duration,
    loopMode,
    audioSrc,
    onSeek,
    onTogglePlay,
    onToggleLoop,
    onToggleTimeline,
    noTrackText,
    primaryColor,
    secondaryColor,
    hasLyrics,
    trackColor,
    isDaylight
}) => {
    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const [currentTimeValue, setCurrentTimeValue] = React.useState(0);

    React.useEffect(() => {
        const unsubscribe = currentTime.on('change', (latest) => {
            setCurrentTimeValue(latest);
        });
        return () => unsubscribe();
    }, [currentTime]);

    return (
        <>
            {/* Desktop Layout - hidden on mobile */}
            <div className="hidden sm:flex items-center gap-4 w-full">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onTogglePlay();
                    }}
                    disabled={!audioSrc}
                    className="w-12 h-12 rounded-full bg-(--text-primary) text-black flex items-center justify-center hover:scale-105 transition-transform shrink-0 shadow-lg border-none"
                    style={{ backgroundColor: primaryColor, color: 'var(--bg-color)' }}
                >
                    {playerState === PlayerState.PLAYING ? (
                        <Pause size={20} fill="currentColor" />
                    ) : (
                        <Play size={20} fill="currentColor" className="ml-1" />
                    )}
                </button>

                <div className="flex-1 flex flex-col justify-center gap-2 min-w-0 px-2">
                    <div className="text-center text-sm font-bold truncate px-2" style={{ color: primaryColor }}>
                        {currentSong?.name || noTrackText}
                    </div>

                    <div className="w-full px-2">
                        <ProgressBar
                            currentTime={currentTime}
                            duration={duration}
                            onSeek={onSeek}
                            primaryColor={primaryColor}
                            secondaryColor={secondaryColor}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleLoop();
                        }}
                        className={`p-2 rounded-full transition-colors ${loopMode !== 'off' ? (isDaylight ? 'bg-black/10 text-black' : 'bg-white/20') : 'opacity-40 hover:opacity-100'}`}
                        style={{ color: primaryColor }}
                    >
                        {loopMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleTimeline();
                        }}
                        disabled={!hasLyrics}
                        className={`p-2 rounded-full transition-colors ${!hasLyrics ? 'opacity-20 cursor-not-allowed' : `opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}`}
                        style={{ color: primaryColor }}
                        title="View Lyrics Timeline"
                    >
                        <ChartBar size={18} />
                    </button>
                </div>
            </div>

            {/* Mobile Layout - visible only on mobile */}
            <div className="sm:hidden flex flex-col gap-2 w-full">
                {/* Row 1: Centered Title */}
                <div className="text-center text-sm font-bold truncate px-2" style={{ color: primaryColor }}>
                    {currentSong?.name || noTrackText}
                </div>

                {/* Row 3: Loop Button, Play Button, Lyrics Button */}
                <div className="flex items-center justify-center gap-4">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleLoop();
                        }}
                        className={`p-2 rounded-full transition-colors ${loopMode !== 'off' ? 'bg-white/20' : 'opacity-40 hover:opacity-100'}`}
                        style={{ color: primaryColor }}
                    >
                        {loopMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onTogglePlay();
                        }}
                        disabled={!audioSrc}
                        className="w-12 h-12 rounded-full bg-(--text-primary) text-black flex items-center justify-center hover:scale-105 transition-transform shrink-0 shadow-lg border-none"
                        style={{ backgroundColor: primaryColor, color: 'var(--bg-color)' }}
                    >
                        {playerState === PlayerState.PLAYING ? (
                            <Pause size={20} fill="currentColor" />
                        ) : (
                            <Play size={20} fill="currentColor" className="ml-1" />
                        )}
                    </button>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleTimeline();
                        }}
                        disabled={!hasLyrics}
                        className={`p-2 rounded-full transition-colors ${!hasLyrics ? 'opacity-20 cursor-not-allowed' : `opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}`}
                        style={{ color: primaryColor }}
                        title="View Lyrics Timeline"
                    >
                        <ChartBar size={20} />
                    </button>
                </div>

                {/* Row 2: Current Time, Progress Bar, Duration */}
                <div className="flex items-center gap-2 w-full px-2">
                    <div className="flex-1">
                        <ProgressBar
                            currentTime={currentTime}
                            duration={duration}
                            onSeek={onSeek}
                            primaryColor={primaryColor}
                            secondaryColor={secondaryColor}
                        />
                    </div>
                </div>


            </div>
        </>
    );
};

// 折叠视图组件
interface CollapsedViewProps {
    currentTime: MotionValue<number>;
    duration: number;
    onSeek: (time: number) => void;
    primaryColor: string;
    secondaryColor: string;
    trackColor?: string;
}

const CollapsedView: React.FC<CollapsedViewProps> = ({
    currentTime,
    duration,
    onSeek,
    primaryColor,
    secondaryColor,
    trackColor
}) => {
    return (
        <div className="flex items-center w-full justify-center h-8 px-4">
            <ProgressBar
                currentTime={currentTime}
                duration={duration}
                onSeek={onSeek}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
                trackColor={trackColor}
            />
        </div>
    );
};

export default FloatingPlayerControls;

