// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FoliumProgressContext } from '@/mods/folium/contract';
import type { FoliumHostContext } from '@/mods/folium/helpers';
import {
    progressButtonsRegistry,
    FoliumProgressButtons,
    FoliumProgressLayers,
    progressLayersRegistry,
} from '@/mods/folium/registries/progress';

// test/unit/mod-system/foliumProgressClicks.test.ts
// Host progress bar extensions inside the floating capsule. The capsule opens
// the player on click; a click on a mod's button or marker must not reach it,
// even when the mod does not stop propagation itself. A button can also stay
// off the collapsed capsule (hideWhenCollapsed).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ctx = {} as FoliumHostContext<FoliumProgressContext>;

/* A mount that draws one clickable button and does not stop propagation. */
const buttonMount = (container: HTMLElement) => {
    const button = document.createElement('button');
    button.dataset.testid = 'mod-button';
    button.style.pointerEvents = 'auto';
    container.appendChild(button);
    return () => button.remove();
};

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    progressButtonsRegistry.unregisterAll('mod-a');
    progressLayersRegistry.unregisterAll('mod-a');
    document.body.replaceChildren();
});

/* Renders `child` inside a clickable surface and clicks the mod's button. */
const clickModButton = (child: React.ReactElement) => {
    const onSurfaceClick = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement('div', { onClick: onSurfaceClick }, child)));
    const button = Array.from(document.querySelectorAll('[data-folium-entry]'))
        .map((container) => (container.shadowRoot ?? container).querySelector<HTMLButtonElement>('[data-testid="mod-button"]'))
        .find(Boolean);
    expect(button).toBeTruthy();
    act(() => button!.click());
    return onSurfaceClick;
};

describe('clicks inside progress bar extensions', () => {
    it('do not reach the surface around a progress button slot', () => {
        progressButtonsRegistry.register('mod-a', { id: 'plain', slot: 'progress.trailing', mount: buttonMount });
        const onSurfaceClick = clickModButton(React.createElement(FoliumProgressButtons, { slot: 'progress.trailing', ctx }));
        expect(onSurfaceClick).not.toHaveBeenCalled();
    });

    it('do not reach the surface around the progress layers', () => {
        progressLayersRegistry.register('mod-a', { id: 'plain', mount: buttonMount });
        const onSurfaceClick = clickModButton(React.createElement(FoliumProgressLayers, { ctx }));
        expect(onSurfaceClick).not.toHaveBeenCalled();
    });
});

describe('hideWhenCollapsed', () => {
    /* Renders the trailing slot and returns the ids of the mounted buttons. */
    const mountedIds = (collapsed: boolean) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(React.createElement(FoliumProgressButtons, { slot: 'progress.trailing', ctx, collapsed })));
        const ids = Array.from(document.querySelectorAll('[data-folium-entry]')).map((container) => container.getAttribute('data-folium-entry'));
        act(() => root!.unmount());
        root = null;
        host.remove();
        return ids;
    };

    it('leaves the button out of a collapsed bar only', () => {
        progressButtonsRegistry.register('mod-a', { id: 'wide', slot: 'progress.trailing', hideWhenCollapsed: true, mount: buttonMount });
        progressButtonsRegistry.register('mod-a', { id: 'always', slot: 'progress.trailing', mount: buttonMount });
        expect(mountedIds(false)).toEqual(['mod-a:always', 'mod-a:wide']);
        expect(mountedIds(true)).toEqual(['mod-a:always']);
    });

    it('rejects a non-boolean value', () => {
        expect(() => progressButtonsRegistry.register('mod-a', { id: 'bad', slot: 'progress.trailing', hideWhenCollapsed: 'yes' as never, mount: buttonMount }))
            .toThrow(/hideWhenCollapsed/);
    });
});
