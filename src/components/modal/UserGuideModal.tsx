import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSupportsFinePointer } from '../../hooks/useSupportsFinePointer';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { openCurrentPagePonder } from '../../services/ponder/pagePonderTarget';
import type { Theme } from '../../types';
import { PRIMARY_MODIFIER_LABEL } from '../../utils/platform';

// src/components/modal/UserGuideModal.tsx
// 版本后的旧帮助轮播已由 Ponder 取代。这个门只教入口；真正的页面说明在 Ponder 里完成。

export const UserGuideModal: React.FC<{ theme?: Theme | null }> = ({ theme }) => {
    const { t } = useTranslation();
    const isOpen = useSettingsModalStore(state => state.isUserGuideModalOpen);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const supportsFinePointer = useSupportsFinePointer();
    const accent = theme?.accentColor || (isDaylight ? '#18181b' : '#f4f4f5');

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    data-folia-keyboard-window="true"
                    data-testid="ponder-onboarding"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="ponder-onboarding-title"
                >
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0, y: 16 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.96, opacity: 0 }}
                        className={`w-full max-w-md rounded-[2rem] border p-8 text-center shadow-2xl ${
                            isDaylight ? 'border-zinc-200 bg-white text-zinc-900' : 'border-zinc-800 bg-[#18181b] text-zinc-50'
                        }`}
                    >
                        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-current/5" style={{ color: accent }}>
                            <Lightbulb size={26} aria-hidden="true" />
                        </span>
                        <h2 id="ponder-onboarding-title" className="text-2xl font-bold">
                            {t('ponder.onboarding.title')}
                        </h2>
                        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 opacity-65">
                            {t(supportsFinePointer ? 'ponder.onboarding.description' : 'ponder.onboarding.touchDescription', { mod: PRIMARY_MODIFIER_LABEL })}
                        </p>

                        {supportsFinePointer && (
                            <div className="mt-7 flex items-center justify-center gap-2" aria-label={t('ponder.onboarding.shortcut', { mod: PRIMARY_MODIFIER_LABEL })}>
                                <kbd className="rounded-lg border px-3 py-2 font-mono text-sm">{PRIMARY_MODIFIER_LABEL}</kbd>
                                <span className="opacity-40">+</span>
                                <kbd className="rounded-lg border px-3 py-2 font-mono text-sm">G</kbd>
                            </div>
                        )}

                        {/* 按钮始终在：这一步完不成就出不去，指针判断一旦错了，没有键盘的人只看到 Ctrl/Cmd+G 会被卡死。 */}
                        <button
                            type="button"
                            data-testid="ponder-onboarding-open-button"
                            onClick={openCurrentPagePonder}
                            className={`${supportsFinePointer ? 'mt-4' : 'mt-7'} inline-flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-medium transition-transform active:scale-95`}
                            style={{ borderColor: accent, color: accent }}
                        >
                            <Lightbulb size={17} aria-hidden="true" />
                            {t('ponder.openPage')}
                        </button>

                        <p className="mt-6 text-xs opacity-45">{t('ponder.onboarding.required')}</p>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
