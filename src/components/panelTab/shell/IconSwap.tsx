import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { kitTransition, useKitReducedMotion } from '../../modal/settings/kit/motion';

// src/components/panelTab/shell/IconSwap.tsx
// An icon that takes another one's place on the same button comes in a little small: a heart that
// was just filled, play turning into pause, a loop mode after the last one. The icon the button
// opens with does not move.

type IconSwapProps = {
    /** Names the icon that shows: a new name brings the new icon in. */
    name?: string;
    /** fast: the button answers a press. move: something it shows has changed. */
    speed?: 'fast' | 'move';
    /** The icon. */
    children: React.ReactNode;
};

export const IconSwap: React.FC<IconSwapProps> = ({ name, speed = 'fast', children }) => {
    const reduced = useKitReducedMotion();
    const hasShownRef = useRef(false);
    useEffect(() => {
        hasShownRef.current = true;
    }, []);

    return (
        <motion.span
            key={name}
            initial={hasShownRef.current ? { scale: 0.8, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={kitTransition(speed, reduced)}
            className="block"
        >
            {children}
        </motion.span>
    );
};

export default IconSwap;
