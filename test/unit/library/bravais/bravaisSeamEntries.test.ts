// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidersHorizontal } from 'lucide-react';

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { HomeSeamShortcuts } from '@/library/suites/bravais/BravaisSeamHome';
import type { BravaisHomeEntry } from '@/library/suites/bravais/bravaisHomeModels';

// test/unit/library/bravais/bravaisSeamEntries.test.ts
// 首页窄缝直达入口那一列里的动作入口（探索页的「偏好设置」这类）：排在直达入口后面，竖排名字，点了直接做事；
// 测量副本里也有它（窄缝放不下时它和直达入口一起让位）。没有直达入口时这一列只有它。

let root: Root | null = null;
let host: HTMLDivElement;

const render = async (element: React.ReactElement) => {
    await act(async () => {
        root = createRoot(host);
        root.render(element);
    });
};

const entry = (run = vi.fn()): BravaisHomeEntry => ({ id: 'recommendation-preferences', label: 'Preferences', icon: SlidersHorizontal, run });

beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
});

describe('action entries in the seam column', () => {
    it('draws an entry alone in the column and runs it on a press', async () => {
        const run = vi.fn();
        await render(React.createElement(HomeSeamShortcuts, { shortcuts: [], entries: [entry(run)], rule: false, label: 'Jump to' }));
        const button = host.querySelector<HTMLButtonElement>('[data-bravais-seam-action="recommendation-preferences"]');
        expect(button?.textContent).toBe('Preferences');
        expect(button?.getAttribute('aria-label')).toBe('Preferences');
        act(() => button!.click());
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('puts the entry after the special collections', async () => {
        const open = vi.fn();
        await render(React.createElement(HomeSeamShortcuts, {
            shortcuts: [{ special: 'daily', label: 'Daily', itemKey: 'k', direct: false, open }],
            entries: [entry()],
            rule: false,
        }));
        const order = Array.from(host.querySelectorAll('button')).map(button => button.getAttribute('data-bravais-seam-action'));
        expect(order).toEqual(['shortcut-daily', 'recommendation-preferences']);
    });

    it('keeps the entry in the measuring copy, as text that cannot be pressed', async () => {
        await render(React.createElement(HomeSeamShortcuts, { shortcuts: [], entries: [entry()], rule: false, measure: true }));
        expect(host.querySelector('button')).toBeNull();
        expect(host.textContent).toBe('Preferences');
    });
});
