// src/utils/shuffle/labels.ts
// 策略/RNG 标识 → i18n key 的映射（id 用连字符，i18n key 用驼峰）。
import type { ShuffleStrategy } from './algorithms';
import type { RngKind } from './rng';

export const strategyLabelKey = (s: ShuffleStrategy): string => ({
    'fisher-yates': 'shuffle.strategy.fisherYates',
    round: 'shuffle.strategy.round',
    'fewer-repeats': 'shuffle.strategy.fewerRepeats',
    weighted: 'shuffle.strategy.weighted',
})[s];

export const rngLabelKey = (k: RngKind): string => (k === 'mt19937' ? 'shuffle.rng.mt19937' : 'shuffle.rng.math');
