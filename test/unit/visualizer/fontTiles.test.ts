// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PictureGrid } from '../../../src/components/modal/settings/kit/PictureGrid';
import { FontTiles, type FontChoice } from '../../../src/components/visualizer/window/FontTiles';

// test/unit/visualizer/fontTiles.test.ts
// The font pictures of the lyric style window and the keyboard. Choosing a built-in font there
// deletes a chosen custom font, its fallback list and an uploaded font file, and the 'custom'
// picture opens the font picker. A fault here shows only to someone who walks the grid with the
// arrow keys, and then it has already deleted: so the rule is held here.

const OPTIONS: Array<{ value: FontChoice; label: string }> = [
    { value: 'sans', label: 'Sans' },
    { value: 'serif', label: 'Serif' },
    { value: 'mono', label: 'Mono' },
    { value: 'custom', label: 'My font' },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

const render = async (element: React.ReactElement) => {
    if (!root) {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(element);
    });
};

const tile = (value: string) => document.querySelector<HTMLElement>(`[data-value="${value}"]`)!;

const press = (key: string) => act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
});

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
});

describe('the font pictures and the arrow keys', () => {
    const fonts = (value: FontChoice, chosen: FontChoice[]) => React.createElement(FontTiles, {
        value,
        options: OPTIONS,
        customFamily: value === 'custom' ? 'My font' : null,
        label: 'Font',
        onChange: (next: FontChoice) => chosen.push(next),
    });

    it('chooses nothing with a custom font chosen: arrows, Home and End only move the focus', async () => {
        const chosen: FontChoice[] = [];
        await render(fonts('custom', chosen));
        await act(async () => tile('custom').focus());

        await press('ArrowLeft');
        expect(document.activeElement).toBe(tile('mono'));
        await press('Home');
        expect(document.activeElement).toBe(tile('sans'));
        await press('ArrowRight');
        expect(document.activeElement).toBe(tile('serif'));
        await press('End');
        expect(document.activeElement).toBe(tile('custom'));
        await press('ArrowUp');
        await press('ArrowDown');

        // Nothing was chosen, so nothing was stored and no custom font was deleted.
        expect(chosen).toEqual([]);
    });

    it('does not open the font picker by arriving at the custom picture', async () => {
        const chosen: FontChoice[] = [];
        await render(fonts('sans', chosen));
        await act(async () => tile('sans').focus());

        await press('ArrowRight');
        await press('ArrowRight');
        await press('ArrowRight');
        expect(document.activeElement).toBe(tile('custom'));
        await press('End');
        expect(chosen).toEqual([]);

        // A press (which is also what Enter and Space do on a button) chooses.
        await act(async () => tile('custom').click());
        expect(chosen).toEqual(['custom']);
    });

    it('keeps Tab with the picture that has the focus, and gives it back to the chosen one on leaving', async () => {
        await render(fonts('custom', []));
        await act(async () => tile('custom').focus());
        await press('ArrowLeft');
        expect(tile('mono').tabIndex).toBe(0);
        expect(tile('custom').tabIndex).toBe(-1);

        await act(async () => tile('mono').blur());
        expect(tile('custom').tabIndex).toBe(0);
        expect(tile('mono').tabIndex).toBe(-1);
    });
});

describe('a picture grid that was not told otherwise', () => {
    it('still chooses with the arrow keys', async () => {
        const chosen: string[] = [];
        await render(React.createElement(PictureGrid<string>, {
            value: 'b',
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }],
            picture: () => null,
            columns: 3,
            label: 'Kind',
            onChange: (next: string) => chosen.push(next),
        }));
        await act(async () => tile('b').focus());
        await press('ArrowLeft');
        expect(chosen).toEqual(['a']);
        expect(tile('b').tabIndex).toBe(0);
    });
});
