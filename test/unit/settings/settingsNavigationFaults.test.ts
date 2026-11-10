// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SettingsAnchor } from '../../../src/components/modal/settings/navigation/settingsAnchorStore';
import { useSettingsLanding, type SettingsLandingTarget } from '../../../src/components/modal/settings/navigation/useSettingsLanding';
import { useSettingsScrollSpy } from '../../../src/hooks/useSettingsScrollSpy';

// test/unit/settings/settingsNavigationFaults.test.ts
// Two rules of moving about a settings page that depend on what happened before, so that looking
// at the page once does not show them: which tab the header marks after a click on a tab whose
// group cannot scroll to the top, and what becomes of a jump to a place the page does not draw.

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
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('the tab the header marks', () => {
    // A column 1000 high over five groups of 300: it scrolls 500 at most, so the third group
    // (at 600) cannot reach the top. jsdom lays nothing out; the places are given here.
    const GROUP_HEIGHT = 300;
    const VIEW_HEIGHT = 1000;
    const ids = ['a', 'b', 'c', 'd', 'e'];

    const buildColumn = () => {
        const column = document.createElement('div');
        const maxScroll = ids.length * GROUP_HEIGHT - VIEW_HEIGHT;
        let scrollTop = 0;
        Object.defineProperties(column, {
            scrollTop: { get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
            scrollHeight: { get: () => ids.length * GROUP_HEIGHT },
            clientHeight: { get: () => VIEW_HEIGHT },
        });
        column.getBoundingClientRect = () => new DOMRect(0, 0, 800, VIEW_HEIGHT);
        column.scrollTo = ((options: ScrollToOptions) => {
            scrollTop = Math.min(maxScroll, Math.max(0, options.top ?? 0));
        }) as typeof column.scrollTo;
        const anchors: SettingsAnchor[] = ids.map((id, index) => {
            const node = document.createElement('div');
            node.dataset.settingsAnchor = id;
            node.getBoundingClientRect = () => new DOMRect(0, index * GROUP_HEIGHT - scrollTop, 800, GROUP_HEIGHT);
            column.appendChild(node);
            return { id, label: id, node };
        });
        document.body.appendChild(column);
        return { column, anchors };
    };

    it('stays the one that was clicked when its group cannot reach the top, until the column is scrolled by hand', async () => {
        vi.useFakeTimers();
        // The observer reports when a group crosses an edge of the column: here, when the test says so.
        let groupCrossesEdge = () => {};
        vi.stubGlobal('IntersectionObserver', class {
            constructor(callback: () => void) {
                groupCrossesEdge = callback;
            }
            observe() {}
            disconnect() {}
        });
        const { column, anchors } = buildColumn();
        const columnRef = { current: column };
        let spy: ReturnType<typeof useSettingsScrollSpy> | null = null;
        const Probe: React.FC = () => {
            spy = useSettingsScrollSpy({ containerRef: columnRef, anchors, enabled: true, reducedMotion: true });
            return null;
        };
        await render(React.createElement(Probe));

        await act(async () => spy!.scrollToAnchor('c'));
        expect(column.scrollTop).toBe(500);
        expect(spy!.activeAnchorId).toBe('c');

        // After the wait that covers the scroll, and at any later report of the observer.
        await act(async () => {
            vi.advanceTimersByTime(1000);
        });
        expect(spy!.activeAnchorId).toBe('c');
        await act(async () => groupCrossesEdge());
        expect(spy!.activeAnchorId).toBe('c');

        // Scrolled by hand: the place decides again, and at the end of the column that is the last group.
        await act(async () => {
            column.dispatchEvent(new Event('wheel'));
            groupCrossesEdge();
        });
        expect(spy!.activeAnchorId).toBe('e');
    });
});

describe('a jump to a place the page does not draw', () => {
    const landOn = (target: SettingsLandingTarget, column: HTMLElement, anchors: SettingsAnchor[], scrolledTo: string[]) => {
        const columnRef = { current: column };
        const scrollToAnchor = (id: string) => scrolledTo.push(id);
        const Probe: React.FC<{ anchors: SettingsAnchor[] }> = props => {
            useSettingsLanding(target, columnRef, props.anchors, scrollToAnchor, true);
            return null;
        };
        return (next: SettingsAnchor[] = anchors) => render(React.createElement(Probe, { anchors: next }));
    };
    const group = (column: HTMLElement, id: string): SettingsAnchor => {
        const node = document.createElement('div');
        node.dataset.settingsAnchor = id;
        column.appendChild(node);
        return { id, label: id, node };
    };

    it('lands when the group is drawn a moment later, and is given up when it is drawn long after', async () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        const column = document.createElement('div');
        document.body.appendChild(column);

        // A group that waits for a status to load.
        const soon: string[] = [];
        const drawSoon = landOn({ id: 'late', seq: 1 }, column, [], soon);
        await drawSoon();
        now.mockReturnValue(400);
        await drawSoon([group(column, 'late')]);
        expect(soon).toEqual(['late']);

        // A group the user draws much later, by flipping the switch it depends on.
        await act(async () => root!.unmount());
        root = null;
        now.mockReturnValue(1000);
        const later: string[] = [];
        const drawLater = landOn({ id: 'other', seq: 2 }, column, [], later);
        await drawLater();
        now.mockReturnValue(60_000);
        await drawLater([group(column, 'other')]);
        expect(later).toEqual([]);
    });
});
