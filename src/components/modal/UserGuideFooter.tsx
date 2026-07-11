import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// src/components/modal/UserGuideFooter.tsx

type UserGuideFooterProps = {
    page: number;
    pageCount: number;
    btnClass: string;
    secondaryBtnClass: string;
    backLabel: string;
    nextLabel: string;
    doneLabel: string;
    onBack: () => void;
    onNext: () => void;
};

const springTransition = {
    type: 'spring' as const,
    stiffness: 500,
    damping: 22,
    mass: 0.8,
};

export const UserGuideFooter: React.FC<UserGuideFooterProps> = ({
    page,
    pageCount,
    btnClass,
    secondaryBtnClass,
    backLabel,
    nextLabel,
    doneLabel,
    onBack,
    onNext,
}) => (
    <div className="flex justify-center gap-4 relative" style={{ minHeight: 48 }}>
        <AnimatePresence mode="popLayout">
            {page > 1 && (
                <motion.button
                    key="back"
                    layout
                    initial={{ opacity: 0, x: -40, scale: 0.85 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -40, scale: 0.85 }}
                    transition={springTransition}
                    onClick={onBack}
                    className={`py-3.5 px-8 rounded-full font-bold text-sm transition-colors ${secondaryBtnClass}`}
                >
                    {backLabel}
                </motion.button>
            )}
            <motion.button
                key="next"
                layout
                initial={{ opacity: 0, x: 30, scale: 0.85 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 30, scale: 0.85 }}
                transition={springTransition}
                onClick={onNext}
                className={`py-3.5 px-10 rounded-full font-bold text-sm transition-colors hover:scale-105 active:scale-95 ${btnClass}`}
            >
                {page === pageCount ? doneLabel : nextLabel}
            </motion.button>
        </AnimatePresence>
    </div>
);
