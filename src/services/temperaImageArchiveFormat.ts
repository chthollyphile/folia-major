import { strFromU8, type Unzipped } from 'fflate';
import {
    DEFAULT_TEMPERA_LAYER_IMAGE,
    type TemperaLayerImage,
    type TemperaLayerImageAlign,
    type TemperaLayerImageVerticalAlign,
} from '../types';

// src/services/temperaImageArchiveFormat.ts
// Validates pool manifests and preserves an image's decoder-visible type across zip round-trips.

const EXTENSION_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
};

const MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
};

const HORIZONTAL_ALIGNMENTS = new Set<TemperaLayerImageAlign>(['left', 'center', 'right', 'free']);
const VERTICAL_ALIGNMENTS = new Set<TemperaLayerImageVerticalAlign>(['top', 'center', 'bottom', 'free']);

const extensionFromName = (name: string): string | null => {
    const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] && MIME_BY_EXTENSION[match[1]] ? match[1] : null;
};

/** Gives every new archive entry an explicit, decoder-safe image extension. */
export const buildTemperaArchiveEntryPath = (
    image: Pick<TemperaLayerImage, 'id' | 'name'>,
    mimeType: string,
): string => {
    const extension = EXTENSION_BY_MIME[mimeType] ?? extensionFromName(image.name);
    if (!extension) throw new Error(`Unsupported Tempera image type: ${mimeType || image.name}`);
    return `images/${image.id}.${extension}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

/** Converts untrusted manifest data into the exact placement range accepted by the editor. */
const normalizePlacement = (value: unknown): TemperaLayerImage | null => {
    if (!isRecord(value) || typeof value.id !== 'string') return null;
    const id = value.id.trim();
    if (!id || id.length > 512 || /[\\/\u0000-\u001F]/.test(id)) return null;
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'image';
    const align = HORIZONTAL_ALIGNMENTS.has(value.align as TemperaLayerImageAlign)
        ? value.align as TemperaLayerImageAlign
        : DEFAULT_TEMPERA_LAYER_IMAGE.align;
    const verticalAlign = VERTICAL_ALIGNMENTS.has(value.verticalAlign as TemperaLayerImageVerticalAlign)
        ? value.verticalAlign as TemperaLayerImageVerticalAlign
        : DEFAULT_TEMPERA_LAYER_IMAGE.verticalAlign;
    return {
        id,
        name,
        align,
        verticalAlign,
        scale: clampNumber(value.scale, DEFAULT_TEMPERA_LAYER_IMAGE.scale, 0.05, 2),
        opacity: clampNumber(value.opacity, DEFAULT_TEMPERA_LAYER_IMAGE.opacity, 0, 1),
    };
};

const detectImageMimeType = (bytes: Uint8Array, ...names: string[]): string | null => {
    for (const name of names) {
        const extension = extensionFromName(name);
        if (extension) return MIME_BY_EXTENSION[extension];
    }
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 6 && strFromU8(bytes.subarray(0, 6)).startsWith('GIF8')) return 'image/gif';
    if (bytes.length >= 12 && strFromU8(bytes.subarray(0, 4)) === 'RIFF'
        && strFromU8(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
    const header = strFromU8(bytes.subarray(0, Math.min(bytes.length, 2048))).replace(/^\uFEFF/, '').trimStart();
    return /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(header) ? 'image/svg+xml' : null;
};

export interface TemperaArchiveImageEntry {
    image: TemperaLayerImage;
    bytes: Uint8Array;
    mimeType: string;
}

/** Resolves valid manifest rows to their archived bytes while accepting the original bare-id schema. */
export const collectTemperaArchiveEntries = (
    files: Unzipped,
    manifest: unknown[],
): TemperaArchiveImageEntry[] => {
    const paths: string[] = Object.keys(files);
    const entries: TemperaArchiveImageEntry[] = [];
    manifest.forEach(rawImage => {
        const image = normalizePlacement(rawImage);
        if (!image) return;
        const prefix = `images/${image.id}`;
        const path = paths.find(name => name === prefix || (
            name.startsWith(`${prefix}.`) && Boolean(extensionFromName(name))
        ));
        if (!path) return;
        const bytes = files[path];
        if (!bytes) return;
        const mimeType = detectImageMimeType(bytes, path, image.name);
        if (!mimeType) return;
        entries.push({ image, bytes, mimeType });
    });
    return entries;
};
