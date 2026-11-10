import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Theme } from '../../../types';
import { useLucideIcons } from '../../../hooks/useLucideIcons';
import { getLucideIconStatus, resolveLucideIcon } from '../../../services/lucideIconResolver';

// src/components/visualizer/monet/MonetFloatingDecor.tsx
// Renders gentle floating decorative particles for the Monet visualizer: the theme's lyricsIcons
// (lucide). A theme without icons has none.

interface FloatingParticle {
    id: number;
    x: number;
    y: number;
    size: number;
    rotation: number;
    duration: number;
    delay: number;
    opacity: number;
    iconName: string;
    reverse: boolean;
}

interface MonetFloatingDecorProps {
    theme: Theme;
    staticMode?: boolean;
}

const PARTICLE_COUNT = 10;

/** Generates a stable set of floating particles seeded by the available icon list; some slots stay empty. */
const buildParticles = (availableIcons: string[]): FloatingParticle[] =>
    Array.from({ length: PARTICLE_COUNT }, (_, i) => i)
        .filter(i => availableIcons.length > 0 && ((i * 37 + 11) % 100) > 20)
        .map(i => ({
            id: i,
            x: ((i * 127 + 43) % 80) + 10,
            y: ((i * 211 + 17) % 80) + 5,
            size: 46 + ((i * 53) % 40),
            rotation: (i * 97) % 360,
            duration: 20 + ((i * 71) % 20),
            delay: ((i * 41) % 80) / 10,
            opacity: 0.06 + ((i * 31) % 12) / 100,
            iconName: availableIcons[i % availableIcons.length],
            reverse: i % 2 === 0,
        }));

const MonetFloatingDecor: React.FC<MonetFloatingDecorProps> = ({
    theme,
    staticMode = false,
}) => {
    const availableIcons = theme.lyricsIcons ?? [];
    useLucideIcons(availableIcons);

    const particles = useMemo(
        () => buildParticles(availableIcons),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [availableIcons.join(',')],
    );

    /** Resolves the visual element for a single particle: nothing while its chunk loads or for an unknown name. */
    const renderParticleContent = (p: FloatingParticle) => {
        if (getLucideIconStatus(p.iconName) === 'loading') return null;
        const Icon = resolveLucideIcon(p.iconName);
        return Icon ? <Icon size={p.size} strokeWidth={1} absoluteStrokeWidth color={theme.secondaryColor} /> : null;
    };

    if (particles.length === 0) {
        return null;
    }

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
