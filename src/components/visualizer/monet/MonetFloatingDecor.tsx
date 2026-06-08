import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import * as LucideIcons from 'lucide-react';
import type { Theme } from '../../../types';
import { colorWithAlpha } from '../colorMix';

// src/components/visualizer/monet/MonetFloatingDecor.tsx
// Renders gentle floating decorative particles for the Monet visualizer.
// Uses theme lyricsIcons (lucide) when available; falls back to cherry-blossom petals.

/** Simple SVG cherry-blossom petal used as fallback when no theme icons are provided. */
const SakuraPetal: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M12 3C14.5 5.5 16.8 9 16 14C15.2 19 13.5 21 12 21C10.5 21 8.8 19 8 14C7.2 9 9.5 5.5 12 3Z"
            fill={color}
        />
        <path
            d="M12 6C12 6 11.3 10.5 11.3 14.5C11.3 17.5 12 20 12 20"
            stroke={colorWithAlpha(color, 0.35)}
            strokeWidth="0.45"
            strokeLinecap="round"
        />
    </svg>
);

interface FloatingParticle {
    id: number;
    x: number;
    y: number;
    size: number;
    rotation: number;
    duration: number;
    delay: number;
    opacity: number;
    iconName: string | null;
    reverse: boolean;
}

interface MonetFloatingDecorProps {
    theme: Theme;
    staticMode?: boolean;
}

const PARTICLE_COUNT = 7;

/** Generates a stable set of floating particles seeded by the available icon list. */
const buildParticles = (availableIcons: string[]): FloatingParticle[] =>
    Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const useIcon = availableIcons.length > 0 && ((i * 37 + 11) % 100) > 40;
        return {
            id: i,
            x: ((i * 127 + 43) % 80) + 10,
            y: ((i * 211 + 17) % 80) + 5,
            size: 46 + ((i * 53) % 40),
            rotation: (i * 97) % 360,
            duration: 20 + ((i * 71) % 20),
            delay: ((i * 41) % 80) / 10,
            opacity: 0.06 + ((i * 31) % 12) / 100,
            iconName: useIcon
                ? availableIcons[(i * 67) % availableIcons.length]
                : null,
            reverse: i % 2 === 0,
        };
    });

const MonetFloatingDecor: React.FC<MonetFloatingDecorProps> = ({
    theme,
    staticMode = false,
}) => {
    const availableIcons = theme.lyricsIcons ?? [];

    const particles = useMemo(
        () => buildParticles(availableIcons),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [availableIcons.join(',')],
    );

    const petalColor = colorWithAlpha(theme.secondaryColor, 0.55);

    /** Resolves the visual element for a single particle. */
    const renderParticleContent = (p: FloatingParticle) => {
        if (p.iconName) {
            const Icon = LucideIcons[p.iconName as keyof typeof LucideIcons] as
                | LucideIcons.LucideIcon
                | undefined;
            if (Icon) {
                return <Icon size={p.size} strokeWidth={1} absoluteStrokeWidth color={theme.secondaryColor} />;
            }
        }
        return <SakuraPetal size={p.size} color={petalColor} />;
    };

    if (staticMode) {
        return (
            <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
                {particles.map(p => (
                    <div
                        key={p.id}
                        className="absolute"
                        style={{
                            left: `${p.x}%`,
                            top: `${p.y}%`,
                            opacity: p.opacity,
                            transform: `rotate(${p.rotation}deg)`,
                        }}
                    >
                        {renderParticleContent(p)}
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
            {particles.map(p => (
                <motion.div
                    key={p.id}
                    className="absolute"
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    animate={{
                        y: p.reverse ? [-40, 60, -20, 40, -40] : [40, -60, 20, -40, 40],
                        x: p.reverse ? [15, -25, 10, -20, 15] : [-15, 25, -10, 20, -15],
                        rotate: [p.rotation, p.rotation + (p.reverse ? -120 : 120), p.rotation + (p.reverse ? -60 : 60), p.rotation + (p.reverse ? -180 : 180), p.rotation],
                        opacity: [p.opacity * 0.6, p.opacity * 1.2, p.opacity, p.opacity * 1.3, p.opacity * 0.7],
                    }}
                    whileInView={undefined}
                    transition={{
                        duration: p.duration,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: p.delay,
                    }}
                >
                    {renderParticleContent(p)}
                </motion.div>
            ))}
        </div>
    );
};

export default MonetFloatingDecor;
