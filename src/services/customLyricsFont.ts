import { getFromCache, removeFromCache, saveToCache } from './db';
import type { StoredCustomLyricsFont } from '../types';

// src/services/customLyricsFont.ts
// Persists and registers the mobile uploaded lyrics font fallback.
const UPLOADED_LYRICS_FONT_KEY = 'lyrics_uploaded_font';
const UPLOADED_FONT_FAMILY_PREFIX = 'FoliaUploadedLyricsFont';
const MAX_UPLOADED_LYRICS_FONT_SIZE = 50 * 1024 * 1024;
const SUPPORTED_FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf'];
const SUPPORTED_FONT_MIME_TYPES = new Set([
    'font/woff2',
    'font/woff',
    'font/ttf',
    'font/otf',
    'application/font-woff',
    'application/font-woff2',
    'application/x-font-ttf',
    'application/x-font-otf',
    'application/vnd.ms-opentype',
]);

export interface StoredUploadedLyricsFont {
    id: string;
    name: string;
    mimeType: string;
    blob: Blob;
    family: string;
    label: string;
    createdAt: number;
}

export interface UploadLyricsFontResult {
    meta: StoredCustomLyricsFont;
    storedFont: StoredUploadedLyricsFont;
}

const registeredUploadedFontIds = new Set<string>();

const sanitizeUploadedFontId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

const stripFontExtension = (name: string) => {
    const trimmed = name.trim();
    const matchedExtension = SUPPORTED_FONT_EXTENSIONS.find(extension => trimmed.toLowerCase().endsWith(extension));
    if (!matchedExtension) {
        return trimmed || 'Uploaded Font';
    }

    return trimmed.slice(0, -matchedExtension.length) || 'Uploaded Font';
};

const buildUploadedFontFamily = (id: string) => `${UPLOADED_FONT_FAMILY_PREFIX}_${sanitizeUploadedFontId(id)}`;

const buildUploadedFontId = (file: File) => {
    const baseName = stripFontExtension(file.name).replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${Date.now()}_${baseName || 'font'}`;
};

const getFontFaceConstructor = () => (globalThis as typeof globalThis & {
    FontFace?: new (family: string, source: BufferSource | string) => FontFace;
}).FontFace;

const getDocumentFonts = () => {
    if (typeof document === 'undefined' || !document.fonts?.add) {
        return null;
    }

    return document.fonts;
};

export const isSupportedLyricsFontFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    const hasSupportedExtension = SUPPORTED_FONT_EXTENSIONS.some(extension => lowerName.endsWith(extension));

    return hasSupportedExtension || SUPPORTED_FONT_MIME_TYPES.has(file.type);
};

export const validateUploadedLyricsFontFile = (file: File): string | null => {
    if (!isSupportedLyricsFontFile(file)) {
        return 'Only woff2, woff, ttf, and otf font files are supported.';
    }

    if (file.size > MAX_UPLOADED_LYRICS_FONT_SIZE) {
        return 'Font file must not exceed 50MB.';
    }

    return null;
};

export const buildStoredUploadedLyricsFont = (file: File): StoredUploadedLyricsFont => {
    const id = buildUploadedFontId(file);

    return {
        id,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        blob: file,
        family: buildUploadedFontFamily(id),
        label: stripFontExtension(file.name),
        createdAt: Date.now(),
    };
};

export const registerUploadedLyricsFont = async (storedFont: StoredUploadedLyricsFont): Promise<StoredCustomLyricsFont> => {
    if (registeredUploadedFontIds.has(storedFont.id)) {
        return {
            source: 'uploaded',
            family: storedFont.family,
            label: storedFont.label,
            fontId: storedFont.id,
        };
    }

    const FontFaceConstructor = getFontFaceConstructor();
    const documentFonts = getDocumentFonts();

    if (!FontFaceConstructor || !documentFonts) {
        throw new Error('This browser does not support loading uploaded fonts.');
    }

    const fontData = await storedFont.blob.arrayBuffer();
    const fontFace = new FontFaceConstructor(storedFont.family, fontData);
    await fontFace.load();
    documentFonts.add(fontFace);
    registeredUploadedFontIds.add(storedFont.id);

    return {
        source: 'uploaded',
        family: storedFont.family,
        label: storedFont.label,
        fontId: storedFont.id,
    };
};

export const uploadAndRegisterLyricsFont = async (file: File): Promise<UploadLyricsFontResult> => {
    const validationError = validateUploadedLyricsFontFile(file);
    if (validationError) {
        throw new Error(validationError);
    }

    const storedFont = buildStoredUploadedLyricsFont(file);
    const meta = await registerUploadedLyricsFont(storedFont);
    await saveToCache(UPLOADED_LYRICS_FONT_KEY, storedFont);

    return { meta, storedFont };
};

export const getStoredUploadedLyricsFont = async (): Promise<StoredUploadedLyricsFont | null> => {
    const stored = await getFromCache<StoredUploadedLyricsFont>(UPLOADED_LYRICS_FONT_KEY);

    if (!stored?.id || !stored.family || !stored.label || !(stored.blob instanceof Blob)) {
        return null;
    }

    return stored;
};

export const restoreUploadedLyricsFont = async (fontId: string): Promise<StoredCustomLyricsFont | null> => {
    const storedFont = await getStoredUploadedLyricsFont();
    if (!storedFont || storedFont.id !== fontId) {
        return null;
    }

    return registerUploadedLyricsFont(storedFont);
};

export const clearUploadedLyricsFont = async (): Promise<void> => {
    registeredUploadedFontIds.clear();
    await removeFromCache(UPLOADED_LYRICS_FONT_KEY);
};

export { MAX_UPLOADED_LYRICS_FONT_SIZE, UPLOADED_LYRICS_FONT_KEY };
