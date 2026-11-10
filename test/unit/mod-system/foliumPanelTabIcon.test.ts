// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
        },
    });
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Puzzle } from 'lucide-react';
import { foliumPanelTabIcon, playerPanelTabsRegistry, useFoliumPanelTabs } from '@/mods/folium/registries/playerPanelTabs';
import { loadLucideIcons, lucideExportName } from '@/services/lucideIconResolver';

// test/unit/mod-system/foliumPanelTabIcon.test.ts
// Folium 1.9: a player panel tab names its icon. The lucide icon it names is drawn once it has loaded; the
// puzzle stands in until then, for a name lucide does not have, and for a tab that names none.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const host = () => document.body.firstElementChild as HTMLElement;
const render = (element: React.ReactElement) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(element));
};
const drawnIcon = () => host().querySelector('svg')?.getAttribute('class') ?? '';

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    playerPanelTabsRegistry.unregisterAll('mod-a');
});

describe('foliumPanelTabIcon', () => {
    it('is the puzzle for a tab that names no icon', () => {
        expect(foliumPanelTabIcon(undefined)).toBe(Puzzle);
        expect(foliumPanelTabIcon('')).toBe(Puzzle);
        expect(foliumPanelTabIcon(42)).toBe(Puzzle);
    });

    it('takes the names `folium.ui.icon` takes and no other spelling', () => {
        expect(foliumPanelTabIcon('MessageCircle')).toBe(Puzzle);
        expect(foliumPanelTabIcon(' message-circle ')).toBe(Puzzle);
        expect(foliumPanelTabIcon('message-circle')).not.toBe(Puzzle);
    });

    it('is one component for each name, so a tab\'s icon is not remounted from render to render', () => {
        expect(foliumPanelTabIcon('message-circle')).toBe(foliumPanelTabIcon('message-circle'));
        expect(foliumPanelTabIcon('message-circle')).not.toBe(foliumPanelTabIcon('info'));
    });

    it('draws the named lucide icon at the size asked for, once it has loaded', async () => {
        render(React.createElement(foliumPanelTabIcon('message-circle'), { size: 16 }));
        await act(async () => { await loadLucideIcons([lucideExportName('message-circle')]); });
        expect(drawnIcon()).toContain('lucide-message-circle');
        expect(host().querySelector('svg')?.getAttribute('width')).toBe('16');
    });

    it('keeps the puzzle for a name lucide does not have', async () => {
        render(React.createElement(foliumPanelTabIcon('no-such-icon-anywhere'), { size: 16 }));
        await act(async () => { await loadLucideIcons([lucideExportName('no-such-icon-anywhere')]); });
        expect(drawnIcon()).toContain('lucide-puzzle');
    });
});

describe('useFoliumPanelTabs', () => {
    it('gives each tab the icon its definition names', () => {
        playerPanelTabsRegistry.register('mod-a', { id: 'comments', label: { en: 'Comments' }, icon: 'message-circle', mount: () => () => {} });
        playerPanelTabsRegistry.register('mod-a', { id: 'plain', label: { en: 'Plain' }, mount: () => () => {} });
        let tabs: ReturnType<typeof useFoliumPanelTabs> = [];
        const Probe: React.FC = () => {
            tabs = useFoliumPanelTabs();
            return null;
        };
        render(React.createElement(Probe));
        const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab.icon]));
        expect(byId['folium:mod-a:comments']).toBe(foliumPanelTabIcon('message-circle'));
        expect(byId['folium:mod-a:plain']).toBe(Puzzle);
    });
});
