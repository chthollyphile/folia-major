import { CalendarDays, Cloud, Heart, HeartPulse, ListMusic, Radio, Shuffle, Star, type LucideIcon } from 'lucide-react';
import type { LibraryHomeSpecialKind } from '../../core/model/homeSpecialCards';

// src/library/suites/bravais/bravaisSpecialIcons.ts
// 特殊集合的小图标：墙上磁贴的类型标签（强调色底 + 图标）与直达入口挪进「⋯」菜单时的那一行用同一个，看得出是同一张。
// fb11 起缝里中段的直达入口是竖排文字，不再用图标。

export const BRAVAIS_SPECIAL_ICONS: Record<LibraryHomeSpecialKind, LucideIcon> = {
    liked: Heart,
    cloud: Cloud,
    'personal-fm': Radio,
    heartbeat: HeartPulse,
    daily: CalendarDays,
    'all-songs': ListMusic,
    'local-favorites': Heart,
    'navidrome-random': Shuffle,
    'navidrome-favorites': Star,
};
