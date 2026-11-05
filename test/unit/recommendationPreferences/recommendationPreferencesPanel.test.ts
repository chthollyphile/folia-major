// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({
        t: (key: string, options?: { defaultValue?: string }) => (key === 'known.key' ? 'Translated' : options?.defaultValue ?? key),
        i18n: { language: 'en' },
    }),
}));

const statusMessages = vi.hoisted(() => [] as { type: string; text: string }[]);
vi.mock('@/stores/useStatusMessageStore', () => ({
    setStatusMessage: (message: { type: string; text: string }) => { statusMessages.push(message); },
}));

import CommandPalette from '@/components/command-palette/CommandPalette';
import { recommendationPreferencesCommand } from '@/components/command-palette/commands/recommendationPreferencesCommand';
import { recommendationPreferencesSurface } from '@/components/command-palette/surfaces/recommendationPreferencesSurface';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import RecommendationPreferencesPanel from '@/components/recommendationPreferences/RecommendationPreferencesPanel';
import { useRecommendationPreferencesStore } from '@/components/recommendationPreferences/useRecommendationPreferencesStore';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { OnlineRecommendationProvider, RecommendationPreferences } from '@/types/onlineMusic';

// test/unit/recommendationPreferences/recommendationPreferencesPanel.test.ts
// 偏好面板：平台的说明行、选项和滑杆。保存与重置共用写入规则，失败保留面板，旧的写入不能关掉新面板。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const providerId = 'preferences-panel-test';
const label = (labelFallback: string, labelKey?: string) => (labelKey ? { labelKey, labelFallback } : { labelFallback });

const answer = (note = true): RecommendationPreferences => ({
    items: [
        {
            kind: 'choice',
            key: 'mood',
            label: label('Mood', 'known.key'),
            options: [{ value: 'sad', label: label('Sad') }, { value: 'same', label: label('Same') }, { value: 'happy', label: label('Happy') }],
            value: 'sad',
            defaultValue: 'same',
        },
        {
            kind: 'choice',
            key: 'age',
            label: label('Age'),
            options: ['a', 'b', 'c', 'd', 'e'].map(value => ({ value, label: label(value.toUpperCase()) })),
            value: 'a',
            defaultValue: 'a',
        },
        { kind: 'ratio', key: 'live', label: label('Live'), min: 1, max: 99, defaultValue: 50, snapWithin: 4, value: 30 },
    ],
    ...(note ? { note: label('Kept on the account, reaches every recommendation') } : {}),
});

let root: Root | null = null;
let host: HTMLDivElement;

const register = (recommendations: OnlineRecommendationProvider) => {
    registerOnlineMusicProvider({
        id: providerId,
        displayName: providerId,
        capabilities: {
            search: false, playback: false, lyrics: false, auth: true, userLibrary: false,
            playlists: false, albums: false, artists: false, recommendations: true,
            mutations: false, wordByWordLyrics: false, recommendationPreferences: true,
        },
        normalizeSong: () => { throw new Error('not used'); },
        recommendations,
    });
    const accounts = useOnlineProviderAccountStore.getState();
    accounts.setActiveProviderId(providerId);
    accounts.updateAccount(providerId, { status: 'authenticated', user: { id: 'u1', nickname: 'u1' } as never });
};

const render = async (onDone = vi.fn()) => {
    await act(async () => {
        root = createRoot(host);
        root.render(React.createElement(RecommendationPreferencesPanel, { isDaylight: false, theme: {} as never, onClose: onDone }));
    });
    // 读偏好的那一次 await。
    await act(async () => { await Promise.resolve(); });
    return onDone;
};

const button = (text: string) => Array.from(host.querySelectorAll('button')).find(found => found.textContent === text) as HTMLButtonElement | undefined;

