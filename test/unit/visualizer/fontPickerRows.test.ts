// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import FontPicker, { type LocalFontEntry } from '../../../src/components/visualizer/window/FontPicker';

// test/unit/visualizer/fontPickerRows.test.ts
// The rows of the font picker's list keep the keyboard. A row that is thrown away and made again
// loses the focus to the page's body, and Escape and Tab then act on the page instead of the
// picker. Nothing of that shows by looking: the list looks the same either way.

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom lays nothing out: the list's box is given a height, and nobody watches its size.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 320 });
    (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts = async () => (
        [{ family: 'Alpha' }, { family: 'Beta' }, { family: 'Gamma' }]
    );
});

describe('the rows of the font picker', () => {
    let host: HTMLElement;
    let root: Root;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
    });

    const draw = (family: string | null, onChoose: (font: LocalFontEntry) => void) => act(async () => {
        root.render(React.createElement(FontPicker, {
            family,
            label: family ?? '',
            fallbackFamilies: [],
            fontStyle: 'sans',
            onChoose,
            onClear: () => {},
            onClose: () => {},
        }));
    });
    const rows = () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];

    it('keep the focus when the window draws again with a new handler, and when the chosen font changes', async () => {
        const first = vi.fn();
        await draw(null, first);
        expect(rows().map(row => row.textContent)).toEqual(['AlphaAlpha', 'BetaBeta', 'GammaGamma']);
        const beta = rows()[1];
        beta.focus();
        expect(document.activeElement).toBe(beta);

        // The window draws again: its handler is a new function every time.
        const second = vi.fn();
        await draw(null, second);
        expect(beta.isConnected).toBe(true);
        expect(document.activeElement).toBe(beta);

        // A press goes to the newest handler.
        await act(async () => beta.click());
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith({ family: 'Beta', label: 'Beta' });

        // The choice comes back as the chosen font: the same row, now marked.
        await draw('Beta', vi.fn());
        expect(beta.isConnected).toBe(true);
        expect(document.activeElement).toBe(beta);
        expect(beta.getAttribute('aria-pressed')).toBe('true');
    });
});
