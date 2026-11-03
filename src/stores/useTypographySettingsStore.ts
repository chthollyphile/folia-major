// src/stores/useTypographySettingsStore.ts
// Lyric and subtitle typography: the font stacks, scales and weights, plus how the bottom
// subtitle overlay presents itself.
//
// Split out of useSettingsUiStore. These are read by the visualizers and the subtitle overlay on
// every render, so they get their own subscription rather than riding a settings-wide snapshot.

import { create } from 'zustand';
import i18n from '../i18n/config';
import { clearUploadedLyricsFont, uploadAndRegisterLyricsFont } from '../services/customLyricsFont';
import { type StatusMessage, type StoredCustomLyricsFont, type SubtitleContentMode, type SubtitleOverlayLayout, type Theme } from '../types';
import { normalizeFontFamilyStack, normalizeFontWeight } from '../utils/fontStacks';
import { parseSubtitleOverlayLayout, subtitleOverlayLayoutFromContentMode } from '../utils/lyrics/subtitleOverlayLayout';
import { getStoredBoolean, setStoredBoolean, setStoredString } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';

export const SUBTITLE_OVERLAY_OPACITY_STORAGE_KEY = 'subtitle_overlay_opacity';

export const SUBTITLE_OVERLAY_BACKGROUND_STORAGE_KEY = 'subtitle_overlay_background';

export const SUBTITLE_UPCOMING_LYRICS_BLUR_STORAGE_KEY = 'subtitle_upcoming_lyrics_blur';

export const SHOW_HARMONY_SUBTITLE_STORAGE_KEY = 'show_harmony_subtitle';

export const HARMONY_SUBTITLE_BACKGROUND_STORAGE_KEY = 'harmony_subtitle_background';

export const SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY = 'show_subtitle_translation';

export const SUBTITLE_CONTENT_MODE_STORAGE_KEY = 'subtitle_content_mode';

export const SUBTITLE_OVERLAY_LAYOUT_STORAGE_KEY = 'subtitle_overlay_layout';

const LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY = 'lyrics_font_fallback_families';

const LYRICS_FONT_WEIGHT_STORAGE_KEY = 'lyrics_font_weight';

const SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY = 'subtitle_font_inherits_lyrics';

const SUBTITLE_FONT_SCALE_STORAGE_KEY = 'subtitle_font_scale';

const SUBTITLE_FONT_STYLE_STORAGE_KEY = 'subtitle_font_style';

const SUBTITLE_FONT_FAMILY_STORAGE_KEY = 'subtitle_font_family';

const SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY = 'subtitle_font_fallback_families';

const SUBTITLE_FONT_WEIGHT_STORAGE_KEY = 'subtitle_font_weight';

export const readStoredSubtitleContentMode = (): SubtitleContentMode => {
    if (typeof window === 'undefined') {
        return 'translation';
    }
    const saved = localStorage.getItem(SUBTITLE_CONTENT_MODE_STORAGE_KEY);
    if (saved === 'translation' || saved === 'romanization' || saved === 'both' || saved === 'none') {
        return saved;
    }
    return getStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, true) ? 'translation' : 'none';
};

/**
 * The bottom subtitle's rows. Before it had its own, it followed 副字幕内容: the first read derives the
 * layout from that and keeps it, so changing 副字幕内容 afterwards (for Monet and the rest) leaves it be.
 */
export const readStoredSubtitleOverlayLayout = (): SubtitleOverlayLayout => {
    if (typeof window === 'undefined') {
        return 'translation';
    }
    const saved = parseSubtitleOverlayLayout(localStorage.getItem(SUBTITLE_OVERLAY_LAYOUT_STORAGE_KEY));
    if (saved) {
        return saved;
    }
    const migrated = subtitleOverlayLayoutFromContentMode(readStoredSubtitleContentMode());
    setStoredString(SUBTITLE_OVERLAY_LAYOUT_STORAGE_KEY, migrated);
    return migrated;
};

const readStoredSubtitleOverlayOpacity = () => {
    if (typeof window === 'undefined') {
        return 0.6;
    }

    const saved = localStorage.getItem(SUBTITLE_OVERLAY_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 0.6;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.2, parsed)) : 0.6;
};

const readStoredLyricsFontStyle = (): Theme['fontStyle'] => {
    if (typeof window === 'undefined') {
        return 'sans';
    }

    const saved = localStorage.getItem('lyrics_font_style');
    return saved === 'serif' || saved === 'mono' ? saved : 'sans';
};

