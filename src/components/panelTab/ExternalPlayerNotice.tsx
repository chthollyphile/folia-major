import React from 'react';
import { AudioWaveform } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../stores/usePlaybackStore';

// src/components/panelTab/ExternalPlayerNotice.tsx
// 音频效果器窗口顶上的说明：这首歌由平台自己的播放器播放（外部播放路由），声音不经过 Folia，均衡器和音效都不起作用，
// 设置留着给别的歌用。样子照 hifi/HifiBypassNotice.tsx；不在外部路由上时什么都不画。

/** 正在放的歌由平台自己的播放器发声（外部播放路由）。 */
export const useIsExternalPlayerRoute = (): boolean => usePlaybackStore(state => state.playbackRoute === 'external');

const ExternalPlayerNotice: React.FC = () => {
    const { t } = useTranslation();
    const external = useIsExternalPlayerRoute();

    if (!external) {
        return null;
    }

    return (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-xl bg-[var(--st-card)] px-4 py-3 shadow-[0_0_0_1px_var(--st-line)]">
            <AudioWaveform size={16} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--st-t2)]" />
            <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5">{t('status.externalBypassTitle')}</p>
                <p className="mt-0.5 text-xs leading-[18px] text-[color:var(--st-t2)]">{t('status.externalBypassBody')}</p>
            </div>
        </div>
    );
};

export default ExternalPlayerNotice;
