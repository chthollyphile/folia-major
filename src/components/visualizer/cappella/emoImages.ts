import type { CappellaEmojiImage } from '../../../types';

// src/components/visualizer/cappella/emoImages.ts
// Loads emoji images from the `emo` directory via Vite's import.meta.glob
// and provides a random picker with a reserved emotionHint interface.

const emoModules = import.meta.glob<{ default: string }>(
    './emo/*.{png,jpg,jpeg,gif,webp,svg}',
    { eager: true },
);

const builtinEmoImages: CappellaEmojiImage[] = Object.entries(emoModules).map(
    ([path, mod]) => {
        const filename = path.split('/').pop() ?? '';
        const name = filename.replace(/\.[^.]+$/, '');
        return {
            id: `builtin-${name}`,
            url: mod.default,
            name,
        };
    },
);

/**
 * 从 emo 目录中随机挑选一张表情图片。
 *
 * @param _emotionHint - 预留接口：未来可根据情绪提示（如 "happy"、"sad"）
 *   筛选匹配的表情子集，再从中随机选取。当前版本忽略此参数，始终随机选取。
 *
 * TODO: 实现基于 emotionHint 的精细筛选逻辑，例如：
 *   - 用文件名前缀/标签匹配情绪关键词
 *   - 维护一份 emotionHint → 文件名列表的映射表
 */
export const pickRandomEmoImage = (
    _emotionHint?: string,
): CappellaEmojiImage | null => {
    if (builtinEmoImages.length === 0) {
        return null;
    }

    // TODO: 当 _emotionHint 有值时，先过滤出名称匹配的子集，
    // 如果子集非空则从中随机选取，否则 fallback 到全集。

    const index = Math.floor(Math.random() * builtinEmoImages.length);
    return builtinEmoImages[index];
};

export { builtinEmoImages };
