import type { ProviderMark } from '../../types/onlineMusic';

// src/components/login/resolvePlatformMark.ts
// 平台的记号：一个字和一种颜色。平台自己声明了的照它的；没有声明的（mod 加进来的平台）取它短名的
// 第一个字，配一个中性的颜色。

// 一个写死的颜色，不是主题的变量：记号的颜色顶的是平台自己的颜色（两种主题里一样），画在它上面的字
// 是深是白要拿它算对比度，窗口带的那一点颜色也从它来。
const NEUTRAL_MARK_COLOR = '#5d5d66';

export const resolvePlatformMark = (declared: ProviderMark | null, label: string): ProviderMark => (
    declared ?? { letter: [...label.trim()][0]?.toUpperCase() ?? '?', color: NEUTRAL_MARK_COLOR }
);
