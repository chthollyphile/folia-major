import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coffee, Moon, MoonStar, Sun, Sunrise, Sunset, Utensils, type LucideIcon } from 'lucide-react';
import { GREETING_SHORT_VARIANTS, historyGreetingSlot, msUntilNextGreetingSlot, pickGreetingVariant, type HistoryGreetingSlot } from './historyGreeting';

// src/components/app/scratchpad/ScratchpadGreeting.tsx
// 速记簿抽屉顶上、页签上面的那一句问候（三页共用）：窄的抽屉里是短版（几个字），展开成画布时是长版（一整句）。

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

/** 挂上时两种长度各随机挑一句；跨过一段（比如过了晚上十点）时换成新一段里随机的。 */
const ScratchpadGreeting: React.FC<{ long: boolean }> = ({ long }) => {
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
        <p className="scratchpad-greeting" data-testid="scratchpad-greeting">
            <Icon aria-hidden="true" />
            <span>{text}</span>
        </p>
    );
};

export default ScratchpadGreeting;
