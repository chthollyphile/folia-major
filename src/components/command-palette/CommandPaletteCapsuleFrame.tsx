import React from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { CAPSULE_MORPH_DURATION_S, PANEL_OPEN_CLIP, capsuleClipPath, type CapsuleFrame } from './capsuleFrame';

// src/components/command-palette/CommandPaletteCapsuleFrame.tsx
// The palette grown up out of the player bar instead of dropped in from the top.
//
// Split out of CommandPalette like the inline frame: the panel and the pinned row are built there,
// once, for every frame; this file only places them over the bar and unfolds them from its shape.

type CommandPaletteCapsuleFrameProps = {
    /** The bar as it was when the palette opened: where the panel sits and what it unfolds from. */
    frame: CapsuleFrame;
    /** The bar as it is when the palette closes: what the panel folds back into. */
    exitFrame: CapsuleFrame;
    isOpen: boolean;
    hasClearBackdrop: boolean;
    backdropStyle: React.CSSProperties;
    onClose: () => void;
    /** Built by the palette with its 'above' placement. */
    pinnedRow: React.ReactNode;
    /** The palette's panel, input row last so it lands where the bar was. */
    panel: React.ReactNode;
    onOpened: () => void;
};

const MORPH_EASE = [0.22, 1, 0.36, 1] as const;

// Driven by `custom`: the opening clip is the bar at open, the closing one is passed through
// AnimatePresence so the exit reads the bar measured at close — the props an exiting child was last
// rendered with still hold the old shape.
const panelVariants: Variants = {
    start: (clip: string) => ({ clipPath: clip, opacity: 1 }),
    capsule: (clip: string) => ({
        clipPath: clip,
        // Fully there until the very end of the fold, so the bar taking over is a short crossfade in
        // one spot rather than a fade over the whole shrink.
        opacity: [1, 1, 0],
        transition: {
            clipPath: { duration: CAPSULE_MORPH_DURATION_S, ease: MORPH_EASE },
            opacity: { duration: CAPSULE_MORPH_DURATION_S, times: [0, 0.7, 1] },
        },
    }),
    open: {
        clipPath: PANEL_OPEN_CLIP,
        opacity: 1,
        transition: { clipPath: { duration: CAPSULE_MORPH_DURATION_S, ease: MORPH_EASE } },
    },
};

const CommandPaletteCapsuleFrame: React.FC<CommandPaletteCapsuleFrameProps> = ({
    frame,
    exitFrame,
    isOpen,
    hasClearBackdrop,
    backdropStyle,
    onClose,
    pinnedRow,
    panel,
    onOpened,
}) => (
    <AnimatePresence custom={capsuleClipPath(exitFrame)}>
        {isOpen && (
            <motion.div
                data-folia-keyboard-window="true"
                data-palette-frame="capsule"
                className={`fixed inset-0 z-[150] flex items-end justify-center px-4 ${hasClearBackdrop ? '' : 'backdrop-blur-md'}`}
                style={{ ...backdropStyle, paddingBottom: frame.bottomGap }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.2 } }}
                // The backdrop outlasts the panel folding back into the bar, or the fold plays out
                // half transparent and reads as a plain fade.
                exit={{ opacity: 0, transition: { duration: 0.3, ease: [0.7, 0, 1, 1] } }}
                onMouseDown={onClose}
            >
                <div className="w-full max-w-2xl" onMouseDown={(event) => event.stopPropagation()}>
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.18, delay: 0.08 }}
                    >
                        {pinnedRow}
                    </motion.div>
                    {/* Unfolds from the bar's own shape and folds back into it. Not a shared layoutId
                        across the two layers — the bar and the palette do not share a stacking
                        context, and the backdrop blur should not be recomputed under a scale. */}
                    <motion.div
                        custom={capsuleClipPath(frame)}
                        variants={panelVariants}
                        initial="start"
                        animate="open"
                        exit="capsule"
                        onAnimationComplete={(definition) => {
                            if (definition === 'open') {
                                onOpened();
                            }
                        }}
                    >
                        {panel}
                    </motion.div>
                </div>
            </motion.div>
        )}
    </AnimatePresence>
);

export default CommandPaletteCapsuleFrame;
