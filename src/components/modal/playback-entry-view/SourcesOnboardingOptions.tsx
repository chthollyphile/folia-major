import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight } from 'lucide-react';
import { providerDisplayName } from '../../../i18n/providerName';
import { omni } from '../../../services/onlineMusic/omni';
import { PlatformMark } from '../../login/PlatformMark';
import { manifestSourceName } from '../settings/pages/sources/sourcesModel';
import { onAccentColor } from '../settings/kit/kitTheme';
import { useSourcesOnboardingStore, type OnboardingSource } from './sourcesOnboarding';

// src/components/modal/playback-entry-view/SourcesOnboardingOptions.tsx
// 首启引导的「你用哪些平台听歌」一页（Folium 2.0 方案 §5.3，只有全新安装的桌面版有）：每个内置音源一个勾选，默认都不勾。
// 名字和记号与「设置 → 音源」的行同一种取法：名字取模组清单给它的名字（按界面语言），没有清单名的（宿主自带的平台）取平台登记的；
// 记号取平台登记的（只用字和颜色）。引导答完之前音源模组都不运行（方案 §5.3：没勾的不能先联网），所以这时一般还没登记，
// 记号是按名字首字画的中性灰。
// 每家一行紧凑的勾选（记号、名字、勾）；清单标了只用于匹配的（keepForMatching）不在格子里各写一遍，而是在格子下面用一句话
// 点名：不勾也留着，只给本地歌配歌词和信息。勾选只记在这里，关掉引导时一次交给主进程。
// 最下面一句说 Navidrome：它是自建的服务器，不是音源模组，不在这张表里，在设置里连接（维护者 2026-11-21：暂不迁成音源）。
// 按钮关掉引导（按答完算）再打开它在设置里的连接处。

// The registry's version, followed so names and marks appear once a source registers (module-level subscription).
const subscribeRegistry = (listener: () => void) => omni.subscribeProviders(listener);
const readRegistryVersion = () => omni.getProviderRegistryVersion();

type SourcesOnboardingOptionsProps = {
    isDaylight: boolean;
    accentColor: string;
    /** Closes the start prompt as answered and opens the Navidrome connection in Settings. */
    onOpenNavidrome?: () => void;
};

export const SourcesOnboardingOptions: React.FC<SourcesOnboardingOptionsProps> = ({ isDaylight, accentColor, onOpenNavidrome }) => {
    const { t, i18n } = useTranslation();
    const sources = useSourcesOnboardingStore(state => state.sources);
    const ticked = useSourcesOnboardingStore(state => state.ticked);
    const toggle = useSourcesOnboardingStore(state => state.toggle);
    useSyncExternalStore(subscribeRegistry, readRegistryVersion);

    const nameOf = (source: OnboardingSource): string => {
        if (source.name) return manifestSourceName(source.name, i18n.language, source.sourceId);
        const naming = omni.getProviderNaming(source.sourceId);
        return naming ? providerDisplayName(t, naming, source.sourceId) : source.sourceId;
    };
    const ordered = omni.sortSourceIds(sources.map(source => source.sourceId))
        .flatMap(sourceId => sources.filter(source => source.sourceId === sourceId));

    const kept = ordered.filter(source => source.keepForMatching).map(nameOf);
    // 勾上的音源里清单带了启用说明的（enableNotice）：在格子下面各说一句。
    const notices = ordered
        .filter(source => ticked.has(source.sourceId) && source.enableNotice)
        .map(source => ({ sourceId: source.sourceId, text: `${nameOf(source)}${t('sourcesOnboarding.noticeSeparator')}${manifestSourceName(source.enableNotice, i18n.language, '')}` }));

    return (
        <>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {ordered.map((source) => {
                    const name = nameOf(source);
                    const isTicked = ticked.has(source.sourceId);
                    const frameClass = isTicked
                        ? (isDaylight ? 'bg-white shadow-md' : 'bg-white/[0.07]')
                        : (isDaylight ? 'bg-zinc-50 hover:bg-white' : 'bg-white/[0.03] hover:bg-white/[0.06]');
                    return (
                        <button
                            key={source.sourceId}
                            type="button"
                            role="checkbox"
                            aria-checked={isTicked}
                            onClick={() => toggle(source.sourceId)}
                            data-onboarding-source={source.sourceId}
                            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${frameClass}`}
                            style={{ borderColor: isTicked ? accentColor : (isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)') }}
                        >
                            <PlatformMark providerId={source.sourceId} label={name} size={20} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{name}</span>
                            <span
                                aria-hidden
                                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors"
                                style={isTicked
                                    ? { backgroundColor: accentColor, borderColor: accentColor, color: onAccentColor(accentColor) }
                                    : { borderColor: isDaylight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)' }}
                            >
                                {isTicked && <Check size={12} strokeWidth={3} />}
                            </span>
                        </button>
                    );
                })}
            </div>
            {kept.length > 0 && (
                <p className="mt-3 text-xs leading-relaxed opacity-70" style={{ color: 'var(--text-secondary)' }}>
                    {t('sourcesOnboarding.matchingNote', { names: kept.join(t('sourcesOnboarding.nameSeparator')), count: kept.length })}
                </p>
            )}
            {notices.map(notice => (
                <p key={notice.sourceId} className="mt-3 text-xs leading-relaxed opacity-70" style={{ color: 'var(--text-secondary)' }} data-onboarding-notice={notice.sourceId}>
                    {notice.text}
                </p>
            ))}
            {onOpenNavidrome && (
                <div data-onboarding-navidrome="" className="mt-3 flex items-center gap-3 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    <span className="min-w-0 flex-1 opacity-70">{t('sourcesOnboarding.navidromeNote')}</span>
                    <button
                        type="button"
                        onClick={onOpenNavidrome}
                        className={`inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2.5 py-1 font-medium transition-colors ${isDaylight ? 'bg-black/[0.05] hover:bg-black/[0.09]' : 'bg-white/[0.06] hover:bg-white/[0.1]'}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {t('sourcesOnboarding.navidromeButton')}
                        <ChevronRight size={13} />
                    </button>
                </div>
            )}
        </>
    );
};
