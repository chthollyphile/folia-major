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
}

const DeleteFolderConfirmModal: React.FC<DeleteFolderConfirmModalProps> = ({
    isOpen,
    folderName,
    songCount,
    onConfirm,
    onCancel
}) => {
    const { t } = useTranslation();

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
                        className="bg-zinc-900/95 border border-white/10 rounded-3xl max-w-md w-full p-8 shadow-2xl"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {/* Close Button */}
                        <button
                            onClick={onCancel}
                            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 transition-colors opacity-50 hover:opacity-100"
                        >
                            <X size={20} />
                        </button>

                        {/* Warning Icon */}
                        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
                            <AlertTriangle size={32} className="text-red-500" />
                        </div>

                        {/* Title */}
                        <h2 className="text-2xl font-bold text-center mb-4">
                            Delete Folder?
                        </h2>

                        {/* Description */}
                        <div className="space-y-3 mb-8">
                            <p className="text-center opacity-80">
                                You are about to remove <span className="font-semibold">"{folderName}"</span> from your library.
                            </p>

                            <p className="text-center opacity-60 text-sm">
                                This will remove <span className="font-semibold">{songCount}</span> {songCount === 1 ? 'song' : 'songs'} from your library.
                            </p>

                            {/* Important Notice */}
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mt-4">
                                <p className="text-sm text-center opacity-90">
                                    <span className="font-semibold">Note:</span> This will only remove songs from your library. Your files on disk will not be affected.
                                </p>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={onCancel}
                                className="flex-1 py-3 px-6 rounded-full font-medium text-sm transition-colors bg-white/5 hover:bg-white/10 border border-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    onConfirm();
                                    onCancel();
                                }}
                                className="flex-1 py-3 px-6 rounded-full font-medium text-sm transition-colors bg-red-500 hover:bg-red-600 text-white"
                            >
                                Delete from Library
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default DeleteFolderConfirmModal;
