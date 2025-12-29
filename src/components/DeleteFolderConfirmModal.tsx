import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DeleteFolderConfirmModalProps {
    isOpen: boolean;
    folderName: string;
    songCount: number;
    onConfirm: () => void;
    onCancel: () => void;
    isDaylight: boolean;
}

const DeleteFolderConfirmModal: React.FC<DeleteFolderConfirmModalProps> = ({
    isOpen,
    folderName,
    songCount,
    onConfirm,
    onCancel,
    isDaylight
}) => {
    const { t } = useTranslation();

    const bgClass = isDaylight ? 'bg-white/90 border-white/20' : 'bg-zinc-900/95 border-white/10';
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const closeBtnHover = isDaylight ? 'hover:bg-zinc-200/50' : 'hover:bg-white/10';
    const noteBg = isDaylight ? 'bg-blue-500/5 border-blue-500/10' : 'bg-blue-500/10 border-blue-500/20';
    const noteText = isDaylight ? 'text-blue-600' : 'text-blue-200';
    const cancelBtnBg = isDaylight ? 'bg-zinc-100/80 hover:bg-zinc-200 border-zinc-200' : 'bg-white/5 hover:bg-white/10 border-white/10';
    const cancelBtnText = isDaylight ? 'text-zinc-700' : 'text-white';

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4"
                    onClick={onCancel}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        className={`${bgClass} border rounded-3xl max-w-md w-full p-8 shadow-2xl backdrop-blur-md`}
                    >
                        {/* Close Button */}
                        <button
                            onClick={onCancel}
                            className={`absolute top-4 right-4 p-2 rounded-full transition-colors opacity-50 hover:opacity-100 ${closeBtnHover} ${textPrimary}`}
                        >
                            <X size={20} />
                        </button>

                        {/* Warning Icon */}
                        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
                            <AlertTriangle size={32} className="text-red-500" />
                        </div>

                        {/* Title */}
                        <h2 className={`text-2xl font-bold text-center mb-4 ${textPrimary}`}>
                            {t('localMusic.deleteFolderTitle')}
                        </h2>

                        {/* Description */}
                        <div className="space-y-3 mb-8">
                            <p className={`text-center ${textPrimary} opacity-80`}>
                                {t('localMusic.deleteFolderMessage', { folderName })}
                            </p>

                            <p className={`text-center text-sm ${textSecondary}`}>
                                {t('localMusic.deleteFolderCount', { count: songCount })}
                            </p>

                            {/* Important Notice */}
                            <div className={`${noteBg} border rounded-xl p-4 mt-4`}>
                                <p className={`text-sm text-center opacity-90 ${noteText}`}>
                                    {t('localMusic.deleteFolderNote')}
                                </p>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={onCancel}
                                className={`flex-1 py-3 px-6 rounded-full font-medium text-sm transition-colors border ${cancelBtnBg} ${cancelBtnText}`}
                            >

                                {t('localMusic.cancel')}
                            </button>
                            <button
                                onClick={() => {
                                    onConfirm();
                                    onCancel();
                                }}
                                className="flex-1 py-3 px-6 rounded-full font-medium text-sm transition-colors bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                            >

                                {t('localMusic.deleteFromLibrary')}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default DeleteFolderConfirmModal;
