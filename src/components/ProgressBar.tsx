import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { MotionValue, useMotionValueEvent } from 'framer-motion';

interface ProgressBarProps {
    currentTime: MotionValue<number>;
    duration: number;
    onSeek: (time: number) => void;
    onSeekStart?: () => void;
    onSeekEnd?: () => void;
    primaryColor?: string;
    secondaryColor?: string;
}

const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const ProgressBar: React.FC<ProgressBarProps> = ({
    currentTime,
    duration,
    onSeek,
    onSeekStart,
    onSeekEnd,
    primaryColor = 'white',
    secondaryColor = 'rgba(255,255,255,0.5)'
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const [localValue, setLocalValue] = useState(0);

    const progressRef = useRef<HTMLDivElement>(null);
    const timeRef = useRef<HTMLSpanElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isDraggingRef = useRef(false);

    // Keep ref in sync with state
    useEffect(() => {
        isDraggingRef.current = isDragging;
    }, [isDragging]);

    // Helper function to update UI
    const updateUI = (value: number, skipDragCheck = false) => {
        if (!skipDragCheck && isDraggingRef.current) return;

        // Update Progress Bar Width
        if (progressRef.current) {
            const percent = duration > 0 ? (value / duration) * 100 : 0;
            progressRef.current.style.width = `${percent}%`;
        }

        // Update Time Text
        if (timeRef.current) {
            timeRef.current.innerText = formatTime(value);
        }

        // Update Input Value
        if (inputRef.current) {
            inputRef.current.value = value.toString();
        }
    };

    // Initialize UI with current value on mount (useLayoutEffect to sync before paint)
    useLayoutEffect(() => {
        const initialValue = currentTime.get();
        updateUI(initialValue, true); // Skip drag check on mount
    }, []); // Only run on mount

    // Re-sync when duration changes
    useEffect(() => {
        const currentValue = currentTime.get();
        updateUI(currentValue, true); // Skip drag check when duration changes
    }, [duration]);

    // Update UI directly from MotionValue without re-rendering
    useMotionValueEvent(currentTime, "change", (latest) => {
        updateUI(latest);
    });

    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
        const val = Number(e.currentTarget.value);
        setLocalValue(val);

        // Immediate visual feedback
        if (progressRef.current) {
            const percent = duration > 0 ? (val / duration) * 100 : 0;
            progressRef.current.style.width = `${percent}%`;
        }
        if (timeRef.current) {
            timeRef.current.innerText = formatTime(val);
        }
    };

    return (
        <div className="flex items-center gap-3 w-full">
            <span
                ref={timeRef}
                className="text-[10px] font-mono font-medium opacity-60 w-8 text-right"
                style={{ color: secondaryColor }}
            >
                00:00
            </span>

            <div className="relative h-1.5 flex-1 bg-white/10 rounded-full flex items-center group cursor-pointer">
                <div
                    ref={progressRef}
                    className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
                    style={{ width: '0%', backgroundColor: primaryColor }}
                />
                <input
                    ref={inputRef}
                    type="range"
                    min={0} max={duration || 100}
                    step={0.1}
                    defaultValue={0}
                    onMouseDown={() => {
                        setIsDragging(true);
                        onSeekStart?.();
                    }}
                    onTouchStart={() => {
                        setIsDragging(true);
                        onSeekStart?.();
                    }}
                    onInput={handleInput}
                    onChange={() => { }} // React requires this
                    onMouseUp={(e) => {
                        setIsDragging(false);
                        onSeek(Number(e.currentTarget.value));
                        onSeekEnd?.();
                    }}
                    onTouchEnd={(e) => {
                        setIsDragging(false);
                        onSeek(Number(e.currentTarget.value));
                        onSeekEnd?.();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
            </div>

            <span className="text-[10px] font-mono font-medium opacity-60 w-8" style={{ color: secondaryColor }}>
                {formatTime(duration)}
            </span>
        </div>
    );
};

export default ProgressBar;
