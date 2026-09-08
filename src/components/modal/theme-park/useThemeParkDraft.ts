import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DualTheme, Theme, ThemeMode } from '../../../types';
import {
    normalizeThemeParkDualTheme,
    patchDualThemeMode,
    patchDualThemeShared,
    type EditableColorKey,
    type EditableMode,
    type ThemeEditTarget,
} from './themeParkDraft';

// src/components/modal/theme-park/useThemeParkDraft.ts
// Owns the Theme Park editing session: one draft per edit target (AI / custom) so switching
// targets never loses unsaved work, plus the throttled color writes the picker drags through.

const COLOR_THROTTLE_MS = 33; // ~30fps, same budget as the quick editor

type UseThemeParkDraftOptions = {
    aiTheme: DualTheme | null;
    customTheme: DualTheme | null;
    bgMode: ThemeMode;
    seedTheme: DualTheme;
    isDaylight: boolean;
    defaultCustomTheme?: DualTheme;
};

const resolveInitialTarget = (
    bgMode: ThemeMode,
    aiTheme: DualTheme | null,
    customTheme: DualTheme | null,
): ThemeEditTarget => {
    if (bgMode === 'custom' && customTheme) return 'custom';
    if (bgMode === 'ai') return 'ai';
    return aiTheme ? 'ai' : 'custom';
};

