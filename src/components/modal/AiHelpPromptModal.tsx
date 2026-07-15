import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';

// src/components/modal/AiHelpPromptModal.tsx

const FOLIA_GUIDE_URL = 'https://folia-site.cielaniska.top/guide/llm-routing';
const FOLIA_REPOSITORY_URL = 'https://github.com/chthollyphile/folia-major';

type AiHelpPromptModalProps = {
    isOpen: boolean;
    isDaylight: boolean;
    theme?: Theme;
    onClose: () => void;
    onCopyText: (text: string) => Promise<void>;
};

export const AiHelpPromptModal: React.FC<AiHelpPromptModalProps> = ({
    isOpen,
    isDaylight,
    theme,
    onClose,
    onCopyText,
}) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const prompt = useMemo(() => t('aiHelp.prompt', {
        guideUrl: FOLIA_GUIDE_URL,
        repoUrl: FOLIA_REPOSITORY_URL,
        defaultValue: [
            'I am using Folia and need help with a problem.',
            '',
            `Folia Guide: ${FOLIA_GUIDE_URL}`,
            `Folia repository: ${FOLIA_REPOSITORY_URL}`,
            '',
            'Please read these references as context, then help me understand and solve the problem I describe next. Ask for any missing details before making assumptions, and give me steps I can try safely.'
        ].join('\n')
    }), [t]);

    const bgClass = isDaylight ? 'bg-white border-zinc-200' : 'bg-[#18181b] border-zinc-800';
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-zinc-50';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const panelBg = isDaylight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/[0.04] border-white/10';
    const primaryBtnClass = isDaylight
        ? 'bg-zinc-900 text-white hover:bg-zinc-700'
        : 'bg-white text-zinc-950 hover:bg-zinc-200';
    const secondaryBtnClass = isDaylight
        ? 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
        : 'border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white';

    const handleCopyPrompt = async () => {
        try {
            await onCopyText(prompt);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch (error) {
            console.error('Failed to copy AI help prompt:', error);
            setCopied(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0, y: 16 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.96, opacity: 0, y: 8 }}
                        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
                        onClick={(event) => event.stopPropagation()}
                        className={`${bgClass} ${textPrimary} relative w-full max-w-lg overflow-hidden rounded-[1.5rem] border p-6 shadow-2xl`}
                    >
                        <div
                            className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full blur-[72px]"
                            style={{ backgroundColor: theme?.accentColor ?? '#60a5fa', opacity: isDaylight ? 0.2 : 0.12 }}
                        />



                        <div className="relative z-10 space-y-5">
                            <div className="pr-10">
                                <h2 className="text-xl font-semibold">{t('aiHelp.title', 'Need help?')}</h2>
                                <p className={`mt-2 text-sm leading-6 ${textSecondary}`}>
                                    {t('aiHelp.description', 'Describe your issue on the official site of the AI model you use, then paste this prompt so it knows where to find Folia docs and source context.')}
                                </p>
                            </div>

                            <div className={`rounded-xl border p-4 ${panelBg}`}>
                                <pre className={`max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 ${textSecondary}`}>
                                    {prompt}
                                </pre>
                            </div>

                            <div className={`rounded-xl border p-3 text-sm leading-6 ${panelBg} ${textSecondary}`}>
                                {t('aiHelp.usageHint', 'How to use it: open the AI model site you normally use, write your specific problem first, then paste this prompt below your question.')}
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${secondaryBtnClass}`}
                                >
                                    {t('common.cancel', 'Cancel')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleCopyPrompt()}
                                    className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${primaryBtnClass}`}
                                >
                                    {copied ? <Check size={16} /> : <Copy size={16} />}
                                    {copied ? t('status.copied', 'Copied') : t('aiHelp.copyPrompt', 'Copy prompt')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
