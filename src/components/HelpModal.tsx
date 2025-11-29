import React from 'react';
import { X, Command, MousePointer2, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HelpModalProps {
    onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
    const { t } = useTranslation();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900/90 border border-white/10 p-8 rounded-3xl max-w-lg w-full relative shadow-2xl animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 opacity-30 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <X size={20} />
                </button>

                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    {t('help.title')}
                </h2>

                <div className="space-y-6">
                    {/* Navigation */}
                    <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                            <MousePointer2 size={14} /> {t('help.navigation')}
                        </h3>
                        <ul className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                            <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                <span>{t('help.switchPlaylist')}</span>
                                <span className="opacity-60">{t('help.scrollSwipe')}</span>
                            </li>
                            <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                <span>{t('help.selectPlaylist')}</span>
                                <span className="opacity-60">{t('help.clickTapCenter')}</span>
                            </li>
                        </ul>
                    </div>

                    {/* Shortcuts */}
                    <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                            <Keyboard size={14} /> {t('help.keyboardShortcuts')}
                        </h3>
                        <ul className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                            <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                <span>{t('help.navigatePlaylists')}</span>
                                <div className="flex gap-1">
                                    <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">←</kbd>
                                    <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">→</kbd>
                                </div>
                            </li>
                        </ul>
                    </div>

                    {/* Player Controls */}
                    <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                            <Keyboard size={14} /> {t('help.playerControls')}
                        </h3>
                        <ul className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                            <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                <span>{t('help.playPause')}</span>
                                <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Space</kbd>
                            </li>
                            <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                <span>{t('help.seekBackward')}</span>
                                <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">←</kbd>
                            </li>
                            <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                <span>{t('help.seekForward')}</span>
                                <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">→</kbd>
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Footer / Author Info */}
                <div className="mt-8 pt-6 border-t border-white/10 text-center">
                    <p className="text-sm opacity-60 mb-1" style={{ color: 'var(--text-secondary)' }}>
                        {t('help.madeBy')} <a href="https://github.com/chthollyphile" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors underline decoration-white/30 hover:decoration-white">chthollyphile</a>
                    </p>
                    <p className="text-xs font-mono opacity-30" style={{ color: 'var(--text-secondary)' }}>
                        {t('help.version')}: folia-major - {__COMMIT_HASH__}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default HelpModal;
