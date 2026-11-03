// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FoliumMountHost } from '@/mods/runtime/FoliumMountHost';

// test/unit/mod-system/foliumMountHostEntry.test.ts
// A mod's markup can sit in a ShadowRoot, out of reach of a Ponder selector; its host container
// cannot. The container names the mod, the kind of entry and the entry itself, so a Ponder target
// can point at exactly one of a mod's entries.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
});

describe('FoliumMountHost', () => {
    it('marks its container with the owning mod, the entry kind and the entry id', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(React.createElement(FoliumMountHost, {
            modId: 'mod-a',
            where: 'panel tab mod-a:notes',
            entryKind: 'panel-tab',
            entryId: 'mod-a:notes',
            mount: () => undefined,
            ctx: { subscribe: () => () => {} },
            shadow: true,
        })));
        const container = document.querySelector('[data-folium-entry="mod-a:notes"]');
        expect(container).not.toBeNull();
        expect(container!.getAttribute('data-folium-owner')).toBe('mod-a');
        expect(container!.getAttribute('data-folium-kind')).toBe('panel-tab');
        expect(document.querySelector('[data-folium-kind="panel-tab"][data-folium-owner="mod-a"]')).toBe(container);
    });
});
