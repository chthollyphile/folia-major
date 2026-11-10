import type { Variants } from 'framer-motion';
import type { Theme } from '../../types';

// src/components/visualizer/glowWordVariants.ts
// classic / partita 的 GlowWord 用的 framer-motion variants：外层容器（位置 / 缩放 / 旋转）与正文层（颜色 / 模糊）。

/** An active word grows to its config scale times this; glowWordOverlap.ts reserves room for it. */
export const GLOW_WORD_ACTIVE_SCALE = 1.4;

// Container motion is the "body" of each word.
// waiting/active/passed all reuse the same layout config but interpret it differently.
export const buildGlowWordLayoutVariants = (
    animationIntensity: Theme['animationIntensity'],
    enableWordRotation = true,
): Variants => ({
    waiting: ({ config }: any) => ({
        opacity: 0,
        scale: 0.5,
        x: config.x + (Math.sin(config.y) * 100),
        y: config.y + (Math.cos(config.x) * 50),
        rotate: enableWordRotation ? config.rotate + 20 : 0,
        transition: { duration: 0.4 }
    }),
    active: ({ config }: any) => ({
        opacity: 1,
        scale: isNaN(config.scale) ? 1.5 : config.scale * GLOW_WORD_ACTIVE_SCALE,
        x: config.x,
        y: config.y,
        rotate: config.rotate,
        transition: {
            type: "spring" as const,
            stiffness: 200,
            damping: 20,
            opacity: { duration: 0.1 }
        }
    }),
    passed: ({ config, baseColor }: any) => ({
        opacity: animationIntensity === 'chaotic' ? 0.9 : 0.82,
        scale: config.scale || 1,
        x: config.x,
        y: config.y,
        rotate: config.rotate + config.passedRotate,
        transition: {
            duration: 0.5,
            rotate: {
                duration: 5,
                ease: "linear"
            }
        }
    })
});

// Body layer is where color transition and blur cleanup happen.
// Glow is separated so we can overdrive highlight without making the actual glyph unreadable.
export const glowWordBodyVariants: Variants = {
    waiting: ({ baseColor }: any) => ({
        color: baseColor,
        filter: "blur(10px)",
        transition: { duration: 0.4 }
    }),
    active: ({ activeColor, duration, wordRevealMode }: any) => ({
        color: activeColor,
        filter: "none",
        transition: {
            color: { duration: duration || 0.2, ease: "linear" },
            filter: { type: "tween", duration: wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.2 }
        },
        transitionEnd: {
            filter: "none"
        }
    }),
    passed: ({ baseColor, wordRevealMode }: any) => ({
        color: baseColor,
        filter: "blur(0px)",
        transition: {
            color: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.24 : 0.8, ease: "easeInOut" },
            filter: { duration: wordRevealMode === 'instant' ? 0.12 : wordRevealMode === 'fast' ? 0.2 : 0.5 }
        },
        transitionEnd: {
            filter: "none"
        }
    })
};
