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
            extractColors(coverUrl, 10).then((extracted) => {
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

    // Increased blob count to 5 with better random distribution
    const blobs = useMemo(() => {
        // Use a seeded random for more varied distribution
        const seed = Date.now();
        const seededRandom = (offset: number) => {
            const x = Math.sin(seed + offset * 12345) * 10000;
            return x - Math.floor(x);
        };

        return Array.from({ length: 5 }).map((_, i) => ({
            id: i,
            size: 20 + seededRandom(i * 3) * 40, // 20-60vw varied sizes
            x: seededRandom(i * 7) * 100, // Random 0-90vw
            y: seededRandom(i * 11) * 100, // Random 0-90vh
        }));
    }, []);

    const getBlobColor = (index: number) => {
        if (colors.length === 0) return 'rgba(255,255,255,0.1)';
        return colors[index % colors.length];
    };

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            <div className="absolute inset-0 w-full h-full opacity-60" style={{ filter: 'blur(80px)' }}>
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
                                    left: `${blob.x}%`,
                                    top: `${blob.y}%`,
                                    backgroundColor: color,
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
