// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import StudioWindow from '../../../src/components/shared/StudioWindow';

// test/unit/shared/studioWindowLayer.test.ts
// The layer a work window draws over itself, and the keyboard: Escape closes the layer and not the
// window, also when the focus has fallen on the page's body, and when the layer goes the focus
// stays inside the window. Where this goes wrong nothing looks different; the next key does.

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom lays nothing out: every control counts as one that is on screen.
    HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
});

describe('the layer over a work window', () => {
    let host: HTMLElement;
    let root: Root;
    /** The owner of the window: it closes the window on Escape, as the settings window does. */
    const ownerHeard = vi.fn();
    const onWindowKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') ownerHeard();
    };

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        ownerHeard.mockClear();
        window.addEventListener('keydown', onWindowKey);
    });

    afterEach(async () => {
        window.removeEventListener('keydown', onWindowKey);
        await act(async () => root.unmount());
        host.remove();
    });

    const draw = (parts: { over?: React.ReactNode; onOverClose?: () => void; column?: React.ReactNode }) => act(async () => {
        root.render(React.createElement(StudioWindow, {
            title: 'A window',
            onBack: () => {},
            backLabel: 'Back',
            stage: React.createElement('div'),
            over: parts.over,
            onOverClose: parts.onOverClose,
            isDaylight: false,
            children: parts.column ?? React.createElement('button', { id: 'opener' }, 'open'),
        }));
    });
    const layer = React.createElement('div', null, React.createElement('button', { id: 'in-layer' }, 'a font'));
    const press = (target: EventTarget, key: string) => act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    const frame = () => host.querySelector<HTMLElement>('[role="dialog"]');

    it('closes on Escape with the focus inside it, and the owner does not hear of the press', async () => {
        const onOverClose = vi.fn();
        await draw({ over: layer, onOverClose });
        const inLayer = host.querySelector<HTMLElement>('#in-layer');
        expect(document.activeElement).toBe(inLayer);
        await press(inLayer!, 'Escape');
        expect(onOverClose).toHaveBeenCalledTimes(1);
        expect(ownerHeard).not.toHaveBeenCalled();
    });

    it('closes on Escape with the focus on the body too', async () => {
        const onOverClose = vi.fn();
        await draw({ over: layer, onOverClose });
        (document.activeElement as HTMLElement).blur();
        expect(document.activeElement).toBe(document.body);
        await press(document.body, 'Escape');
        expect(onOverClose).toHaveBeenCalledTimes(1);
        expect(ownerHeard).not.toHaveBeenCalled();
    });

    it('leaves Escape to the owner when no layer is open, and to a dialog opened over the window', async () => {
        const onOverClose = vi.fn();
        await draw({ onOverClose });
        await press(document.body, 'Escape');
        expect(ownerHeard).toHaveBeenCalledTimes(1);

        await draw({ over: layer, onOverClose });
        const dialog = document.createElement('button');
        document.body.appendChild(dialog);
        await press(dialog, 'Escape');
        dialog.remove();
        expect(onOverClose).not.toHaveBeenCalled();
        expect(ownerHeard).toHaveBeenCalledTimes(2);
    });

    it('gives the focus back to what opened it, and to the window\'s frame when that is gone', async () => {
        await draw({});
        const opener = host.querySelector<HTMLElement>('#opener')!;
        opener.focus();
        await draw({ over: layer, onOverClose: () => {} });
        expect(document.activeElement).toBe(host.querySelector('#in-layer'));
        await draw({});
        expect(document.activeElement).toBe(opener);

        // The control that opened the layer is taken away while the layer is open.
        await draw({ over: layer, onOverClose: () => {} });
        await draw({ over: layer, onOverClose: () => {}, column: React.createElement('span') });
        await draw({ column: React.createElement('span') });
        expect(document.activeElement).toBe(frame());
    });
});
