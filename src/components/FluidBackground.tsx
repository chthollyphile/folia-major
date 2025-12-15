import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { extractColors } from '../utils/colorExtractor';
import { Theme } from '../types';

interface FluidBackgroundProps {
    coverUrl?: string | null;
    theme: Theme;
}

const FluidBackground: React.FC<FluidBackgroundProps> = ({ coverUrl, theme }) => {
    const [colors, setColors] = useState<string[]>([]);

    useEffect(() => {
        if (coverUrl) {
            extractColors(coverUrl, 5).then((extracted) => {
                if (extracted.length > 0) {
                    setColors(extracted);
                } else {
                    setColors([theme.primaryColor, theme.secondaryColor, theme.accentColor]);
                }
            });
        } else {
            setColors([theme.primaryColor, theme.secondaryColor, theme.accentColor]);
        }
    }, [coverUrl, theme]);

    // Reduced blob count to 3 for performance
    const blobs = useMemo(() => {
        return Array.from({ length: 3 }).map((_, i) => ({
            id: i,
            size: 60, // Percentage width
            initialX: Math.random() * 80 + 10,
            initialY: Math.random() * 80 + 10,
            duration: 20 + Math.random() * 10, // Slower
            delay: Math.random() * 5,
        }));
    }, []);

    const getBlobColor = (index: number) => {
        if (colors.length === 0) return 'rgba(255,255,255,0.1)';
        return colors[index % colors.length];
    };

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {/* Removed global blur filter which kills CPU */}
            <div className="absolute inset-0 w-full h-full opacity-60">
                <AnimatePresence>
                    {blobs.map((blob, i) => {
                        const color = getBlobColor(i);
                        return (
                            <motion.div
                                key={blob.id}
                                className="absolute rounded-full"
                                style={{
                                    width: `${blob.size}vw`,
                                    height: `${blob.size}vw`,
                                    left: `${blob.initialX}%`,
                                    top: `${blob.initialY}%`,
                                    // Use radial gradient to simulate blur CHEAPLY
                                    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
                                    opacity: 0.8,
                                    transform: 'translate(-50%, -50%)',
                                }}
                            />
                        );
                    })}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default FluidBackground;