const renderInPalette = async () => {
    register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: true }) });
    const onClose = vi.fn();
    const onExecuteActive = vi.fn(async () => false);
    const onActiveIndexChange = vi.fn();
    const onActiveCommandChange = vi.fn();
    // 先取到懒加载模块，让 act 等完面板首次渲染和读偏好。
    await recommendationPreferencesSurface.load!();
    await act(async () => {
        root = createRoot(host);
        root.render(React.createElement(CommandPalette, {
            activeIndex: 0,
            activePreview: null,
            activeCommand: recommendationPreferencesCommand,
            availableCommands: [recommendationPreferencesCommand],
            context: { shared: { t: (key: string) => key } } as CommandPaletteContext,
            isDaylight: false,
            isComposing: false,
            isExecuting: false,
            isOpen: true,
            matches: [],
            pinnedCommands: [],
            query: '',
            theme: {} as never,
            onActiveCommandChange,
            onActiveIndexChange,
            onClose,
            onCompositionEnd: vi.fn(),
            onCompositionStart: vi.fn(),
            onExecuteActive,
            onExecuteMatch: vi.fn(async () => false),
            onExecutePinnedCommand: vi.fn(async () => false),
            onQueryChange: vi.fn(),
            onQueryCommit: vi.fn(),
        }));
    });
    await act(async () => {});
    return { onClose, onExecuteActive, onActiveIndexChange, onActiveCommandChange };
};

const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => { document.activeElement!.dispatchEvent(event); });
    return event.defaultPrevented;
};

beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    statusMessages.length = 0;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('recommendation preferences inside the command palette', () => {
    it('keeps the query read-only and lets Backspace leave from a non-input control', async () => {
        const { onActiveCommandChange } = await renderInPalette();
        const query = host.querySelector<HTMLInputElement>('input[name="folia-command-palette-query"]')!;
        expect(query.readOnly).toBe(true);
        query.focus();
        expect(press('Backspace')).toBe(false);
        expect(onActiveCommandChange).not.toHaveBeenCalled();
        button('recommendationPreferences.reset')!.focus();
        expect(press('Backspace')).toBe(true);
        expect(onActiveCommandChange).toHaveBeenCalledWith(null);
    });

    it.each([
        ['Button', () => button('recommendationPreferences.reset')],
        ['Segmented', () => button('Happy')],
        ['SliderRow', () => host.querySelector<HTMLInputElement>('input[type="range"]')],
    ] as const)('leaves the focused %s its native keys and keeps Escape', async (_name, findControl) => {
        const { onClose, onExecuteActive, onActiveIndexChange } = await renderInPalette();
        const query = host.querySelector<HTMLInputElement>('input[name="folia-command-palette-query"]')!;
        query.focus();
        expect(press('Enter')).toBe(true);
        expect(press('ArrowDown')).toBe(true);
        expect(onExecuteActive).toHaveBeenCalledTimes(1);
        expect(onActiveIndexChange).toHaveBeenCalledTimes(1);
        onExecuteActive.mockClear();
        onActiveIndexChange.mockClear();

        const control = findControl()!;
        control.focus();
        expect(document.activeElement).toBe(control);
        // jsdom 不会用键盘模拟原生点击或滑杆步进。这里验证命令面板没有取消它们的默认行为。
        expect(['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(press)).toEqual(Array(6).fill(false));
        expect(onExecuteActive).not.toHaveBeenCalled();
        expect(onActiveIndexChange).not.toHaveBeenCalled();
        expect(press('Escape')).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps Select keyboard navigation on its trigger while the menu is portaled', async () => {
        const { onClose, onExecuteActive, onActiveIndexChange } = await renderInPalette();
        const trigger = host.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
        trigger.focus();
        expect(press('Enter')).toBe(true);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const menu = document.getElementById(trigger.getAttribute('aria-controls')!)!;
        expect(menu.getAttribute('role')).toBe('listbox');
        expect(host.contains(menu)).toBe(false);
        expect(document.activeElement).toBe(trigger);
        expect(press('ArrowDown')).toBe(true);
        expect(document.getElementById(trigger.getAttribute('aria-activedescendant')!)?.textContent).toBe('B');
        expect(press(' ')).toBe(true);
        expect(useRecommendationPreferencesStore.getState().draft.age).toBe('b');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(onExecuteActive).not.toHaveBeenCalled();
        expect(onActiveIndexChange).not.toHaveBeenCalled();

        expect(press(' ')).toBe(true);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(press('Escape')).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    vi.restoreAllMocks();
    unregisterOnlineMusicProvider(providerId);
    useOnlineProviderAccountStore.getState().clearAccount(providerId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
    useRecommendationPreferencesStore.setState({ owner: null, phase: 'idle', preferences: null, draft: {}, saving: false });
});

describe('the recommendation preferences panel', () => {
    it('shows the provider note, capsules for a few options, a list for many, and words for a ratio', async () => {
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: true }) });
        await render();
        const text = host.textContent ?? '';
        expect(text).toContain('Kept on the account, reaches every recommendation');
        expect(text).toContain('Translated');
        expect(button('Happy')).toBeDefined();
        // 五个选项的那一项是下拉，不是五颗胶囊。
        expect(button('E')).toBeUndefined();
        expect(text).toContain('recommendationPreferences.less');
        expect(text).not.toContain('30');
    });

    it('falls back to the default note when the provider gives none', async () => {
        register({ getRecommendationPreferences: async () => answer(false), saveRecommendationPreferences: async () => ({ confirmed: true }) });
        await render();
        expect(host.textContent).toContain('recommendationPreferences.noteDefault');
    });

    it('shows the slider position only while dragging, including the ends of its range', async () => {
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: true }) });
        await render();
        const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
        const bubble = () => host.querySelector('[data-testid="recommendation-preference-ratio-position"]');
        expect(bubble()).toBeNull();
        act(() => { slider.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
        expect(bubble()?.textContent).toBe('30%');
        act(() => { useRecommendationPreferencesStore.getState().setValue('live', 50); });
        expect(bubble()?.textContent).toBe('50%');
        act(() => { useRecommendationPreferencesStore.getState().setValue('live', 99); });
        expect(bubble()?.textContent).toBe('100%');
        act(() => { useRecommendationPreferencesStore.getState().setValue('live', 1); });
        expect(bubble()?.textContent).toBe('0%');
        act(() => { window.dispatchEvent(new Event('pointercancel')); });
        expect(bubble()).toBeNull();
    });

    it('saves only after a change, hands over the change, and closes', async () => {
        const save = vi.fn(async () => ({ confirmed: true }));
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: save });
        const onDone = await render();
        expect(button('recommendationPreferences.save')?.disabled).toBe(true);

        await act(async () => { button('Happy')!.click(); });
        expect(button('recommendationPreferences.save')?.disabled).toBe(false);
        await act(async () => { button('recommendationPreferences.save')!.click(); });

        expect(save).toHaveBeenCalledWith({ mood: 'happy' });
        expect(statusMessages).toEqual([{ type: 'success', text: 'recommendationPreferences.saved' }]);
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it.each([
        { action: 'save', confirmed: true, type: 'success', text: 'recommendationPreferences.saved' },
        { action: 'reset', confirmed: false, type: 'info', text: 'recommendationPreferences.unconfirmed' },
    ])('reports $action after unmount without closing the next command', async ({ action, confirmed, type, text }) => {
        let finish!: () => void;
        const save = vi.fn(() => new Promise<{ confirmed: boolean }>(resolve => {
            finish = () => resolve({ confirmed });
        }));
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: save });
        const onDone = await render();
        await act(async () => { button('Happy')!.click(); });
        await act(async () => { button(`recommendationPreferences.${action}`)!.click(); });
        expect(save).toHaveBeenCalledTimes(1);

        act(() => root!.render(React.createElement('div', null, 'Next command')));
        expect(host.textContent).toBe('Next command');
        await act(async () => { finish(); });

        expect(statusMessages).toEqual([{ type, text }]);
        expect(onDone).not.toHaveBeenCalled();
    });

    it.each([
        { action: 'save', confirmed: true, type: 'success', text: 'recommendationPreferences.saved' },
        { action: 'reset', confirmed: false, type: 'info', text: 'recommendationPreferences.unconfirmed' },
    ])('keeps the reloaded panel open when an old $action finishes after switching accounts twice', async ({ action, confirmed, type, text }) => {
        let finish!: () => void;
        const save = vi.fn(() => new Promise<{ confirmed: boolean }>(resolve => {
            finish = () => resolve({ confirmed });
        }));
        const read = vi.fn(async () => answer());
        register({ getRecommendationPreferences: read, saveRecommendationPreferences: save });
        const onDone = await render();
        await act(async () => { button('Happy')!.click(); });
        await act(async () => { button(`recommendationPreferences.${action}`)!.click(); });
        expect(save).toHaveBeenCalledTimes(1);

        const switchAccount = (id: string) => act(async () => {
            useOnlineProviderAccountStore.getState().updateAccount(providerId, { user: { id, nickname: id } as never });
        });
        await switchAccount('u2');
        expect(read).toHaveBeenCalledTimes(2);
        await switchAccount('u1');
        expect(useRecommendationPreferencesStore.getState().phase).toBe('loading');
        expect(read).toHaveBeenCalledTimes(2);

        await act(async () => { finish(); });

        expect(statusMessages).toEqual([{ type, text }]);
        expect(onDone).not.toHaveBeenCalled();
        expect(read).toHaveBeenCalledTimes(3);
        expect(useRecommendationPreferencesStore.getState().phase).toBe('ready');
    });

    it.each([true, false])('writes the defaults once and closes when the write is sent (confirmed: %s)', async confirmed => {
        let finish!: () => void;
        const save = vi.fn(() => new Promise<{ confirmed: boolean }>(resolve => {
            finish = () => resolve({ confirmed });
        }));
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: save });
        const onDone = await render();
        await act(async () => { button('Happy')!.click(); });
        await act(async () => {
            const reset = button('recommendationPreferences.reset')!;
            reset.click();
            reset.click();
        });
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith({ mood: 'same', live: 50 });
        expect(onDone).not.toHaveBeenCalled();
        await act(async () => { finish(); });
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(statusMessages).toEqual([confirmed
            ? { type: 'success', text: 'recommendationPreferences.saved' }
            : { type: 'info', text: 'recommendationPreferences.unconfirmed' }]);
    });

    it('closes without a write when the account values already match the defaults', async () => {
        const save = vi.fn(async () => ({ confirmed: true }));
        const preferences = answer();
        preferences.items = preferences.items.map(item => ({ ...item, value: item.defaultValue }) as typeof item);
        register({ getRecommendationPreferences: async () => preferences, saveRecommendationPreferences: save });
        const onDone = await render();
        await act(async () => { button('Happy')!.click(); });
        await act(async () => { button('recommendationPreferences.reset')!.click(); });
        expect(save).not.toHaveBeenCalled();
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('keeps a failed reset open with the default draft ready to save', async () => {
        const save = vi.fn(async () => { throw new Error('down'); });
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: save });
        const onDone = await render();
        await act(async () => { button('recommendationPreferences.reset')!.click(); });
        expect(statusMessages).toEqual([{ type: 'error', text: 'recommendationPreferences.saveFailed' }]);
        expect(onDone).not.toHaveBeenCalled();
        expect(useRecommendationPreferencesStore.getState().draft).toEqual({ mood: 'same', age: 'a', live: 50 });
    });

    it('says when a save failed and stays open with the choice', async () => {
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => { throw new Error('down'); } });
        const onDone = await render();
        await act(async () => { button('Happy')!.click(); });
        await act(async () => { button('recommendationPreferences.save')!.click(); });
        expect(statusMessages).toEqual([{ type: 'error', text: 'recommendationPreferences.saveFailed' }]);
        expect(onDone).not.toHaveBeenCalled();
        expect(useRecommendationPreferencesStore.getState().draft.mood).toBe('happy');
    });

    it('offers a retry when the preferences could not be read', async () => {
        const read = vi.fn()
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValue(answer());
        register({ getRecommendationPreferences: read, saveRecommendationPreferences: async () => ({ confirmed: true }) });
        await render();
        expect(host.textContent).toContain('recommendationPreferences.loadFailed');
        await act(async () => { button('recommendationPreferences.retry')!.click(); });
        await act(async () => { await Promise.resolve(); });
        expect(button('Happy')).toBeDefined();
    });

    it('reads again for the new account when the account changes while it is open', async () => {
        const read = vi.fn(async () => answer());
        register({ getRecommendationPreferences: read, saveRecommendationPreferences: async () => ({ confirmed: true }) });
        await render();
        expect(read).toHaveBeenCalledTimes(1);
        await act(async () => {
            useOnlineProviderAccountStore.getState().updateAccount(providerId, { user: { id: 'u2', nickname: 'u2' } as never });
        });
        await act(async () => { await Promise.resolve(); });
        expect(read).toHaveBeenCalledTimes(2);
        expect(useRecommendationPreferencesStore.getState().owner).toBe(`${providerId}:u2`);
    });

    // 开着时登出：偏好没有主人了，面板不留一块空白，直接收起。
    it('closes when the account signs out while it is open', async () => {
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: true }) });
        const onDone = await render();
        expect(onDone).not.toHaveBeenCalled();
        await act(async () => {
            useOnlineProviderAccountStore.getState().updateAccount(providerId, { status: 'anonymous', user: null } as never);
        });
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});
