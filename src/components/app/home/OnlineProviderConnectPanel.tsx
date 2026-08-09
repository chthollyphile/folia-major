import { User } from 'lucide-react';
import type { ProviderAccountSummary } from '../../../types/onlineMusic';

// src/components/app/home/OnlineProviderConnectPanel.tsx

type OnlineProviderConnectPanelProps = {
    providers: ProviderAccountSummary[];
    isDaylight: boolean;
    title: string;
    prompt: string;
    getActionLabel: (provider: ProviderAccountSummary) => string;
    onSelect: (provider: ProviderAccountSummary) => void;
};

// 在线平台使用统一的纯色圆形文字徽章。
const providerBadge = (
    provider: ProviderAccountSummary,
): { label: string; iconUrl?: string; className: string } => {
    if (provider.providerId === 'netease') return { label: '云', className: 'bg-red-600' };
    if (provider.providerId === 'kugou') return { label: 'K', className: 'bg-blue-600' };
    if (provider.providerId === 'qq') return { label: 'Q', className: 'bg-green-600' };
    return { label: provider.shortName.slice(0, 1), className: 'bg-zinc-600' };
};

const OnlineProviderConnectPanel = ({
    providers,
    isDaylight,
    title,
    prompt,
    getActionLabel,
    onSelect,
}: OnlineProviderConnectPanelProps) => (
    <div className="flex flex-1 w-full flex-col items-center justify-center space-y-6 px-4">
        <div className={`w-20 h-20 rounded-3xl ${isDaylight ? 'bg-white/40 shadow-sm border border-black/5' : 'bg-white/5 border border-white/5'} flex items-center justify-center backdrop-blur-md`}>
            <User size={36} className="opacity-25" />
        </div>
        <div className="text-center max-w-md space-y-2">
            <h2 className="text-2xl font-bold opacity-90">{title}</h2>
            <p className="opacity-50 text-sm leading-6 whitespace-pre-line">{prompt}</p>
        </div>
        {/*
          * 上限从 max-w-md（448px）放宽到 max-w-3xl（768px）：本 PR 之前只有网易云与酷狗两个按钮，
          * 448px 装得下；加入 QQ 音乐后三个按钮简体下要 566px、英文下要 730px，会被挤到第二行。
          * flex-wrap 保留，窗口真的窄下去仍然照常换行。
          */}
        <div className="flex flex-wrap items-center justify-center gap-3.5 max-w-3xl w-full pt-2">
            {providers.map(provider => {
                const configured = provider.availability.configured;
                const isPrimaryProvider = provider.providerId === 'netease';
                const badge = providerBadge(provider);
                return (
                    <button
                        key={provider.providerId}
                        type="button"
                        disabled={!configured}
                        onClick={() => onSelect(provider)}
                        className={`flex items-center gap-3 px-5 py-3 rounded-2xl font-bold text-sm transition-all hover:scale-105 cursor-pointer border ${isPrimaryProvider
                            ? 'bg-white text-black border-white shadow-md'
                            : (isDaylight ? 'bg-white/60 hover:bg-white/90 text-zinc-900 border-black/5 shadow-sm' : 'bg-white/5 hover:bg-white/10 text-white border-white/10')
                            } ${!configured ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-white overflow-hidden ${badge.className}`}>
                            {badge.iconUrl
                                ? <img src={badge.iconUrl} alt="" aria-hidden="true" className="w-4 h-4 object-contain" />
                                : badge.label}
                        </span>
                        <span>{getActionLabel(provider)}</span>
                    </button>
                );
            })}
        </div>
    </div>
);

export default OnlineProviderConnectPanel;
