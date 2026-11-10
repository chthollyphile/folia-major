// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Grid3DSlider } from '../../../src/library/suites/grid/home/Grid3DSlider';
import ConfirmDialog from '../../../src/components/shared/ConfirmDialog';
import Sheet, { SheetLayerContext } from '../../../src/components/shared/Sheet';
import { hasBlockingWindow, hasOpenSheet } from '../../../src/utils/keyboardTargets';

// test/unit/shared/sheetKeyboard.test.ts
// Who has the keyboard while a dialog is open. Each case needs a key pressed at one moment with
// one thing focused, which nobody tries by hand on every dialog: Enter on a question, Enter with a
// dialog over the home page, Tab with the Ponder stage over a dialog, and a dialog open before the
// app shell has its layer.

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

/** A window that says it has the keyboard, as every window and dialog of the app does. */
const openKeyboardWindow = () => {
    const keyboardWindow = document.createElement('div');
    keyboardWindow.setAttribute('data-folia-keyboard-window', 'true');
    const button = document.createElement('button');
    keyboardWindow.appendChild(button);
    document.body.appendChild(keyboardWindow);
    return { keyboardWindow, button };
};

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no scrollTo on an element; the home page's slider calls it when it mounts.
    Element.prototype.scrollTo = () => {};
});

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    document.body.replaceChildren();
});

describe('a question', () => {
    const question = (confirmVariant: 'primary' | 'danger') => React.createElement(ConfirmDialog, {
        isOpen: true,
        title: 'Question',
        cancelText: 'No',
        confirmText: 'Yes',
        confirmVariant,
        onConfirm: () => {},
        onClose: () => {},
    });

    it('opens with focus on its answer, so that Enter gives it', async () => {
        await render(question('primary'));
        expect(document.activeElement?.textContent).toBe('Yes');
    });

    it('opens with focus on the way out when the answer destroys something', async () => {
        await render(question('danger'));
        expect(document.activeElement?.textContent).toBe('No');
    });
});

describe('a sheet', () => {
    const sheet = () => React.createElement(Sheet, { isOpen: true, onClose: () => {}, title: 'Sheet', children: 'content' });

    it('is found, while it is open, by what the keys behind it ask', async () => {
        await render(sheet());
        expect(hasBlockingWindow()).toBe(true);
        expect(hasOpenSheet()).toBe(true);

        await render(React.createElement(Sheet, { isOpen: false, onClose: () => {}, title: 'Sheet', children: 'content' }));
        expect(hasBlockingWindow()).toBe(false);
        expect(hasOpenSheet()).toBe(false);

        // Another window has the keyboard: not a sheet.
        openKeyboardWindow();
        expect(hasOpenSheet()).toBe(false);
    });

    it('leaves Tab alone while focus is in another window that has the keyboard', async () => {
        await render(sheet());
        // The Ponder stage, opened over the sheet.
        const { button } = openKeyboardWindow();
        button.focus();

        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        button.dispatchEvent(tab);

        expect(tab.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(button);
    });

    it('waits for the layer of the app shell instead of drawing itself twice', async () => {
        const inLayer = (layer: HTMLElement | null) => React.createElement(SheetLayerContext.Provider, { value: layer }, sheet());
        // The shell's first render: its layer is not there yet.
        await render(inLayer(null));
        expect(document.querySelector('[role="dialog"]')).toBeNull();

        const layer = document.createElement('div');
        document.body.appendChild(layer);
        await render(inLayer(layer));
        expect(layer.querySelector('[role="dialog"]')).not.toBeNull();
    });
});

describe('the slider of the home page', () => {
    const slider = (selected: string[]) => React.createElement(Grid3DSlider, {
        items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
        focusedIndex: 0,
        onFocusedIndexChange: () => {},
        onSelect: item => selected.push(String(item.id)),
        isInteractive: true,
        isDaylight: false,
    });
    const pressEnter = () => act(async () => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    it('opens the focused card on Enter, and leaves Enter to a dialog that is open over it', async () => {
        const selected: string[] = [];
        await render(slider(selected));
        await pressEnter();
        expect(selected).toEqual(['a']);

        const { keyboardWindow } = openKeyboardWindow();
        await pressEnter();
        expect(selected).toEqual(['a']);

        keyboardWindow.remove();
        await pressEnter();
        expect(selected).toEqual(['a', 'a']);
    });
});
