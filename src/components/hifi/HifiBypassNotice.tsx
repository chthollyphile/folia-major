import React from 'react';
import { AudioWaveform } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsHifiRoute } from './useHifiSignalPath';

// src/components/hifi/HifiBypassNotice.tsx
// 音频效果器窗口顶上的说明：这首歌走 HiFi（mpv 直接送到输出设备），均衡器和音效都绕过了，设置留着给原来的引擎用。
// 样子照 equalizer/ModCurveNotice.tsx；不在 HiFi 路线上时什么都不画。

const HifiBypassNotice: React.FC = () => {
    const { t } = useTranslation();
    const isHifiRoute = useIsHifiRoute();

    if (!isHifiRoute) {
        return null;
    }

    return (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-xl bg-[var(--st-card)] px-4 py-3 shadow-[0_0_0_1px_var(--st-line)]">
            <AudioWaveform size={16} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--st-t2)]" />
            <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5">{t('hifi.player.bypassNoticeTitle')}</p>
                <p className="mt-0.5 text-xs leading-[18px] text-[color:var(--st-t2)]">{t('hifi.player.bypassNoticeBody')}</p>
            </div>
        </div>
    );
};

export default HifiBypassNotice;