const readStoredFontScale = (key: string): number => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem(key);
    if (!saved) return 1;

    const parsed = parseFloat(saved);
    if (!Number.isFinite(parsed)) return 1;

    return Math.min(1.4, Math.max(0.85, parsed));
};

const readStoredFontWeight = (key: string): number | null => {
    if (typeof window === 'undefined') return null;

    const saved = localStorage.getItem(key);
    if (saved === null) return null;

    return normalizeFontWeight(Number(saved));
};

const readStoredFontFamilyStack = (key: string): string[] => {
    if (typeof window === 'undefined') {
        return [];
    }

    const saved = localStorage.getItem(key);
    if (!saved) return [];

    try {
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed)) {
            return normalizeFontFamilyStack(parsed.map(item => typeof item === 'string' ? item : ''));
        }

        if (typeof parsed === 'string') {
            return normalizeFontFamilyStack(parsed.split(','));
        }
    } catch {
        return normalizeFontFamilyStack(saved.split(','));
    }

    return [];
};

const readStoredSubtitleFontStyle = (): Theme['fontStyle'] => {
    if (typeof window === 'undefined') {
        return 'sans';
    }

    const saved = localStorage.getItem(SUBTITLE_FONT_STYLE_STORAGE_KEY);
    return saved === 'serif' || saved === 'mono' ? saved : 'sans';
};

const readStoredSubtitleFontFamily = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    return localStorage.getItem(SUBTITLE_FONT_FAMILY_STORAGE_KEY)?.trim() || null;
};

const storeFontFamilyStack = (key: string, families: string[]) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(normalizeFontFamilyStack(families)));
    }
};

export const resolveStoredCustomLyricsFont = (parsed: Partial<StoredCustomLyricsFont>): StoredCustomLyricsFont | null => {
    const family = parsed.family?.trim();
    if (!family) return null;

    const source = parsed.source === 'uploaded' ? 'uploaded' : 'system';
    const label = parsed.label?.trim() || family;

    if (source === 'uploaded') {
        const fontId = parsed.fontId?.trim();
        if (!fontId) return null;

        return {
            source,
            family,
            label,
            fontId,
        };
    }

    return {
        source,
        family,
        label,
    };
};

const readStoredCustomLyricsFont = (): StoredCustomLyricsFont | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const saved = localStorage.getItem('lyrics_custom_font');
    if (!saved) return null;

    try {
        const parsed = JSON.parse(saved) as Partial<StoredCustomLyricsFont>;
        return resolveStoredCustomLyricsFont(parsed);
    } catch {
        return null;
    }
};

export type TypographySettingsState = {
    hidePlayerTranslationSubtitle: boolean;
    showSubtitleTranslation: boolean;
    subtitleContentMode: SubtitleContentMode;
    subtitleOverlayLayout: SubtitleOverlayLayout;
    subtitleOverlayOpacity: number;
    subtitleOverlayBackground: boolean;
    subtitleUpcomingLyricsBlur: boolean;
    showHarmonySubtitle: boolean;
    harmonySubtitleBackground: boolean;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsFontWeight: number | null;
    lyricsCustomFont: StoredCustomLyricsFont | null;
    lyricsFontFallbackFamilies: string[];
    subtitleFontInheritsLyrics: boolean;
    subtitleFontScale: number;
    subtitleFontStyle: Theme['fontStyle'];
    subtitleFontWeight: number | null;
    subtitleFontFamily: string | null;
    subtitleFontFallbackFamilies: string[];
    clearLyricsCustomFontAfterRestoreFailure: (message: StatusMessage) => void;
    handleToggleHidePlayerTranslationSubtitle: (enable: boolean) => void;
    handleToggleShowSubtitleTranslation: (enable: boolean) => void;
    handleSetSubtitleContentMode: (mode: SubtitleContentMode) => void;
    handleSetSubtitleOverlayLayout: (layout: SubtitleOverlayLayout) => void;
    handleSetSubtitleOverlayOpacity: (opacity: number) => void;
    handleToggleSubtitleOverlayBackground: (enabled: boolean) => void;
    handleToggleSubtitleUpcomingLyricsBlur: (enabled: boolean) => void;
    handleToggleShowHarmonySubtitle: (enabled: boolean) => void;
    handleToggleHarmonySubtitleBackground: (enabled: boolean) => void;
    handleSetLyricsFontStyle: (fontStyle: Theme['fontStyle']) => void;
    handleSetLyricsFontScale: (fontScale: number) => void;
    handleSetLyricsFontWeight: (fontWeight: number | null) => void;
    handleSetLyricsCustomFont: (font: StoredCustomLyricsFont | null) => void;
    handleUploadLyricsCustomFont: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    handleSetLyricsFontFallbackFamilies: (families: string[]) => void;
    handleSetSubtitleFontInheritsLyrics: (inheritsLyrics: boolean) => void;
    handleSetSubtitleFontScale: (fontScale: number) => void;
    handleSetSubtitleFontStyle: (fontStyle: Theme['fontStyle']) => void;
    handleSetSubtitleFontWeight: (fontWeight: number | null) => void;
    handleSetSubtitleFontFamily: (fontFamily: string | null) => void;
    handleSetSubtitleFontFallbackFamilies: (families: string[]) => void;
};

