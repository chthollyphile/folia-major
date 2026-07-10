import { beforeEach, describe, expect, it } from 'vitest';
import { useThemeQuickEditorStore } from '@/stores/useThemeQuickEditorStore';
import type { DualTheme } from '@/types';

// test/unit/theme/themeQuickEditorStore.test.ts
// Covers the shared quick editor state for AI, fallback AI, and custom themes.

const aiTheme: DualTheme = {
    light: {
        name: 'AI Light',
        backgroundColor: '#ffffff',
        primaryColor: '#111111',
        accentColor: '#2563eb',
        secondaryColor: '#475569',
        fontStyle: 'sans',
        animationIntensity: 'normal',
    },
    dark: {
        name: 'AI Dark',
        backgroundColor: '#111827',
        primaryColor: '#f8fafc',
        accentColor: '#7dd3fc',
        secondaryColor: '#cbd5e1',
        fontStyle: 'sans',
        animationIntensity: 'normal',
    },
};

const customTheme: DualTheme = {
    light: {
        ...aiTheme.light,
        name: 'Custom Light',
        provider: 'Custom',
    },
    dark: {
        ...aiTheme.dark,
        name: 'Custom Dark',
        provider: 'Custom',
    },
};

describe('useThemeQuickEditorStore', () => {
    beforeEach(() => {
        useThemeQuickEditorStore.setState({
            aiTheme: null,
            customTheme: null,
            bgMode: 'default',
            coverUrl: null,
            song: null,
            songKey: null,
            isDaylight: false,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
            isOpen: false,
            editorKind: null,
            canOpenEditor: false,
        });
    });

    it('stores the latest editor context snapshot', () => {
        useThemeQuickEditorStore.getState().setContext({
            aiTheme,
            customTheme,
            bgMode: 'ai',
            coverUrl: 'https://example.test/cover.jpg',
            song: null,
            songKey: 42,
            isDaylight: true,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
        });

        expect(useThemeQuickEditorStore.getState()).toMatchObject({
            aiTheme,
            customTheme,
            bgMode: 'ai',
            coverUrl: 'https://example.test/cover.jpg',
            songKey: 42,
            isDaylight: true,
            isOpen: false,
            canOpenEditor: true,
        });
    });

    it('opens AI and fallback dual themes through the AI editor kind', () => {
        useThemeQuickEditorStore.getState().setContext({
            aiTheme,
            customTheme: null,
            bgMode: 'ai',
            coverUrl: null,
            song: null,
            songKey: null,
            isDaylight: false,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
        });

        useThemeQuickEditorStore.getState().openEditor('ai');
        expect(useThemeQuickEditorStore.getState()).toMatchObject({
            isOpen: true,
            editorKind: 'ai',
        });
    });

    it('opens custom themes through the custom editor kind', () => {
        useThemeQuickEditorStore.getState().setContext({
            aiTheme: null,
            customTheme,
            bgMode: 'custom',
            coverUrl: null,
            song: null,
            songKey: null,
            isDaylight: false,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
        });

        useThemeQuickEditorStore.getState().openEditor('custom');
        expect(useThemeQuickEditorStore.getState()).toMatchObject({
            isOpen: true,
            editorKind: 'custom',
        });
    });

    it('uses the active editable source when no editor kind is passed', () => {
        useThemeQuickEditorStore.getState().setContext({
            aiTheme,
            customTheme,
            bgMode: 'custom',
            coverUrl: null,
            song: null,
            songKey: null,
            isDaylight: false,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
        });
        useThemeQuickEditorStore.getState().openEditor();
        expect(useThemeQuickEditorStore.getState().editorKind).toBe('custom');

        useThemeQuickEditorStore.getState().closeEditor();
        useThemeQuickEditorStore.getState().setContext({
            aiTheme,
            customTheme,
            bgMode: 'ai',
            coverUrl: null,
            song: null,
            songKey: null,
            isDaylight: false,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
        });
        useThemeQuickEditorStore.getState().openEditor();
        expect(useThemeQuickEditorStore.getState().editorKind).toBe('ai');
    });

    it('opens the AI editor even before an AI theme has been generated', () => {
        useThemeQuickEditorStore.getState().setContext({
            aiTheme: null,
            customTheme: null,
            bgMode: 'default',
            coverUrl: null,
            song: null,
            songKey: null,
            isDaylight: false,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
        });

        useThemeQuickEditorStore.getState().openEditor();
        expect(useThemeQuickEditorStore.getState()).toMatchObject({
            isOpen: true,
            editorKind: 'ai',
            canOpenEditor: true,
        });
    });

    it('does not open unavailable custom editor kinds', () => {
        useThemeQuickEditorStore.getState().setContext({
            aiTheme: null,
            customTheme: null,
            bgMode: 'default',
            coverUrl: null,
            song: null,
            songKey: null,
            isDaylight: false,
            promptSourceText: null,
            isPureMusic: false,
            songTitle: undefined,
        });

        useThemeQuickEditorStore.getState().openEditor('custom');
        expect(useThemeQuickEditorStore.getState().isOpen).toBe(false);
    });
});
