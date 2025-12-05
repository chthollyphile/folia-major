import React, { useMemo, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, MotionValue, useMotionValueEvent } from 'framer-motion';
import { X } from 'lucide-react';
import { LyricData } from '../types';

interface LyricsTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    lyrics: LyricData | null;
    duration: number;
    currentTime: MotionValue<number>;
    onSeek: (time: number) => void;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
}

const LyricsTimelineModal: React.FC<LyricsTimelineModalProps> = ({
    isOpen,
    onClose,
    lyrics,
    duration,
    currentTime,
    onSeek,
    primaryColor = 'var(--text-primary)',
    secondaryColor = 'var(--text-secondary)',
    accentColor = 'var(--text-accent)'
}) => {
    const [activeLineIndex, setActiveLineIndex] = useState(-1);
    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const activeItemRef = useRef<HTMLDivElement>(null);
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isAutoScrolling = useRef(false);

    // Track active line
    useMotionValueEvent(currentTime, "change", (latest) => {
        if (!lyrics || !lyrics.lines) return;
        const index = lyrics.lines.findIndex(line => latest >= line.startTime && latest <= line.endTime);
        if (index !== -1 && index !== activeLineIndex) {
            setActiveLineIndex(index);
        }
    });

    // Handle user scroll
    const handleScroll = () => {
        if (isAutoScrolling.current) {
            return;
        }
        setIsUserScrolling(true);

        // Clear existing timeout
        if (userScrollTimeoutRef.current) {
            clearTimeout(userScrollTimeoutRef.current);
        }

        // Set timeout to return to auto-scroll after 3 seconds
        userScrollTimeoutRef.current = setTimeout(() => {
            setIsUserScrolling(false);
        }, 3000);
    };

    // Auto-scroll to active lyric (only when not user scrolling)
    useEffect(() => {
        if (isUserScrolling) return;

        if (activeItemRef.current && scrollContainerRef.current && activeLineIndex !== -1) {
            // Clear any existing timeout
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }

            // Scroll immediately
            const container = scrollContainerRef.current;
            const activeItem = activeItemRef.current;

            if (container && activeItem) {
                const containerHeight = container.clientHeight;
                const itemOffsetTop = activeItem.offsetTop;
                const itemHeight = activeItem.clientHeight;

                // Scroll to center the active item
                const scrollTo = itemOffsetTop - (containerHeight / 2) + (itemHeight / 2);

                container.scrollTo({
                    top: scrollTo,
                    behavior: 'smooth'
                });

                // Allow some time for the scroll event to fire and be ignored
                isAutoScrolling.current = true;
                // Add a small timeout to clear the flag in case the scroll event doesn't fire (e.g. already at position)
                setTimeout(() => {
                    isAutoScrolling.current = false;
                }, 1000);
            }
        }

        // Cleanup
        return () => {
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, [activeLineIndex, isUserScrolling]);

    // Cleanup timeouts on unmount
    useEffect(() => {
        return () => {
            if (userScrollTimeoutRef.current) {
                clearTimeout(userScrollTimeoutRef.current);
            }
            if (scrollTimeoutRef.current) {
                clearTimeout(scrollTimeoutRef.current);
            }
        };
    }, []);

    // Initial scroll when modal opens
    useEffect(() => {
        if (isOpen && activeItemRef.current && scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const activeItem = activeItemRef.current;

            setTimeout(() => {
                const containerHeight = container.clientHeight;
                const itemOffsetTop = activeItem.offsetTop;
                const itemHeight = activeItem.clientHeight;

                const scrollTo = itemOffsetTop - (containerHeight / 2) + (itemHeight / 2);

                container.scrollTo({
                    top: scrollTo,
                    behavior: 'auto'
                });
            }, 100);
        }
    }, [isOpen]);

    // Generate vertical dot positions
    const dots = useMemo(() => {
        if (!lyrics || !lyrics.lines || duration <= 0) return [];

        return lyrics.lines.map((line, index) => {
            // Alternating left and right
            const isLeft = index % 2 === 0;

            return {
                ...line,
                id: index,
                isLeft
            };
        });
    }, [lyrics, duration]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="w-[90vw] max-w-4xl h-[80vh] bg-black/40 border border-white/10 rounded-2xl p-8 relative flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex justify-between items-center mb-8 flex-shrink-0">
                            <h2 className="text-2xl font-bold text-white/90">Timeline</h2>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                            >
                                <X size={24} className="text-white/70" />
                            </button>
                        </div>

                        {/* Scrollable Timeline Container */}
                        <div
                            ref={scrollContainerRef}
                            onScroll={handleScroll}
                            onTouchMove={handleScroll}
                            className="flex-1 overflow-y-auto overflow-x-hidden px-8 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
                            style={{
                                scrollbarWidth: 'thin',
                                scrollbarColor: 'rgba(255,255,255,0.2) transparent'
                            }}
                        >
                            {dots.length > 0 ? (
                                <div className="relative py-8">
                                    {/* Vertical Center Line */}
                                    <div
                                        className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2"
                                        style={{ backgroundColor: secondaryColor, opacity: 0.3 }}
                                    />

                                    {/* Dots and Lyrics */}
                                    {dots.map((dot, index) => {
                                        const isActive = index === activeLineIndex;
                                        const isLeft = dot.isLeft;

                                        return (
                                            <div
                                                key={dot.id}
                                                ref={isActive ? activeItemRef : null}
                                                className="relative w-full flex items-center mb-20"
                                                style={{ zIndex: isActive ? 20 : 1 }}
                                            >
                                                {/* Left side content */}
                                                <div className="w-1/2 flex justify-end pr-4 max-md:hidden">
                                                    {isLeft && (
                                                        <motion.div
                                                            animate={{
                                                                scale: isActive ? 1 : 0.85,
                                                                opacity: isActive ? 1 : 0.7
                                                            }}
                                                            transition={{ duration: 0.3 }}
                                                            className="max-w-[90%]"
                                                        >
                                                            <div
                                                                className="inline-block bg-black/60 backdrop-blur-xl border border-white/10 rounded-lg p-6 cursor-pointer hover:bg-black/70 transition-all"
                                                                onClick={() => {
                                                                    onSeek(dot.startTime);
                                                                }}
                                                            >
                                                                <div className="text-right">
                                                                    <p className={`text-white font-medium transition-all ${isActive ? 'text-base' : 'text-sm'
                                                                        }`}>
                                                                        {dot.fullText}
                                                                    </p>
                                                                    {dot.translation && (
                                                                        <p className={`text-white/60 mt-1 transition-all ${isActive ? 'text-sm' : 'text-xs'
                                                                            }`}>
                                                                            {dot.translation}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </div>

                                                {/* Center Dot */}
                                                <div className="flex-shrink-0 z-10">
                                                    <motion.div
                                                        animate={{
                                                            scale: isActive ? 1.5 : 1,
                                                            backgroundColor: isActive ? accentColor : secondaryColor,
                                                        }}
                                                        transition={{ duration: 0.3 }}
                                                        className="w-3 h-3 rounded-full cursor-pointer"
                                                        style={{
                                                            boxShadow: isActive ? `0 0 20px ${accentColor}` : 'none'
                                                        }}
                                                        onClick={() => {
                                                            onSeek(dot.startTime);
                                                        }}
                                                        whileHover={{ scale: isActive ? 1.7 : 1.3 }}
                                                    />
                                                </div>

                                                {/* Right side content */}
                                                <div className="w-1/2 flex justify-start pl-4 max-md:hidden">
                                                    {!isLeft && (
                                                        <motion.div
                                                            animate={{
                                                                scale: isActive ? 1 : 0.85,
                                                                opacity: isActive ? 1 : 0.7
                                                            }}
                                                            transition={{ duration: 0.3 }}
                                                            className="max-w-[90%]"
                                                        >
                                                            <div
                                                                className="inline-block bg-black/60 backdrop-blur-xl border border-white/10 rounded-lg p-6 cursor-pointer hover:bg-black/70 transition-all"
                                                                onClick={() => {
                                                                    onSeek(dot.startTime);
                                                                }}
                                                            >
                                                                <div className="text-left">
                                                                    <p className={`text-white font-medium transition-all ${isActive ? 'text-base' : 'text-sm'
                                                                        }`}>
                                                                        {dot.fullText}
                                                                    </p>
                                                                    {dot.translation && (
                                                                        <p className={`text-white/60 mt-1 transition-all ${isActive ? 'text-sm' : 'text-xs'
                                                                            }`}>
                                                                            {dot.translation}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </div>

                                                {/* Mobile layout - center overlay */}
                                                <motion.div
                                                    animate={{
                                                        scale: isActive ? 1 : 0.85,
                                                        opacity: isActive ? 1 : 0.7
                                                    }}
                                                    transition={{ duration: 0.3 }}
                                                    className="hidden max-md:block absolute left-1/2 -translate-x-1/2 w-[90%]"
                                                >
                                                    <div
                                                        className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-lg p-6 cursor-pointer hover:bg-black/70 transition-all"
                                                        onClick={() => {
                                                            onSeek(dot.startTime);
                                                        }}
                                                    >
                                                        <div className="text-center">
                                                            <p className={`text-white font-medium transition-all ${isActive ? 'text-base' : 'text-sm'
                                                                }`}>
                                                                {dot.fullText}
                                                            </p>
                                                            {dot.translation && (
                                                                <p className={`text-white/60 mt-1 transition-all ${isActive ? 'text-sm' : 'text-xs'
                                                                    }`}>
                                                                    {dot.translation}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-white/40">
                                    无歌词
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default LyricsTimelineModal;
