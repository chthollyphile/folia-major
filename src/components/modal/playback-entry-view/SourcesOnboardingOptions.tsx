import React, { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { providerDisplayName } from '../../../i18n/providerName';
import { omni } from '../../../services/onlineMusic/omni';
import { PlatformMark } from '../../login/PlatformMark';
import { onAccentColor } from '../settings/kit/kitTheme';
import { useSourcesOnboardingStore, type OnboardingSource } from './sourcesOnboarding';

// src/components/modal/playback-entry-view/SourcesOnboardingOptions.tsx
// 首启引导的「你用哪些平台听歌」一页（Folium 2.0 方案 §5.3，只有全新安装的桌面版有）：每个内置音源一个勾选，默认都不勾。
// 名字和记号与「设置 → 音源」的行同一种取法（平台登记的名字和记号，记号只用字和颜色）；全新安装的内置音源都启用着，
// 引导开时一般都已登记，还没登记的先显示 id，登记后跟着换。
// 清单标了只用于匹配的（keepForMatching）旁边写一句：不勾也留着，只给本地歌配歌词和信息。勾选只记在这里，关掉引导时一次交给主进程。

// The registry's version, followed so names and marks appear once a source registers (module-level subscription).
const subscribeRegistry = (listener: () => void) => omni.subscribeProviders(listener);
const readRegistryVersion = () => omni.getProviderRegistryVersion();

type SourcesOnboardingOptionsProps = {
    isDaylight: boolean;
    accentColor: string;
};

export const SourcesOnboardingOptions: React.FC<SourcesOnboardingOptionsProps> = ({ isDaylight, accentColor }) => {
    const { t } = useTranslation();
    const sources = useSourcesOnboardingStore(state => state.sources);
    const ticked = useSourcesOnboardingStore(state => state.ticked);
    const toggle = useSourcesOnboardingStore(state => state.toggle);
    useSyncExternalStore(subscribeRegistry, readRegistryVersion);

    const nameOf = (source: OnboardingSource): string => {
        const naming = omni.getProviderNaming(source.sourceId);
        return naming ? providerDisplayName(t, naming, source.sourceId) : source.sourceId;
    };
    const ordered = omni.sortSourceIds(sources.map(source => source.sourceId))
        .flatMap(sourceId => sources.filter(source => source.sourceId === sourceId));

    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                        className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors ${frameClass}`}
                        style={{ borderColor: isTicked ? accentColor : (isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)') }}
                    >
                        <PlatformMark providerId={source.sourceId} label={name} size={22} className="mt-px" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{name}</span>
                            {source.keepForMatching && (
                                <span className="mt-1 block text-[11px] leading-relaxed opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                    {t('sourcesOnboarding.matchingNote')}
                                </span>
                            )}
                        </span>
                        <span
                            aria-hidden
                            className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors"
                            style={isTicked
                                ? { backgroundColor: accentColor, borderColor: accentColor, color: onAccentColor(accentColor) }
                                : { borderColor: isDaylight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)' }}
                        >
                            {isTicked && <Check size={14} strokeWidth={3} />}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
