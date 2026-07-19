import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, LogIn, UserRound } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';

// src/components/app/home/OnlineProviderSwitcher.tsx

type OnlineProviderSwitcherProps = {
    providers: ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
    isDaylight: boolean;
    onSelect: (provider: ProviderAccountSummary) => void;
    onBackToPlayer: () => void;
};

const ProviderAvatar = ({ provider, className }: { provider: ProviderAccountSummary; className: string }) => (
    provider.user?.avatarUrl
        ? <img src={provider.user.avatarUrl.replace(/^http:/, 'https:')} alt={provider.user.nickname} className={`${className} object-cover`} />
        : (
            <span
                aria-label={provider.displayName}
                className={`${className} flex items-center justify-center font-black text-white ${provider.providerId === 'netease' ? 'bg-red-600' : 'bg-blue-600'}`}
            >
                {provider.providerId === 'netease' ? '云' : provider.providerId === 'kugou' ? 'K' : <UserRound size={20} />}
            </span>
        )
);

const OnlineProviderSwitcher: React.FC<OnlineProviderSwitcherProps> = ({
    providers,
    activeProviderId,
    isDaylight,
    onSelect,
    onBackToPlayer,
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [showProviderLabel, setShowProviderLabel] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const previousProviderIdRef = useRef(activeProviderId);
    const activeProvider = providers.find(provider => provider.providerId === activeProviderId) || providers[0];
    const surfaceClass = isDaylight ? 'bg-white/70 text-zinc-900' : 'bg-black/40 text-white';

    useEffect(() => {
        if (previousProviderIdRef.current === activeProviderId) return;
        previousProviderIdRef.current = activeProviderId;
        setShowProviderLabel(true);
        const hideTimer = window.setTimeout(() => setShowProviderLabel(false), 1800);
        return () => window.clearTimeout(hideTimer);
    }, [activeProviderId]);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    if (!activeProvider) return null;

    return (
        <div ref={rootRef} className="pointer-events-auto absolute bottom-6 right-6 z-[100]">
            <div className={`flex items-center rounded-full p-1.5 shadow-lg backdrop-blur-md ${surfaceClass}`}>
                <button
                    type="button"
                    onClick={() => setOpen(value => !value)}
                    className={`flex items-center rounded-full py-1 pl-1 transition-all ${showProviderLabel ? 'gap-2 pr-3' : 'gap-0 pr-1'} ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
                    title={t('home.switchOnlineProvider')}
                    aria-label={t('home.switchOnlineProvider')}
                    aria-haspopup="menu"
                    aria-expanded={open}
                >
                    <ProviderAvatar provider={activeProvider} className="h-10 w-10 shrink-0 rounded-full" />
                    <AnimatePresence initial={false}>
                        {showProviderLabel && (
                            <motion.span
                                initial={{ width: 0, opacity: 0 }}
                                animate={{ width: 'auto', opacity: 1 }}
                                exit={{ width: 0, opacity: 0 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="max-w-16 overflow-hidden whitespace-nowrap text-xs font-semibold"
                            >
                                {activeProvider.shortName}
                            </motion.span>
                        )}
                    </AnimatePresence>
                </button>
                <span className={`mx-1 h-6 w-px ${isDaylight ? 'bg-black/10' : 'bg-white/15'}`} aria-hidden="true" />
                <button
                    type="button"
                    onClick={onBackToPlayer}
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}
                    title={t('home.backToPlayer')}
                    aria-label={t('home.backToPlayer')}
                >
                    <ChevronRight size={21} />
                </button>
            </div>

            <AnimatePresence>
                {open && (
                    <motion.div
                        role="menu"
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ duration: 0.16 }}
                        className={`absolute bottom-[calc(100%+0.75rem)] right-0 w-80 max-w-[calc(100vw-2rem)] origin-bottom-right rounded-3xl p-3 shadow-2xl backdrop-blur-2xl ${surfaceClass}`}
                    >
                        <div className="px-3 pb-3 pt-1 text-xs font-medium opacity-50">{t('home.onlineProvider')}</div>
                        {providers.map(provider => {
                            const active = provider.providerId === activeProviderId;
                            const configured = provider.availability.configured;
                            return (
                                <button
                                    key={provider.providerId}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={active}
                                    disabled={!configured}
                                    onClick={() => {
                                        onSelect(provider);
                                        if (provider.status === 'authenticated') setOpen(false);
                                    }}
                                    className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors last:mb-0 ${active ? (isDaylight ? 'bg-black/5' : 'bg-white/8') : ''} ${configured ? (isDaylight ? 'hover:bg-black/8' : 'hover:bg-white/12') : 'cursor-not-allowed opacity-40'}`}
                                >
                                    <ProviderAvatar provider={provider} className="h-11 w-11 shrink-0 rounded-full" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold">{provider.shortName}</span>
                                        <span className="mt-0.5 block truncate text-[11px] opacity-45">{provider.displayName}</span>
                                        <span className="mt-1 block truncate text-xs opacity-65">
                                            {!configured
                                                ? t('home.providerNotConfigured')
                                                : provider.user?.nickname || t('home.providerNotLoggedIn')}
                                        </span>
                                    </span>
                                    {active ? <Check size={17} /> : provider.status !== 'authenticated' ? <LogIn size={16} className="opacity-55" /> : null}
                                </button>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default OnlineProviderSwitcher;
