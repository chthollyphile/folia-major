import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Repeat, Repeat1 } from 'lucide-react';
import { MotionValue } from 'framer-motion';
import ProgressBar from './ProgressBar';
import { PlayerState } from '../types';

interface FloatingPlayerControlsProps {
    currentSong: { name: string } | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    duration: number;
    loopMode: 'off' | 'all' | 'one';
    currentView: 'home' | 'player';
    audioSrc: string | null;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    onToggleLoop: () => void;
    onNavigateToPlayer: () => void;
    noTrackText?: string;
    primaryColor?: string;
    secondaryColor?: string;
}

const FloatingPlayerControls: React.FC<FloatingPlayerControlsProps> = ({
    currentSong,
    playerState,
    currentTime,
    duration,
    loopMode,
    currentView,
    audioSrc,
    onSeek,
    onTogglePlay,
    onToggleLoop,
    onNavigateToPlayer,
    noTrackText = 'No Track',
    primaryColor = 'var(--text-primary)',
    secondaryColor = 'var(--text-secondary)'
}) => {
    const [isHovered, setIsHovered] = useState(false);
    
    const showExpanded = isHovered || (playerState !== PlayerState.PLAYING && currentView !== 'home');

    const handleClick = () => {
        if (currentView === 'home') {
            onNavigateToPlayer();
        }
    };

    return (
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
                        ${showExpanded ? 'p-3 bg-black/40 w-full' : 'px-4 py-2 bg-black/20 hover:bg-black/30 w-[80%] md:w-[60%]'}`}
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
                                noTrackText={noTrackText}
                                primaryColor={primaryColor}
                                secondaryColor={secondaryColor}
                            />
                        ) : (
                            <CollapsedView
                                currentTime={currentTime}
                                duration={duration}
                                onSeek={onSeek}
                                primaryColor={primaryColor}
                                secondaryColor={secondaryColor}
                            />
                        )}
                    </motion.div>
                </motion.div>
            </div>
        </div>
    );
};

// 展开视图组件
interface ExpandedViewProps {
    currentSong: { name: string } | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    duration: number;
    loopMode: 'off' | 'all' | 'one';
    audioSrc: string | null;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    onToggleLoop: () => void;
    noTrackText: string;
    primaryColor: string;
    secondaryColor: string;
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
    noTrackText,
    primaryColor,
    secondaryColor
}) => {
    return (
        <div className="flex items-center gap-4 w-full">
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

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleLoop();
                }}
                className={`p-2 rounded-full transition-colors ${loopMode !== 'off' ? 'bg-white/20' : 'opacity-40 hover:opacity-100'}`}
                style={{ color: primaryColor }}
            >
                {loopMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
        </div>
    );
};

// 折叠视图组件
interface CollapsedViewProps {
    currentTime: MotionValue<number>;
    duration: number;
    onSeek: (time: number) => void;
    primaryColor: string;
    secondaryColor: string;
}

const CollapsedView: React.FC<CollapsedViewProps> = ({
    currentTime,
    duration,
    onSeek,
    primaryColor,
    secondaryColor
}) => {
    return (
        <div className="flex items-center w-full justify-center h-8 px-4">
            <ProgressBar
                currentTime={currentTime}
                duration={duration}
                onSeek={onSeek}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
            />
        </div>
    );
};

export default FloatingPlayerControls;

