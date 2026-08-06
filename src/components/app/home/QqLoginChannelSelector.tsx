import { MessageCircle, Music2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getQqLoginChannel,
    setQqLoginChannel,
    type QqLoginChannel,
} from '../../../services/onlineMusic/qqTransport';

// src/components/app/home/QqLoginChannelSelector.tsx

type QqLoginChannelSelectorProps = {
    isDaylight: boolean;
};

const CHANNEL_OPTIONS = [
    { channel: 'mobile', labelKey: 'home.qqLoginChannelMobile', Icon: Music2 },
    { channel: 'wechat', labelKey: 'home.qqLoginChannelWechat', Icon: MessageCircle },
] as const;

const QqLoginChannelSelector = ({ isDaylight }: QqLoginChannelSelectorProps) => {
    const { t } = useTranslation();
    const [selectedChannel, setSelectedChannel] = useState<QqLoginChannel>(getQqLoginChannel);

    return (
        <fieldset className="flex flex-col items-center gap-1.5">
            <legend className="w-full text-center text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">
                {t('home.qqLoginChannelLabel')}
            </legend>
            <div
                className={`inline-flex rounded-xl border p-1 ${isDaylight
                    ? 'border-black/10 bg-white/55 shadow-sm'
                    : 'border-white/10 bg-white/5'
                    }`}
            >
                {CHANNEL_OPTIONS.map(({ channel, labelKey, Icon }) => {
                    const selected = selectedChannel === channel;
                    return (
                        <button
                            key={channel}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                                setQqLoginChannel(channel);
                                setSelectedChannel(channel);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${selected
                                ? (isDaylight ? 'bg-black text-white shadow-sm' : 'bg-white text-black shadow-sm')
                                : (isDaylight ? 'text-zinc-700 hover:bg-black/5' : 'text-white/60 hover:bg-white/10')
                                }`}
                        >
                            <Icon size={13} aria-hidden="true" />
                            <span>{t(labelKey)}</span>
                        </button>
                    );
                })}
            </div>
        </fieldset>
    );
};

export default QqLoginChannelSelector;
