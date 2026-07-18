import React from 'react';
import { motion } from 'framer-motion';
import { LogOut, SlidersHorizontal, HardDrive, Trash2, RefreshCw, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NeteaseUser } from '../../types';
import type { AudioQualityPreference } from '../../types/onlineMusic';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { getOnlineMusicProvider } from '../../services/onlineMusic/providerRegistry';

interface AccountTabProps {
    user: NeteaseUser | null;
    onLogout: () => void;
    audioQuality: AudioQualityPreference;
    onAudioQualityChange: (quality: AudioQualityPreference) => void;
    cacheSize: string;
    onClearCache: () => void;
    onSyncData: () => void;
    isSyncing: boolean;
    onNavigateHome: () => void;
}

const AccountTab: React.FC<AccountTabProps> = ({
    user,
    onLogout,
    audioQuality,
    onAudioQualityChange,
    cacheSize,
    onClearCache,
    onSyncData,
    isSyncing,
    onNavigateHome,
}) => {
    const { t } = useTranslation();
    const activeProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const providerAccount = useOnlineProviderAccountStore(state => state.accounts[state.activeProviderId]);
    const clearProviderAccount = useOnlineProviderAccountStore(state => state.clearAccount);
    const provider = getOnlineMusicProvider(activeProviderId);
    const activeUser = providerAccount?.user || (activeProviderId === 'netease' && user ? {
        id: user.userId,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        backgroundUrl: user.backgroundUrl,
        vipType: user.vipType,
    } : null);

    const handleLogout = async () => {
        if (activeProviderId === 'netease') {
            onLogout();
            return;
        }
        await provider?.auth?.logout();
        clearProviderAccount(activeProviderId);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col justify-start h-full"
        >
            {activeUser ? (
                <div className="flex flex-col gap-4">
                    {/* User Info with Logout in Header */}
                    <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full overflow-hidden">
                                <img
                                    src={activeUser.avatarUrl?.replace('http:', 'https:')}
                                    className="w-full h-full object-cover"
                                    alt={activeUser.nickname}
                                />
                            </div>
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <h3 className="font-bold text-sm">{activeUser.nickname}</h3>
                                    {activeUser.vipType && activeUser.vipType !== 0 && (
                                        <Crown size={14} className="text-white fill-white" />
                                    )}
                                </div>
                                <span className="block text-[10px] opacity-50">{provider?.shortName || provider?.displayName}</span>
                                <span className="text-[10px] font-mono opacity-40">ID: {String(activeUser.id)}</span>
                            </div>
                        </div>
                        <button
                            onClick={() => void handleLogout()}
                            className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                            title={t('account.logout')}
                        >
                            <LogOut size={16} />
                        </button>
                    </div>

                    {/* Audio Quality Settings (VIP Only) */}
                    {activeUser.vipType && activeUser.vipType !== 0 && (
                        <div className="bg-white/5 p-3 rounded-xl">
                            <div className="flex items-center gap-2 mb-2 opacity-60">
                                <SlidersHorizontal size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wide">
                                    {t('account.audioQuality')}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        onAudioQualityChange('high');
                                    }}
                                    className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-all ${audioQuality === 'high'
                                        ? 'bg-white/20 shadow-sm'
                                        : 'opacity-40 hover:opacity-100 hover:bg-white/5'
                                        }`}
                                >
                                    {t('account.qualityExhigh')}
                                </button>
                                <button
                                    onClick={() => {
                                        onAudioQualityChange('lossless');
                                    }}
                                    className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-all ${audioQuality === 'lossless'
                                        ? 'bg-white/20 shadow-sm'
                                        : 'opacity-40 hover:opacity-100 hover:bg-white/5'
                                        }`}
                                >
                                    {t('account.qualityLossless')}
                                </button>
                                <button
                                    onClick={() => {
                                        onAudioQualityChange('hires');
                                    }}
                                    className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-all ${audioQuality === 'hires'
                                        ? 'bg-white/20 shadow-sm'
                                        : 'opacity-40 hover:opacity-100 hover:bg-white/5'
                                        }`}
                                >
                                    {t('account.qualityHires')}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2 mt-auto">
                        {/* Cache Management Section */}
                        {/* <div className="bg-white/5 p-3 rounded-xl mb-2">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2 opacity-60">
                                    <HardDrive size={12} />
                                    <span className="text-[10px] font-bold uppercase tracking-wide">
                                        {t('account.storage')}
                                    </span>
                                </div>
                                <span className="text-[10px] font-mono">{cacheSize}</span>
                            </div>
                            <button
                                onClick={onClearCache}
                                className="w-full py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold transition-colors"
                            >
                                <Trash2 size={12} />
                                {t('account.clearCache')}
                            </button>
                        </div> */}

                        {activeProviderId === 'netease' && <button
                            onClick={onSyncData}
                            disabled={isSyncing}
                            className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center gap-2 text-xs font-bold opacity-80 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                            {isSyncing ? t('account.syncing') : t('account.syncData')}
                        </button>}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center opacity-50">
                    <p>{t('account.guestMode')}</p>
                    <button
                        onClick={onNavigateHome}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-bold"
                    >
                        {t('account.loginOnHome')}
                    </button>
                </div>
            )}
        </motion.div>
    );
};

export default AccountTab;