export const useTypographySettingsStore = create<TypographySettingsState>((set, get) => ({
    hidePlayerTranslationSubtitle: getStoredBoolean('hide_player_translation_subtitle', false),
    showSubtitleTranslation: readStoredSubtitleContentMode() !== 'none',
    subtitleContentMode: readStoredSubtitleContentMode(),
    subtitleOverlayLayout: readStoredSubtitleOverlayLayout(),
    subtitleOverlayOpacity: readStoredSubtitleOverlayOpacity(),
    subtitleOverlayBackground: getStoredBoolean(SUBTITLE_OVERLAY_BACKGROUND_STORAGE_KEY, true),
    subtitleUpcomingLyricsBlur: getStoredBoolean(SUBTITLE_UPCOMING_LYRICS_BLUR_STORAGE_KEY, true),
    showHarmonySubtitle: getStoredBoolean(SHOW_HARMONY_SUBTITLE_STORAGE_KEY, true),
    harmonySubtitleBackground: getStoredBoolean(HARMONY_SUBTITLE_BACKGROUND_STORAGE_KEY, true),
    lyricsFontStyle: readStoredLyricsFontStyle(),
    lyricsFontScale: readStoredFontScale('lyrics_font_scale'),
    lyricsFontWeight: readStoredFontWeight(LYRICS_FONT_WEIGHT_STORAGE_KEY),
    lyricsCustomFont: readStoredCustomLyricsFont(),
    lyricsFontFallbackFamilies: readStoredFontFamilyStack(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY),
    subtitleFontInheritsLyrics: getStoredBoolean(SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY, true),
    subtitleFontScale: readStoredFontScale(SUBTITLE_FONT_SCALE_STORAGE_KEY),
    subtitleFontStyle: readStoredSubtitleFontStyle(),
    subtitleFontWeight: readStoredFontWeight(SUBTITLE_FONT_WEIGHT_STORAGE_KEY),
    subtitleFontFamily: readStoredSubtitleFontFamily(),
    subtitleFontFallbackFamilies: readStoredFontFamilyStack(SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY),
    clearLyricsCustomFontAfterRestoreFailure: (message) => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('lyrics_custom_font');
        }
        set({ lyricsCustomFont: null });
        setStatusMessage(message);
    },
    handleToggleHidePlayerTranslationSubtitle: (enable) => {
        setStoredBoolean('hide_player_translation_subtitle', enable);
        set({ hidePlayerTranslationSubtitle: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'subtitleHidden' : 'subtitleShown')),
        });
    },
    handleToggleShowSubtitleTranslation: (enable) => {
        setStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, enable);
        const subtitleContentMode: SubtitleContentMode = enable ? 'translation' : 'none';
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_CONTENT_MODE_STORAGE_KEY, subtitleContentMode);
        }
        set({ showSubtitleTranslation: enable, subtitleContentMode });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'translationShown' : 'translationHidden')),
        });
    },
    handleSetSubtitleContentMode: (subtitleContentMode) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_CONTENT_MODE_STORAGE_KEY, subtitleContentMode);
        }
        const showSubtitleTranslation = subtitleContentMode !== 'none';
        setStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, showSubtitleTranslation);
        set({ subtitleContentMode, showSubtitleTranslation });
        setStatusMessage({
            type: 'info',
            text: i18n.t(`notifications.subtitleMode.${subtitleContentMode}`),
        });
    },
    handleSetSubtitleOverlayLayout: (layout) => {
        const next = parseSubtitleOverlayLayout(layout);
        if (!next) {
            return;
        }
        setStoredString(SUBTITLE_OVERLAY_LAYOUT_STORAGE_KEY, next);
        set({ subtitleOverlayLayout: next });
    },
    handleSetSubtitleOverlayOpacity: (opacity) => {
        const next = Math.min(1, Math.max(0.2, opacity));
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_OVERLAY_OPACITY_STORAGE_KEY, String(next));
        }
        set({ subtitleOverlayOpacity: next });
    },
    handleToggleSubtitleOverlayBackground: (enabled) => {
        setStoredBoolean(SUBTITLE_OVERLAY_BACKGROUND_STORAGE_KEY, enabled);
        set({ subtitleOverlayBackground: enabled });
    },
    handleToggleSubtitleUpcomingLyricsBlur: (enabled) => {
        setStoredBoolean(SUBTITLE_UPCOMING_LYRICS_BLUR_STORAGE_KEY, enabled);
        set({ subtitleUpcomingLyricsBlur: enabled });
    },
    handleToggleShowHarmonySubtitle: (enabled) => {
        setStoredBoolean(SHOW_HARMONY_SUBTITLE_STORAGE_KEY, enabled);
        set({ showHarmonySubtitle: enabled });
    },
    handleToggleHarmonySubtitleBackground: (enabled) => {
        setStoredBoolean(HARMONY_SUBTITLE_BACKGROUND_STORAGE_KEY, enabled);
        set({ harmonySubtitleBackground: enabled });
    },
    handleSetLyricsFontStyle: (fontStyle) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('lyrics_font_style', fontStyle);
        }
        set({ lyricsFontStyle: fontStyle });
    },
    handleSetLyricsFontScale: (fontScale) => {
        const next = Math.min(1.4, Math.max(0.85, fontScale));
        if (typeof window !== 'undefined') {
            localStorage.setItem('lyrics_font_scale', String(next));
        }
        set({ lyricsFontScale: next });
    },
    handleSetLyricsFontWeight: (fontWeight) => {
        const next = normalizeFontWeight(fontWeight);
        if (typeof window !== 'undefined') {
            if (next === null) localStorage.removeItem(LYRICS_FONT_WEIGHT_STORAGE_KEY);
            else localStorage.setItem(LYRICS_FONT_WEIGHT_STORAGE_KEY, String(next));
        }
        set({ lyricsFontWeight: next });
    },
    handleSetLyricsCustomFont: (font) => {
        if (!font?.family?.trim()) {
            set({ lyricsCustomFont: null, lyricsFontFallbackFamilies: [] });
            if (typeof window !== 'undefined') {
                localStorage.removeItem('lyrics_custom_font');
                localStorage.removeItem(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY);
            }
            void clearUploadedLyricsFont();
            return;
        }

        const next = resolveStoredCustomLyricsFont(font);
        if (!next) {
            set({ lyricsCustomFont: null, lyricsFontFallbackFamilies: [] });
            if (typeof window !== 'undefined') {
                localStorage.removeItem('lyrics_custom_font');
                localStorage.removeItem(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY);
            }
            void clearUploadedLyricsFont();
            return;
        }

        if (next.source !== 'uploaded') {
            void clearUploadedLyricsFont();
        }

        set({ lyricsCustomFont: next });
        if (typeof window !== 'undefined') {
            localStorage.setItem('lyrics_custom_font', JSON.stringify(next));
        }
    },
    handleUploadLyricsCustomFont: async (file) => {
        try {
            const { meta } = await uploadAndRegisterLyricsFont(file);
            set({ lyricsCustomFont: meta });
            if (typeof window !== 'undefined') {
                localStorage.setItem('lyrics_custom_font', JSON.stringify(meta));
            }
            setStatusMessage({
                type: 'success',
                text: i18n.t('notifications.fontEnabled', { fontName: meta.label || meta.family }),
            });

            return { ok: true };
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : i18n.t('notifications.fontUploadFailed');
            setStatusMessage({ type: 'error', text: message });

            return { ok: false, error: message };
        }
    },
    handleSetLyricsFontFallbackFamilies: (families) => {
        const next = normalizeFontFamilyStack(families);
        storeFontFamilyStack(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY, next);
        set({ lyricsFontFallbackFamilies: next });
    },
    handleSetSubtitleFontInheritsLyrics: (inheritsLyrics) => {
        setStoredBoolean(SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY, inheritsLyrics);
        set({ subtitleFontInheritsLyrics: inheritsLyrics });
    },
    handleSetSubtitleFontScale: (fontScale) => {
        const next = Math.min(1.4, Math.max(0.85, fontScale));
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_FONT_SCALE_STORAGE_KEY, String(next));
        }
        set({ subtitleFontScale: next });
    },
    handleSetSubtitleFontStyle: (fontStyle) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_FONT_STYLE_STORAGE_KEY, fontStyle);
        }
        set({ subtitleFontStyle: fontStyle });
    },
    handleSetSubtitleFontWeight: (fontWeight) => {
        const next = normalizeFontWeight(fontWeight);
        if (typeof window !== 'undefined') {
            if (next === null) localStorage.removeItem(SUBTITLE_FONT_WEIGHT_STORAGE_KEY);
            else localStorage.setItem(SUBTITLE_FONT_WEIGHT_STORAGE_KEY, String(next));
        }
        set({ subtitleFontWeight: next });
    },
    handleSetSubtitleFontFamily: (fontFamily) => {
        const next = fontFamily?.trim() || null;
        if (typeof window !== 'undefined') {
            if (next) {
                localStorage.setItem(SUBTITLE_FONT_FAMILY_STORAGE_KEY, next);
            } else {
                localStorage.removeItem(SUBTITLE_FONT_FAMILY_STORAGE_KEY);
            }
        }
        set({ subtitleFontFamily: next });
    },
    handleSetSubtitleFontFallbackFamilies: (families) => {
        const next = normalizeFontFamilyStack(families);
        storeFontFamilyStack(SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY, next);
        set({ subtitleFontFallbackFamilies: next });
    },
}));

