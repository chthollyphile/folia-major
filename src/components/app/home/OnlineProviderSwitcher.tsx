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
    const rootRef = useRef<HTMLDivElement>(null);
    const activeProvider = providers.find(provider => provider.providerId === activeProviderId) || providers[0];

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
        <div ref={rootRef} className="absolute bottom-8 right-8 z-[100] flex items-center gap-2 pointer-events-auto">
            <button
                type="button"
                onClick={onBackToPlayer}
                className={`group flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition-transform hover:scale-105 ${isDaylight ? 'border-black/10 bg-white/70' : 'border-white/15 bg-black/35'}`}
                title={t('home.backToPlayer')}
                aria-label={t('home.backToPlayer')}
            >
                <ChevronRight size={21} />
            </button>
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                className="group relative h-12 w-12 overflow-visible rounded-full border border-white/20 shadow-lg transition-transform hover:scale-105"
                title={t('home.switchOnlineProvider')}
                aria-label={t('home.switchOnlineProvider')}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <ProviderAvatar provider={activeProvider} className="h-full w-full rounded-full" />
                <span className="absolute -bottom-1 -left-2 rounded-full border border-white/15 bg-zinc-950 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-md">
                    {activeProvider.shortName}
                </span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        role="menu"
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        transition={{ duration: 0.16 }}
                        className={`absolute bottom-16 right-0 w-72 rounded-2xl border p-2 shadow-2xl backdrop-blur-2xl ${isDaylight ? 'border-black/10 bg-white/90 text-zinc-900' : 'border-white/10 bg-zinc-950/90 text-zinc-100'}`}
                    >
                        <div className="px-3 pb-2 pt-1 text-[11px] font-medium opacity-50">{t('home.onlineProvider')}</div>
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
                                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${configured ? (isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/8') : 'cursor-not-allowed opacity-40'}`}
                                >
                                    <ProviderAvatar provider={provider} className="h-10 w-10 shrink-0 rounded-full" />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 text-sm font-semibold">
                                            {provider.shortName}
                                            <span className="text-[10px] font-normal opacity-45">{provider.displayName}</span>
                                        </span>
                                        <span className="block truncate text-xs opacity-55">
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
