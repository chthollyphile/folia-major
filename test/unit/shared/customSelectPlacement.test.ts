// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CustomSelect } from '../../../src/components/shared/CustomSelect';

// test/unit/shared/customSelectPlacement.test.ts
// Which side of its trigger a pick list opens on. A list that asks to open above goes there when
// the whole list fits there, and below when it does not: decided by how tall the list is, not by a
// fixed height. The trigger's place and the window's height are given here; jsdom lays nothing out.

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.restoreAllMocks();
});

const WINDOW_HEIGHT = 700;
const TRIGGER_HEIGHT = 32;

/** Opens a compact list of `count` options whose trigger has `above` px of window over it. */
const sideOfList = async (count: number, above: number, preferAbove: boolean): Promise<'above' | 'below'> => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(WINDOW_HEIGHT);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        top: above, bottom: above + TRIGGER_HEIGHT, left: 900, right: 1100, width: 200, height: TRIGGER_HEIGHT, x: 900, y: above,
        toJSON: () => ({}),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const options = Array.from({ length: count }, (_, index) => ({ value: `v${index}`, label: `Option ${index}` }));
    await act(async () => {
        root!.render(React.createElement(CustomSelect, { value: 'v0', options, onChange: () => {}, compact: true, preferAbove }));
    });
    await act(async () => {
        document.querySelector<HTMLElement>('[role="combobox"]')!.click();
    });
    const side = document.querySelector<HTMLElement>('[role="listbox"]')!.style.bottom ? 'above' : 'below';
    await act(async () => {
        root!.unmount();
    });
    host.remove();
    root = null;
    host = null;
    return side;
};

describe('the side a pick list opens on', () => {
    // A compact list is 30 px a row, 2 px between rows, 8 px of padding and a 2 px border:
    // three options are 104 px, five are 168 px. 12 px of the room go to the gap and the edge.

    it('opens above when asked to and the whole list fits there, however little room that is', async () => {
        expect(await sideOfList(3, 104 + 12, true)).toBe('above');
        expect(await sideOfList(5, 168 + 12, true)).toBe('above');
    });

    it('opens below when asked to open above and the list would be cut there', async () => {
        expect(await sideOfList(5, 168 + 12 - 1, true)).toBe('below');
        expect(await sideOfList(3, 104 + 12 - 1, true)).toBe('below');
    });

    it('opens below when not asked to open above', async () => {
        expect(await sideOfList(3, 300, false)).toBe('below');
    });
});
