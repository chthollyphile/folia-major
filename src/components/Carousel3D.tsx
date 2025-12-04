import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Carousel Item Component with safe blur animation
const CarouselItem: React.FC<{
    item: { id: number | string; name: string; coverUrl?: string; trackCount?: number; playCount?: number; description?: string; };
    distance: number;
    isActive: boolean;
    xOffset: number;
    scale: number;
    opacity: number;
    zIndex: number;
    rotateY: number;
    onSelect: () => void;
    onFocus: () => void;
}> = ({ item, distance, isActive, xOffset, scale, opacity, zIndex, rotateY, onSelect, onFocus }) => {
    const blurTarget = isActive ? 0 : 2;
    const blurMotion = useMotionValue(blurTarget);
    const blurString = useTransform(blurMotion, (value) => {
        const clamped = Math.max(0, Math.min(10, isNaN(value) || !isFinite(value) ? 0 : value));
        return `blur(${clamped}px)`;
    });

    useEffect(() => {
        const controls = animate(blurMotion, blurTarget, {
            type: 'spring',
            stiffness: 300,
            damping: 30
        });
        return () => controls.stop();
    }, [blurTarget, blurMotion]);

    return (
        <motion.div
            className="absolute cursor-pointer"
            initial={false}
            animate={{
                x: xOffset,
                scale: scale,
                opacity: opacity,
                zIndex: zIndex,
                rotateY: rotateY,
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{
                filter: blurString
            }}
            onClick={() => {
                if (isActive) onSelect();
                else onFocus();
            }}
        >
            <div className={`w-56 h-56 md:w-64 md:h-64 rounded-2xl overflow-hidden shadow-2xl relative transition-all duration-300 ${isActive ? 'ring-2 ring-white/30' : ''}`}>
                <img src={item.coverUrl?.replace('http:', 'https:')} alt={item.name} className="w-full h-full object-cover pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
            </div>
        </motion.div>
    );
};

interface Carousel3DProps {
    items: { id: number | string; name: string; coverUrl?: string; trackCount?: number; playCount?: number; description?: string; }[];
    onSelect: (item: any) => void;
    isLoading?: boolean;
    emptyMessage?: string;
    textBottomClass?: string;
}

const Carousel3D: React.FC<Carousel3DProps> = ({ items, onSelect, isLoading = false, emptyMessage = "No items", textBottomClass = "bottom-24" }) => {
    const { t } = useTranslation();
    const [focusedIndex, setFocusedIndex] = useState(0);
    const carouselRef = useRef<HTMLDivElement>(null);
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);
    const wheelTimeout = useRef<any>(null);

    // Touch Handling
    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.targetTouches[0].clientX;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        touchEndX.current = e.targetTouches[0].clientX;
    };

    const handleTouchEnd = () => {
        if (!touchStartX.current || !touchEndX.current) return;
        const diff = touchStartX.current - touchEndX.current;

        if (Math.abs(diff) > 50) {
            if (diff > 0) {
                if (focusedIndex < items.length - 1) setFocusedIndex(prev => prev + 1);
            } else {
                if (focusedIndex > 0) setFocusedIndex(prev => prev - 1);
            }
        }
        touchStartX.current = 0;
        touchEndX.current = 0;
    };

    // Wheel Handling
    useEffect(() => {
        const element = carouselRef.current;
        if (!element) return;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (wheelTimeout.current) clearTimeout(wheelTimeout.current);

            wheelTimeout.current = setTimeout(() => {
                const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
                if (Math.abs(delta) > 20) {
                    if (delta > 0) {
                        if (focusedIndex < items.length - 1) setFocusedIndex(prev => prev + 1);
                    } else {
                        if (focusedIndex > 0) setFocusedIndex(prev => prev - 1);
                    }
                }
            }, 150);
        };

        element.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            element.removeEventListener('wheel', handleWheel);
            if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
        };
    }, [focusedIndex, items.length]);

    // Keyboard Handling
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (focusedIndex > 0) setFocusedIndex(prev => prev - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (focusedIndex < items.length - 1) setFocusedIndex(prev => prev + 1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedIndex, items.length]);

    return (
        <div className="w-full h-full flex flex-col justify-center relative">
            {/* Decorative Line Behind */}
            <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-y-1/2 z-0" />

            {/* Center Focus Decoration */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-white/5 -z-10" />

            {/* Carousel Container */}
            <div
                ref={carouselRef}
                className="w-full h-[400px] relative flex items-center justify-center perspective-1000 touch-pan-y"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {isLoading ? (
                    <div className="opacity-50 flex flex-col items-center gap-4">
                        <Loader2 className="animate-spin" />
                        <span>{t('home.loadingLibrary')}</span>
                    </div>
                ) : items.length > 0 ? (
                    items.map((item, i) => {
                        if (Math.abs(focusedIndex - i) > 4) return null;

                        const distance = i - focusedIndex;
                        const isActive = distance === 0;

                        const scale = isActive ? 1.1 : 1 - Math.abs(distance) * 0.15;
                        const opacity = isActive ? 1 : 0.6 - Math.abs(distance) * 0.15;
                        const xOffset = distance * 240;
                        const zIndex = 10 - Math.abs(distance);
                        const rotateY = distance > 0 ? -15 : distance < 0 ? 15 : 0;

                        return (
                            <CarouselItem
                                key={item.id}
                                item={item}
                                distance={distance}
                                isActive={isActive}
                                xOffset={xOffset}
                                scale={scale}
                                opacity={opacity}
                                zIndex={zIndex}
                                rotateY={rotateY}
                                onSelect={() => onSelect(item)}
                                onFocus={() => setFocusedIndex(i)}
                            />
                        );
                    })
                ) : (
                    <div className="opacity-50 flex flex-col items-center gap-4">
                        <span>{emptyMessage}</span>
                    </div>
                )}
            </div>

            {/* Active Item Title - Static Layer Below */}
            {items.length > 0 && items[focusedIndex] && (
                <motion.div
                    key={items[focusedIndex].id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className={`absolute ${textBottomClass} left-0 right-0 text-center z-10 px-8 pointer-events-none`}
                >
                    <h3 className="font-bold text-2xl truncate max-w-xl mx-auto" style={{ color: 'var(--text-primary)' }}>
                        {items[focusedIndex].name}
                    </h3>
                    <p className="text-xs opacity-50 font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {items[focusedIndex].trackCount !== undefined ? `${items[focusedIndex].trackCount} songs` : ''}
                        {items[focusedIndex].description ? ` • ${items[focusedIndex].description}` : ''}
                    </p>
                </motion.div>
            )}
        </div>
    );
};

export default Carousel3D;
