import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coffee, Moon, MoonStar, Sun, Sunrise, Sunset, Utensils, type LucideIcon } from 'lucide-react';
import { GREETING_SHORT_VARIANTS, historyGreetingSlot, msUntilNextGreetingSlot, pickGreetingVariant, type HistoryGreetingSlot } from './historyGreeting';

// src/components/app/scratchpad/ScratchpadGreeting.tsx
// 速记簿的那一句问候（三页共用，都是放大的 headline）：左缘面板里写在信息条下面，用短版（几个字，用户定 2026-11-06）；
// 展开整页写在右上角的黑三角里，用长版（窄屏的三角小，换短版，见 ScratchpadSheet）。不带 headline 时是一行带时段图标的眉批。

/** 每一段前面的小图标。 */
const SLOT_ICONS: Record<HistoryGreetingSlot, LucideIcon> = {
    lateNight: MoonStar,
    dawn: Sunrise,
    morning: Sun,
    noon: Utensils,
    afternoon: Coffee,
    evening: Sunset,
    night: Moon,
};

type GreetingPick = { slot: HistoryGreetingSlot; short: string; long: string };

const pickNow = (): GreetingPick => ({
    slot: historyGreetingSlot(new Date()),
    short: pickGreetingVariant(Math.random, GREETING_SHORT_VARIANTS),
    long: pickGreetingVariant(),
});

/**
 * 挂上时两种长度各随机挑一句；跨过一段（比如过了晚上十点）时换成新一段里随机的。
 * headline：左缘面板里那种放大的写法（不带图标，最多两行），见 ScratchpadPanel。
 */
const ScratchpadGreeting: React.FC<{ long: boolean; headline?: boolean; className?: string }> = ({ long, headline = false, className }) => {
    const { t } = useTranslation();
    const [pick, setPick] = useState(pickNow);
    // 每次到点都重挂下一个（tick 每次都变）：时钟被往回调过、算出来还是同一段时也不会停下。
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setPick(pickNow());
            setTick(current => current + 1);
        }, msUntilNextGreetingSlot(new Date()));
        return () => window.clearTimeout(timer);
    }, [tick]);
    const text = long
        ? t(`scratchpad.greeting.${pick.slot}.${pick.long}`)
        : t(`scratchpad.greetingShort.${pick.slot}.${pick.short}`);
    const Icon = SLOT_ICONS[pick.slot];
    return (
        <p className={`scratchpad-greeting${headline ? ' is-headline' : ''}${className ? ` ${className}` : ''}`} data-testid="scratchpad-greeting">
            {!headline && <Icon aria-hidden="true" />}
            <span>{text}</span>
        </p>
    );
};

export default ScratchpadGreeting;
