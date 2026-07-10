import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

interface ThemedDialogProps {
    isOpen: boolean;
    onClose: () => void;
    isDaylight?: boolean;
    title: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidthClass?: string;
}

const ThemedDialog: React.FC<ThemedDialogProps> = ({
    isOpen,
    onClose,
    isDaylight = false,
    title,
    description,
    children,
    footer,
    maxWidthClass = 'max-w-md',
}) => {
    const bgClass = isDaylight ? 'bg-white/90 border-white/30' : 'bg-zinc-900/95 border-white/10';
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const closeBtnHover = isDaylight ? 'hover:bg-zinc-200/60' : 'hover:bg-white/10';
    const isMouseDownOnOverlayRef = useRef(false);

    const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        isMouseDownOnOverlayRef.current = event.target === event.currentTarget;
    };

    const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget && isMouseDownOnOverlayRef.current) {
            onClose();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    data-folia-keyboard-window="true"
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
                    onMouseDown={handleOverlayMouseDown}
                    onClick={handleBackdropClick}
                >
                    <motion.div
                        initial={{ scale: 0.94, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.94, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                        onClick={(event) => event.stopPropagation()}
                        className={`relative w-full ${maxWidthClass} rounded-3xl border ${bgClass} p-6 shadow-2xl backdrop-blur-sm`}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            className={`absolute right-4 top-4 rounded-full p-2 opacity-50 transition-colors hover:opacity-100 ${closeBtnHover} ${textPrimary}`}
                        >
                            <X size={18} />
                        </button>

                        <div className="mb-5 pr-10">
                            <h2 className={`text-xl font-bold ${textPrimary}`}>{title}</h2>
                            {description && (
                                <p className={`mt-2 text-sm ${textSecondary}`}>{description}</p>
                            )}
                        </div>

                        <div>{children}</div>

                        {footer && (
                            <div className="mt-5 flex items-center justify-end gap-3">
                                {footer}
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default ThemedDialog;
