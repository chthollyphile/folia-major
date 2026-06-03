import type { CappellaAvatarSource } from '../../../types';

// src/components/visualizer/cappella/avatarImages.ts
// Loads built-in Cappella avatar images and resolves the active avatar source.
export type CappellaAvatarSide = 'left' | 'right';

export interface CappellaAvatarImage {
    id: string;
    name: string;
    url: string;
}

interface ResolveCappellaAvatarUrlInput {
    avatarSource: CappellaAvatarSource;
    coverUrl?: string | null;
    avatarIndex: number;
    side: CappellaAvatarSide;
    seed?: string | number;
    avatars?: CappellaAvatarImage[];
    customAvatarImages?: CappellaAvatarImage[];
}

const avatarModules = import.meta.glob<{ default: string }>(
    './avatar/*.{png,jpg,jpeg,gif,webp,svg}',
    { eager: true },
);

const toStableAvatarImages = (): CappellaAvatarImage[] =>
    Object.entries(avatarModules)
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([path, mod]) => {
            const filename = path.split('/').pop() ?? '';
            const name = filename.replace(/\.[^.]+$/, '');
            return {
                id: `builtin-avatar-${name}`,
                name,
                url: mod.default,
            };
        });

export const builtinAvatarImages = toStableAvatarImages();

const hashString = (input: string) => {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const getSeededIndex = (seed: string | number, side: CappellaAvatarSide, length: number) =>
    hashString(`${seed}|${side}|${length}`) % length;

export const pickStableBuiltinAvatarImage = (
    avatars: CappellaAvatarImage[],
    avatarIndex: number,
    side: CappellaAvatarSide,
    seed: string | number = 'cappella',
): CappellaAvatarImage | null => {
    if (avatars.length === 0) {
        return null;
    }

    const rightAvatarIndex = getSeededIndex(seed, 'right', avatars.length);
    if (side === 'right') {
        return avatars[rightAvatarIndex] ?? null;
    }

    const leftAvatarPool = avatars.filter((_, index) => index !== rightAvatarIndex);
    if (leftAvatarPool.length === 0) {
        return avatars[rightAvatarIndex] ?? null;
    }

    const leftSeedOffset = getSeededIndex(seed, 'left', leftAvatarPool.length);
    const resolvedLeftIndex = Math.abs(Math.trunc(avatarIndex + leftSeedOffset)) % leftAvatarPool.length;
    return leftAvatarPool[resolvedLeftIndex] ?? null;
};

export const resolveCappellaAvatarUrl = ({
    avatarSource,
    coverUrl,
    avatarIndex,
    side,
    seed,
    avatars = builtinAvatarImages,
    customAvatarImages,
}: ResolveCappellaAvatarUrlInput): string | null => {
    if (avatarSource === 'color') {
        return null;
    }

    if (avatarSource === 'cover' && coverUrl) {
        return coverUrl;
    }

    if (avatarSource === 'custom' && customAvatarImages && customAvatarImages.length > 0) {
        return pickStableBuiltinAvatarImage(customAvatarImages, avatarIndex, side, seed)?.url ?? null;
    }

    return pickStableBuiltinAvatarImage(avatars, avatarIndex, side, seed)?.url ?? null;
};
