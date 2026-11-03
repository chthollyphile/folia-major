import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import { Info, RotateCcw } from 'lucide-react';
import type { LyricData } from '../../../types';
import Sheet, { SheetButton } from '../../shared/Sheet';
import GlobalLyricOffsetPreview from './GlobalLyricOffsetPreview';
import GlobalLyricOffsetRuler from './GlobalLyricOffsetRuler';
import { Button, Reveal } from './kit';
import { useLyricSettingsStore } from '../../../stores/useLyricSettingsStore';
import { clampGlobalLyricTimelineOffsetMs, GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS } from '../../../stores/useLyricSettingsStore';

// src/components/modal/settings/GlobalLyricOffsetModal.tsx
// 实验室里的“全局时间偏移”校准窗口：正在播放的歌词按草稿偏移实时推进，
// 用户对着耳机听到的声音微调 1ms / 10ms / 50ms，确认后再应用到设备级设置。

type GlobalLyricOffsetModalProps = {
    isOpen: boolean;
    isDaylight: boolean;
    lyrics: LyricData | null;
    lyricCurrentTime: MotionValue<number>;
    onClose: () => void;
};

const STEPS_MS = [50, 10, 1];

const GlobalLyricOffsetModal: React.FC<GlobalLyricOffsetModalProps> = ({
    isOpen,
    isDaylight,
    lyrics,
    lyricCurrentTime,
    onClose,
}) => {
    const { t } = useTranslation();
    const appliedOffsetMs = useLyricSettingsStore(state => state.globalLyricTimelineOffsetMs);
    const setGlobalOffsetMs = useLyricSettingsStore(state => state.handleSetGlobalLyricTimelineOffsetMs);
    const [draftOffsetMs, setDraftOffsetMs] = useState(appliedOffsetMs);
    const [isNoteOpen, setIsNoteOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setDraftOffsetMs(appliedOffsetMs);
            setIsNoteOpen(false);
        }
    }, [appliedOffsetMs, isOpen]);

    const adjust = (deltaMs: number) => {
        setDraftOffsetMs(previous => clampGlobalLyricTimelineOffsetMs(previous + deltaMs));
    };

    const handleApply = () => {
        setGlobalOffsetMs(draftOffsetMs);
        onClose();
    };

    const isDirty = draftOffsetMs !== appliedOffsetMs;

    return (
        <Sheet
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            size="m"
            title={t('globalLyricOffset.title')}
            subtitle={t('globalLyricOffset.subtitle')}
            headerActions={(
                <Button variant="quiet" icon={Info} tip={t('options.settingsRowDetails')} onClick={() => setIsNoteOpen(open => !open)} />
            )}
            footerNote={isDirty ? t('globalLyricOffset.pendingApply', { applied: appliedOffsetMs }) : undefined}
            footer={(
                <>
                    <SheetButton onClick={onClose}>{t('ui.cancel')}</SheetButton>
                    <SheetButton variant="primary" disabled={!isDirty} onClick={handleApply}>
                        {t('globalLyricOffset.apply')}
                    </SheetButton>
                </>
            )}
        >
            <Reveal when={isNoteOpen}>
                <p className="pb-3 text-xs leading-[19px] text-[color:var(--st-t2)]">{t('globalLyricOffset.description')}</p>
            </Reveal>

            <GlobalLyricOffsetPreview
                lyrics={lyrics}
                lyricCurrentTime={lyricCurrentTime}
                draftDeltaMs={draftOffsetMs - appliedOffsetMs}
                draftOffsetMs={draftOffsetMs}
            />

            <div className="mt-[18px] flex items-baseline justify-center gap-1.5">
                <span className="text-[40px] font-semibold leading-[48px] tabular-nums">
                    {draftOffsetMs > 0 ? `+${draftOffsetMs}` : draftOffsetMs}
                </span>
                <span className="text-sm text-[color:var(--st-t2)]">ms</span>
            </div>
            <div className="mt-0.5 text-center text-xs leading-[18px] text-[color:var(--st-t2)]">
                {draftOffsetMs === 0
                    ? t('globalLyricOffset.neutralHint')
                    : draftOffsetMs > 0
                        ? t('globalLyricOffset.laterHint')
                        : t('globalLyricOffset.earlierHint')}
            </div>

            <div className="mt-3.5">
                <GlobalLyricOffsetRuler
                    valueMs={draftOffsetMs}
                    limitMs={GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS}
                    ariaLabel={t('globalLyricOffset.title')}
                    onChange={(nextMs) => setDraftOffsetMs(clampGlobalLyricTimelineOffsetMs(nextMs))}
                />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                {STEPS_MS.map(step => (
                    <Button key={`minus-${step}`} onClick={() => adjust(-step)}>-{step}</Button>
                ))}
                <Button
                    icon={RotateCcw}
                    tip={t('globalLyricOffset.reset')}
                    disabled={draftOffsetMs === 0}
                    onClick={() => setDraftOffsetMs(0)}
                />
                {[...STEPS_MS].reverse().map(step => (
                    <Button key={`plus-${step}`} onClick={() => adjust(step)}>+{step}</Button>
                ))}
            </div>
        </Sheet>
    );
};

export default GlobalLyricOffsetModal;
