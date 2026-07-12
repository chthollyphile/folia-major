import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { List, Search } from 'lucide-react';

// Player-style grid action button: click for the list, or slide left to reveal search.
interface GridListSearchButtonProps {
    isDaylight: boolean;
    accentColor: string;
    listTitle: string;
    searchTitle: string;
    onOpenList: () => void;
    onOpenSearch: () => void;
}

export const GridListSearchButton: React.FC<GridListSearchButtonProps> = ({
    isDaylight,
    accentColor,
    listTitle,
    searchTitle,
    onOpenList,
    onOpenSearch,
}) => {
    const [showGuideLine, setShowGuideLine] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const gestureRef = useRef<{ startX: number; startY: number; triggered: boolean } | null>(null);
    const suppressClickRef = useRef(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const trackEndIconRef = useRef<HTMLDivElement>(null);
    const trackFillRef = useRef<HTMLDivElement>(null);
    const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const motionClass = showGuideLine || isDragging
        ? 'translate-x-0 opacity-100'
        : supportsHover
            ? 'translate-x-1/2 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105'
            : 'translate-x-1/2 opacity-60';

    const setDestinationFeedback = (progress: number) => {
        const icon = trackEndIconRef.current;
        if (!icon) return;
        icon.style.opacity = String(0.35 + progress * 0.65);
        icon.style.transform = `scale(${1 + progress * 0.15}) rotate(${progress * 45}deg)`;
        icon.style.color = progress >= 1 ? accentColor : '';
    };

    const resetDestinationFeedback = () => {
        const icon = trackEndIconRef.current;
        if (!icon) return;
        icon.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out, color 150ms ease-out';
        icon.style.opacity = '0.35';
        icon.style.transform = 'scale(1) rotate(0deg)';
        icon.style.color = '';
    };

    const setDragFeedback = (deltaX: number) => {
        const button = buttonRef.current;
        if (!button) return;
        const dragX = Math.max(-44, Math.min(0, deltaX));
        const progress = Math.min(1, Math.abs(dragX) / 36);
        button.style.transition = 'none';
        button.style.transform = `translateX(${dragX}px)`;
        button.style.filter = `brightness(${1 + progress * 0.18})`;
        const listIcon = button.querySelector('svg');
        if (listIcon) {
            listIcon.style.transform = `rotate(${progress * -180}deg)`;
            listIcon.style.scale = String(1 - progress * 0.1);
        }
        if (progress >= 1) {
            button.style.backgroundColor = accentColor;
            button.style.color = '#ffffff';
            button.style.boxShadow = `0 0 16px ${accentColor}66, 0 18px 42px rgba(0, 0, 0, ${0.24 + progress * 0.16})`;
        } else {
            button.style.backgroundColor = '';
            button.style.color = '';
            button.style.boxShadow = `0 18px 42px rgba(0, 0, 0, ${0.24 + progress * 0.16})`;
        }
        const fill = trackFillRef.current;
        if (fill) {
            fill.style.transition = 'none';
            fill.style.width = `${48 + Math.abs(dragX)}px`;
            fill.style.backgroundColor = progress >= 1 ? accentColor : '';
            fill.style.opacity = progress >= 1 ? '0.35' : '';
        }
        if (trackEndIconRef.current) trackEndIconRef.current.style.transition = 'none';
        setDestinationFeedback(progress);
    };

    const resetDragFeedback = (mode: 'release' | 'trigger' = 'release', deltaX = 0) => {
        setIsDragging(false);
        const button = buttonRef.current;
        if (!button) return;
        const dragX = Math.max(-44, Math.min(0, deltaX));
        const fill = trackFillRef.current;
        const destination = trackEndIconRef.current;
        if (mode === 'trigger') {
            button.animate([
                { transform: `translateX(${dragX}px) scale(1)`, opacity: '1', filter: 'brightness(1.18)' },
                { transform: 'translateX(-80px) scale(0.8)', opacity: '0' },
            ], { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
            destination?.animate([
                { transform: 'scale(1.15) rotate(45deg)', opacity: '1' },
                { transform: 'translateX(-40px) scale(0.9) rotate(45deg)', opacity: '0' },
            ], { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
            fill?.animate([
                { width: `${48 + Math.abs(dragX)}px`, opacity: '0.35' },
                { width: '96px', opacity: '0' },
            ], { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        }
        resetDestinationFeedback();
        button.style.transition = mode === 'release' ? 'transform 160ms ease-out, filter 160ms ease-out, box-shadow 160ms ease-out, background-color 160ms ease-out, color 160ms ease-out' : '';
        button.style.transform = '';
        button.style.filter = '';
        button.style.boxShadow = '';
        button.style.backgroundColor = '';
        button.style.color = '';
        const listIcon = button.querySelector('svg');
        if (listIcon) {
            listIcon.style.transition = '';
            listIcon.style.transform = '';
            listIcon.style.scale = '';
        }
        if (fill) {
            fill.style.transition = '';
            fill.style.width = '48px';
            fill.style.backgroundColor = '';
            fill.style.opacity = '';
        }
    };

    const clearGesture = () => {
        gestureRef.current = null;
        resetDragFeedback();
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="pointer-events-auto fixed bottom-8 right-0 z-[60] pr-4 md:pr-8 group w-20 flex justify-end"
        >
            <div className={`relative w-12 h-12 transition-all duration-300 transform ${motionClass}`}>
                <div
                    style={{ width: '96px', transition: 'opacity 200ms ease-out' }}
                    className={`absolute right-0 top-0 h-12 rounded-full border pointer-events-none z-0 ${showGuideLine || isDragging ? 'opacity-100' : 'opacity-0'} ${isDaylight ? 'border-black/10 bg-black/5' : 'border-white/10 bg-white/5'}`}
                >
                    <motion.div
                        className="absolute left-3.5 top-[17px] w-3.5 h-3.5 pointer-events-none flex items-center justify-center"
                        animate={showGuideLine ? { x: [0, -4, 0], opacity: [0.45, 0.85, 0.45] } : { x: 0, opacity: 0.45 }}
                        transition={showGuideLine ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : undefined}
                    >
                        <div ref={trackEndIconRef} style={{ color: isDaylight ? '#000000' : '#ffffff' }} className="w-full h-full flex items-center justify-center" title={searchTitle}>
                            <Search size={14} />
                        </div>
                    </motion.div>
                    <div ref={trackFillRef} style={{ width: '48px' }} className={`absolute right-0 top-0 bottom-0 rounded-full pointer-events-none ${isDaylight ? 'bg-black/10' : 'bg-white/10'}`} />
                </div>
                <button
                    ref={buttonRef}
                    type="button"
                    onPointerDown={(event) => {
                        gestureRef.current = { startX: event.clientX, startY: event.clientY, triggered: false };
                        suppressClickRef.current = false;
                        setShowGuideLine(false);
                        setIsDragging(true);
                        setDragFeedback(0);
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const gesture = gestureRef.current;
                        if (!gesture || gesture.triggered) return;
                        const deltaX = event.clientX - gesture.startX;
                        const deltaY = event.clientY - gesture.startY;
                        setDragFeedback(deltaX);
                        if (deltaX <= -36 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
                            gesture.triggered = true;
                            suppressClickRef.current = true;
                            event.preventDefault();
                            resetDragFeedback('trigger', deltaX);
                            onOpenSearch();
                        }
                    }}
                    onPointerUp={clearGesture}
                    onPointerCancel={clearGesture}
                    onMouseEnter={() => { if (supportsHover) setShowGuideLine(true); }}
                    onMouseLeave={() => { if (supportsHover) setShowGuideLine(false); }}
                    onClick={(event) => {
                        if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                        }
                        onOpenList();
                    }}
                    style={{ touchAction: 'none' }}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg backdrop-blur-md transform border-none absolute right-0 top-0 z-10 ${isDaylight ? 'bg-white/70 text-zinc-900' : 'bg-black/40 text-white'}`}
                    title={listTitle}
                >
                    <List size={20} />
                </button>
            </div>
        </motion.div>
    );
};