/** The typography half of the former settings snapshot, for the surfaces that edit it all. */
export const selectTypographySettingsSnapshot = (state: TypographySettingsState) => ({
    hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: state.showSubtitleTranslation,
    subtitleContentMode: state.subtitleContentMode,
    subtitleOverlayLayout: state.subtitleOverlayLayout,
    subtitleOverlayOpacity: state.subtitleOverlayOpacity,
    subtitleOverlayBackground: state.subtitleOverlayBackground,
    subtitleUpcomingLyricsBlur: state.subtitleUpcomingLyricsBlur,
    showHarmonySubtitle: state.showHarmonySubtitle,
    harmonySubtitleBackground: state.harmonySubtitleBackground,
    lyricsFontStyle: state.lyricsFontStyle,
    lyricsFontScale: state.lyricsFontScale,
    lyricsFontWeight: state.lyricsFontWeight,
    lyricsCustomFont: state.lyricsCustomFont,
    lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
    subtitleFontScale: state.subtitleFontScale,
    subtitleFontStyle: state.subtitleFontStyle,
    subtitleFontWeight: state.subtitleFontWeight,
    subtitleFontFamily: state.subtitleFontFamily,
    subtitleFontFallbackFamilies: state.subtitleFontFallbackFamilies,
    handleToggleHidePlayerTranslationSubtitle: state.handleToggleHidePlayerTranslationSubtitle,
    handleToggleShowSubtitleTranslation: state.handleToggleShowSubtitleTranslation,
    handleSetSubtitleContentMode: state.handleSetSubtitleContentMode,
    handleSetSubtitleOverlayLayout: state.handleSetSubtitleOverlayLayout,
    handleSetSubtitleOverlayOpacity: state.handleSetSubtitleOverlayOpacity,
    handleToggleSubtitleOverlayBackground: state.handleToggleSubtitleOverlayBackground,
    handleToggleSubtitleUpcomingLyricsBlur: state.handleToggleSubtitleUpcomingLyricsBlur,
    handleToggleShowHarmonySubtitle: state.handleToggleShowHarmonySubtitle,
    handleToggleHarmonySubtitleBackground: state.handleToggleHarmonySubtitleBackground,
    handleSetLyricsFontStyle: state.handleSetLyricsFontStyle,
    handleSetLyricsFontScale: state.handleSetLyricsFontScale,
    handleSetLyricsFontWeight: state.handleSetLyricsFontWeight,
    handleSetLyricsCustomFont: state.handleSetLyricsCustomFont,
    handleUploadLyricsCustomFont: state.handleUploadLyricsCustomFont,
    handleSetLyricsFontFallbackFamilies: state.handleSetLyricsFontFallbackFamilies,
    handleSetSubtitleFontInheritsLyrics: state.handleSetSubtitleFontInheritsLyrics,
    handleSetSubtitleFontScale: state.handleSetSubtitleFontScale,
    handleSetSubtitleFontStyle: state.handleSetSubtitleFontStyle,
    handleSetSubtitleFontWeight: state.handleSetSubtitleFontWeight,
    handleSetSubtitleFontFamily: state.handleSetSubtitleFontFamily,
    handleSetSubtitleFontFallbackFamilies: state.handleSetSubtitleFontFallbackFamilies,
    clearLyricsCustomFontAfterRestoreFailure: state.clearLyricsCustomFontAfterRestoreFailure,
    lyricsCustomFontFamily: state.lyricsCustomFont?.family ?? null,
    lyricsCustomFontLabel: state.lyricsCustomFont?.label ?? null,
});