export const useThemeParkDraft = ({
    aiTheme,
    customTheme,
    bgMode,
    seedTheme,
    isDaylight,
    defaultCustomTheme,
}: UseThemeParkDraftOptions) => {
    const [target, setTarget] = useState<ThemeEditTarget>(() => resolveInitialTarget(bgMode, aiTheme, customTheme));
    const hasChosenTargetRef = useRef(false);
    const chooseTarget = useCallback((nextTarget: ThemeEditTarget) => {
        hasChosenTargetRef.current = true;
        setTarget(nextTarget);
    }, []);
    const [mode, setMode] = useState<EditableMode>(() => (isDaylight ? 'light' : 'dark'));
    const [activeColorKey, setActiveColorKey] = useState<EditableColorKey>('accentColor');

    // seedTheme is rebuilt on every parent render, so it is only read once: it is just the
    // fallback used when a target has no saved theme yet, never a reason to rebuild the baseline.
    const seedThemeRef = useRef(seedTheme);

    const baseThemes = useMemo<Record<ThemeEditTarget, DualTheme>>(() => ({
        ai: normalizeThemeParkDualTheme(aiTheme ?? seedThemeRef.current, 'ai'),
        custom: normalizeThemeParkDualTheme(customTheme ?? seedThemeRef.current, 'custom'),
    }), [aiTheme, customTheme]);

    const [drafts, setDrafts] = useState<Record<ThemeEditTarget, DualTheme>>(baseThemes);
    const previousBaseThemesRef = useRef(baseThemes);

    // A theme saved or regenerated elsewhere refreshes the baseline, but only replaces a draft the
    // user has not touched yet - an in-progress edit is never thrown away underneath them.
    useEffect(() => {
        const previousBaseThemes = previousBaseThemesRef.current;
        if (previousBaseThemes === baseThemes) {
            return;
        }
        previousBaseThemesRef.current = baseThemes;

        setDrafts(current => ({
            ai: current.ai === previousBaseThemes.ai ? baseThemes.ai : current.ai,
            custom: current.custom === previousBaseThemes.custom ? baseThemes.custom : current.custom,
        }));
    }, [baseThemes]);

    // Until the user picks a target explicitly, follow the app's current theme source.
    useEffect(() => {
        if (hasChosenTargetRef.current) {
            return;
        }
        setTarget(resolveInitialTarget(bgMode, aiTheme, customTheme));
    }, [aiTheme, bgMode, customTheme]);

    useEffect(() => {
        setMode(isDaylight ? 'light' : 'dark');
    }, [isDaylight]);

    const draft = drafts[target];
    const baseTheme = baseThemes[target];

    const throttleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingColorRef = useRef<{ target: ThemeEditTarget; mode: EditableMode; key: EditableColorKey; color: string; } | null>(null);

    const applyDraft = useCallback((nextTarget: ThemeEditTarget, update: (previous: DualTheme) => DualTheme) => {
        setDrafts(previous => ({ ...previous, [nextTarget]: update(previous[nextTarget]) }));
    }, []);

    const flushPendingColor = useCallback(() => {
        if (throttleTimeoutRef.current) {
            clearTimeout(throttleTimeoutRef.current);
            throttleTimeoutRef.current = null;
        }

        const pending = pendingColorRef.current;
        pendingColorRef.current = null;
        return pending;
    }, []);

    // The picker fires at 60fps; commit at most every COLOR_THROTTLE_MS and keep the latest value
    // so a drag that ends between ticks is not lost.
    const updateColorThrottled = useCallback((color: string) => {
        pendingColorRef.current = { target, mode, key: activeColorKey, color };
        if (throttleTimeoutRef.current) {
            return;
        }

        throttleTimeoutRef.current = setTimeout(() => {
            throttleTimeoutRef.current = null;
            const pending = pendingColorRef.current;
            pendingColorRef.current = null;
            if (!pending) {
                return;
            }
            applyDraft(pending.target, previous => patchDualThemeMode(previous, pending.mode, { [pending.key]: pending.color }));
        }, COLOR_THROTTLE_MS);
    }, [activeColorKey, applyDraft, mode, target]);

    const updateColorInstant = useCallback((color: string) => {
        flushPendingColor();
        applyDraft(target, previous => patchDualThemeMode(previous, mode, { [activeColorKey]: color }));
    }, [activeColorKey, applyDraft, flushPendingColor, mode, target]);

    const updateModeField = useCallback((patch: Partial<Theme>, targetMode: EditableMode = mode) => {
        applyDraft(target, previous => patchDualThemeMode(previous, targetMode, patch));
    }, [applyDraft, mode, target]);

    const updateSharedField = useCallback((patch: Partial<Theme>) => {
        applyDraft(target, previous => patchDualThemeShared(previous, patch));
    }, [applyDraft, target]);

    const replaceDraft = useCallback((nextTheme: DualTheme) => {
        flushPendingColor();
        applyDraft(target, () => normalizeThemeParkDualTheme(nextTheme, target, baseTheme));
    }, [applyDraft, baseTheme, flushPendingColor, target]);

    const reset = useCallback(() => {
        flushPendingColor();
        if (target === 'custom' && defaultCustomTheme) {
            const patchColors = (source: Theme) => ({
                backgroundColor: source.backgroundColor,
                primaryColor: source.primaryColor,
                accentColor: source.accentColor,
                secondaryColor: source.secondaryColor,
            });
            applyDraft(target, previous => ({
                ...previous,
                light: { ...previous.light, ...patchColors(defaultCustomTheme.light) },
                dark: { ...previous.dark, ...patchColors(defaultCustomTheme.dark) },
            }));
            return;
        }
        applyDraft(target, () => baseTheme);
    }, [applyDraft, baseTheme, defaultCustomTheme, flushPendingColor, target]);

    // Flushes any in-flight picker value, then hands back a sanitized theme fit to save or copy.
    const buildFinalTheme = useCallback(() => {
        const pending = flushPendingColor();
        const pendingDraft = pending && pending.target === target
            ? patchDualThemeMode(drafts[target], pending.mode, { [pending.key]: pending.color })
            : drafts[target];

        return normalizeThemeParkDualTheme(pendingDraft, target, baseTheme);
    }, [baseTheme, drafts, flushPendingColor, target]);

    useEffect(() => () => {
        if (throttleTimeoutRef.current) {
            clearTimeout(throttleTimeoutRef.current);
        }
    }, []);

    const safeDraft = useMemo(
        () => normalizeThemeParkDualTheme(draft, target, baseTheme),
        [baseTheme, draft, target],
    );

    return {
        target,
        setTarget: chooseTarget,
        mode,
        setMode,
        activeColorKey,
        setActiveColorKey,
        draft,
        safeDraft,
        baseTheme,
        updateColorThrottled,
        updateColorInstant,
        updateModeField,
        updateSharedField,
        replaceDraft,
        reset,
        buildFinalTheme,
    };
};
