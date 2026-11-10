import React from 'react';
import { AudioLines } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWebAudioSignal } from './useWebAudioSignal';

// 复用信号通路 Sheet 的 Web Audio 内容：顶上写转码播放还是 Web 引擎，下面是应用转码与系统输出，未测量的环节不作直通保证。

export const WebAudioSignalPath: React.FC = () => {
    const { t } = useTranslation();
    const signal = useWebAudioSignal();
    return (
        <>
            <section className="flex items-start gap-3 rounded-xl bg-[var(--st-card)] px-4 py-3.5 shadow-[0_0_0_1px_var(--st-line)]">
                <AudioLines size={22} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--st-accent)]" />
                <div>
                    <p role="status" className="text-lg font-semibold leading-7">
                        {t(signal.transcode === 'transcoded' ? 'hifi.route.transcoded' : 'hifi.route.webEngine')}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-5 text-[color:var(--st-t2)]">{t(signal.active ? 'hifi.web.engineDesc' : 'hifi.web.noSource')}</p>
                </div>
            </section>
            <dl className="mt-5 space-y-4 px-1 text-sm">
                <div>
                    <dt className="font-semibold">{t('hifi.web.transcodeLabel')}</dt>
                    <dd className="mt-1 text-[color:var(--st-t2)]">{t(`hifi.web.${signal.transcode}`)}</dd>
                    {signal.mimeType && <dd className="mt-1 font-mono text-xs text-[color:var(--st-t3)]">{signal.mimeType}</dd>}
                </div>
                <div>
                    <dt className="font-semibold">{t('hifi.web.outputLabel')}</dt>
                    <dd className="mt-1 text-[color:var(--st-t2)]">{t('hifi.web.outputDesc')}</dd>
                </div>
            </dl>
        </>
    );
};
