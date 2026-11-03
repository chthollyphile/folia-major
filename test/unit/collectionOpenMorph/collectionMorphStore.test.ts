import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    planForOpening,
    reportMorphCapture,
    useCollectionMorphStore,
} from '@/library/suites/grid/transitions/collectionMorphStore';
import type { CollectionMorphCapture } from '@/library/suites/grid/transitions/morphProbes';
import {
    COLLECTION_MORPH_OBSERVATION_WINDOW_MS,
    COLLECTION_MORPH_PLAN_TTL_MS,
    type CollectionMorphCard,
    type CollectionMorphPending,
    type CollectionMorphRect,
    type CollectionMorphTitle,
} from '@/library/suites/grid/transitions/morphGeometry';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '@/components/app/home/gridViewCollectionAdapters';

// test/unit/collectionOpenMorph/collectionMorphStore.test.ts
// 转场状态机：采集 → 观察窗口 → 计划 → 退出。这些分支以前完全没有测试，而它们的失败
// 方式都是「界面看起来没反应」或者「下次打开时卡片莫名其妙是空的」，靠肉眼很难定位。

const rect = (x: number, y: number, width = 200, height = 200): CollectionMorphRect => ({ x, y, width, height });

const titled = (text: string, at: CollectionMorphRect): CollectionMorphTitle => ({
    rect: at, text, width: at.width, height: at.height, fontSize: 14, style: {},
});

const capture = (sourceKey: string | null = 'grid3d:2'): CollectionMorphCapture => ({
    rect: rect(110, 110, 180, 180),
    radius: 12,
    url: 'cover.jpg',
    proportions: 1,
    frame: null,
    title: titled('Card Title', rect(110, 300, 180, 20)),
    sourceKey,
});

/** The card at the middle of the page being left. */
const hero = (): CollectionMorphCard => ({
    rect: rect(610, 410, 280, 280),
    radius: 8,
    url: 'song.jpg',
    proportions: 1,
    frame: null,
    title: titled('Song Title', rect(610, 700, 280, 20)),
});

const emptyState = {
    pending: null,
    plan: null,
    lastHome: null,
    lastHomeRoot: '',
    lastSource: null,
    lastSourceDepth: 0,
    lastSourceNavigation: null,
    exit: null,
};

/** 使用不同集合构造导航栈，允许测试通过真实 push 模拟后续导航。 */
const openAtDepth = (depth: number) => {
    useCollectionNavigationStore.setState({
        snapshot: {
            origin: 'home',
            stack: Array.from({ length: depth }, (_, index) => ({
                source: 'online', type: 'playlist', id: String(index), name: `Collection ${index}`,
            } as GridViewCollectionDescriptor)),
        },
    });
};

describe('collection morph store', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        useCollectionMorphStore.setState({ ...emptyState });
        useCollectionNavigationStore.setState({ snapshot: null });
    });

    afterEach(() => {
        useCollectionMorphStore.setState({ ...emptyState });
        useCollectionNavigationStore.setState({ snapshot: null });
        vi.useRealTimers();
    });

    describe('reportMorphCapture', () => {
        it('records the navigation state as it was BEFORE the click', () => {
            reportMorphCapture(capture());
            expect(useCollectionMorphStore.getState().pending?.navAtGestureStart).toEqual({ wasOpen: false, depth: 0 });
            expect(useCollectionMorphStore.getState().pending?.capturedAt).toBe(Date.now());
        });

        it('carries the current depth when a collection is already open', () => {
            openAtDepth(2);
            reportMorphCapture(capture('item:42'));
            expect(useCollectionMorphStore.getState().pending?.navAtGestureStart).toEqual({ wasOpen: true, depth: 2 });
        });

        it('drops the capture after the observation window so a centering click never morphs', () => {
            reportMorphCapture(capture());
            expect(useCollectionMorphStore.getState().pending).not.toBeNull();

            vi.advanceTimersByTime(COLLECTION_MORPH_OBSERVATION_WINDOW_MS - 1);
            expect(useCollectionMorphStore.getState().pending).not.toBeNull();

            vi.advanceTimersByTime(1);
            expect(useCollectionMorphStore.getState().pending).toBeNull();
        });

        it('keeps a launched plan alive: ackPending cancels the discard window', () => {
            reportMorphCapture(capture());
            useCollectionMorphStore.getState().commitPlan({ kind: 'morph' }, 1);
            useCollectionMorphStore.getState().ackPending();

            // 观察窗口已经过去（discard 会调 consume 清掉 plan），但还没到 plan 自己的 TTL。
            vi.advanceTimersByTime(COLLECTION_MORPH_OBSERVATION_WINDOW_MS + 100);
            expect(useCollectionMorphStore.getState().plan).toEqual({ kind: 'morph' });
        });
    });

    describe('whose plan it is', () => {
        const planFor = (depth: number) => {
            const { plan, planDepth } = useCollectionMorphStore.getState();
            return planDepth === depth ? plan : null;
        };

        it('is the plan of the page at the depth it was committed for, and of no other', () => {
            // An album is opened from the page at depth 1: the plan is the album page's.
            useCollectionMorphStore.getState().commitPlan({ kind: 'morph', coverUrl: 'album.jpg' }, 2);
            expect(planFor(2)).toEqual({ kind: 'morph', coverUrl: 'album.jpg' });
            // Gone back through the history while it lasts, the page at depth 1 mounts again.
            expect(planFor(1)).toBeNull();
        });
    });

    describe('plan lifetime', () => {
        it('expires on its TTL so a stale plan cannot re-trigger a later mount', () => {
            useCollectionMorphStore.getState().commitPlan({ kind: 'cascade' }, 1);
            vi.advanceTimersByTime(COLLECTION_MORPH_PLAN_TTL_MS - 1);
            expect(useCollectionMorphStore.getState().plan).toEqual({ kind: 'cascade' });

            vi.advanceTimersByTime(1);
            expect(useCollectionMorphStore.getState().plan).toBeNull();
        });

        it('restarts the TTL on a fresh plan', () => {
            useCollectionMorphStore.getState().commitPlan({ kind: 'cascade' }, 1);
            vi.advanceTimersByTime(COLLECTION_MORPH_PLAN_TTL_MS - 100);
            useCollectionMorphStore.getState().commitPlan({ kind: 'morph' }, 1);
            vi.advanceTimersByTime(COLLECTION_MORPH_PLAN_TTL_MS - 100);
            expect(useCollectionMorphStore.getState().plan).toEqual({ kind: 'morph' });
        });
    });

    describe('armExit', () => {
        it('does nothing without a remembered home card', () => {
            useCollectionMorphStore.getState().armExit(hero());
            expect(useCollectionMorphStore.getState().exit).toBeNull();
        });

        it('names the home card to land on and how deep the navigation was, and the plan gives way', () => {
            const home = { ...capture(), navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 1 } as CollectionMorphPending;
            openAtDepth(1);
            useCollectionMorphStore.getState().setLastHome(home);
            useCollectionMorphStore.setState({ plan: { kind: 'morph' } });

            useCollectionMorphStore.getState().armExit(hero());

            const exit = useCollectionMorphStore.getState().exit;
            expect(exit).toMatchObject({ from: hero(), sourceKey: 'grid3d:2', nested: false, armedDepth: 1 });
            // 退出时 plan 必须让位，否则网格会一直等着一个不会发生的入场。
            expect(useCollectionMorphStore.getState().plan).toBeNull();
        });
    });

    describe('armExit after a collection was opened without a card', () => {
        const home = { ...capture(), navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 1 } as CollectionMorphPending;
        const another = { source: 'online', type: 'album', id: 'opened-without-a-card', name: 'Another' } as unknown as GridViewCollectionDescriptor;

        it('does not fly onto the card of the collection a click opened before it', () => {
            openAtDepth(1);
            useCollectionMorphStore.getState().setLastHome(home);
            // 那一次看完退出；之后从没有卡片的地方（探索页、“定位正在播放的歌”）打开了另一个集合。
            useCollectionNavigationStore.getState().openRoot(another, 'home');

            useCollectionMorphStore.getState().armExit(hero());

            expect(useCollectionMorphStore.getState().exit).toBeNull();
        });

        it('still flies home from a level pushed inside the collection the card opened', () => {
            openAtDepth(1);
            useCollectionMorphStore.getState().setLastHome(home);
            useCollectionNavigationStore.getState().push(another);
            useCollectionNavigationStore.getState().restore({ origin: 'home', stack: useCollectionNavigationStore.getState().snapshot!.stack.slice(0, 1).map(root => ({ ...root })) });

            useCollectionMorphStore.getState().armExit(hero());

            expect(useCollectionMorphStore.getState().exit?.sourceKey).toBe(home.sourceKey);
        });
    });

    // A nested back lands on the stand-in of the page before; what the store decides is the
    // picture that stand-in shows: the card that was clicked for this level, where one is known
    // (the page comes back centred on it), else the picture that flies back.
    describe('armNestedExit', () => {
        it('has the page before show the card captured for the current nesting level', () => {
            openAtDepth(2);
            useCollectionMorphStore.getState().setLastSource(
                { ...capture('item:7'), navAtGestureStart: { wasOpen: true, depth: 1 }, capturedAt: 1 } as CollectionMorphPending,
                2,
            );

            useCollectionMorphStore.getState().armNestedExit(hero());

            expect(useCollectionMorphStore.getState().exit).toMatchObject({ from: hero(), sourceKey: null, nested: true, armedDepth: 2 });
            expect(useCollectionMorphStore.getState().plan).toEqual({ kind: 'morph', coverUrl: 'cover.jpg', title: 'Card Title' });
        });

        it.each([false, true])('rejects a later push at the same depth (same collection: %s)', (sameCollection) => {
            openAtDepth(2);
            const previous = useCollectionNavigationStore.getState().snapshot!;
            const store = useCollectionMorphStore.getState();
            store.setLastSource(
                { ...capture('item:7'), navAtGestureStart: { wasOpen: true, depth: 1 }, capturedAt: 1 },
                2,
            );
            store.consume();
            // Browser back bypasses armNestedExit. Even reopening the same collection
            // must not inherit the previous navigation's source after capture expiry.
            useCollectionNavigationStore.getState().restore({ ...previous, stack: previous.stack.slice(0, 1) });
            reportMorphCapture(capture('item:8'));
            vi.advanceTimersByTime(COLLECTION_MORPH_OBSERVATION_WINDOW_MS);
            useCollectionNavigationStore.getState().push(
                sameCollection ? previous.stack[1] : { ...previous.stack[1], id: 'other' },
            );

            store.armNestedExit(hero());

            expect(useCollectionMorphStore.getState().plan).toEqual({ kind: 'morph', coverUrl: 'song.jpg', title: 'Song Title' });
        });

        it('releases the source after a nested exit finishes', () => {
            openAtDepth(2);
            const store = useCollectionMorphStore.getState();
            store.setLastSource(
                { ...capture('item:7'), navAtGestureStart: { wasOpen: true, depth: 1 }, capturedAt: 1 },
                2,
            );
            store.consume();
            store.armNestedExit(hero());
            expect(useCollectionMorphStore.getState().plan).toEqual({ kind: 'morph', coverUrl: 'cover.jpg', title: 'Card Title' });

            store.consume();

            expect(useCollectionMorphStore.getState()).toMatchObject({
                lastSource: null, lastSourceDepth: 0, lastSourceNavigation: null,
            });
        });

        it('refuses a source captured at another depth (async push whose capture expired)', () => {
            openAtDepth(2);
            useCollectionMorphStore.getState().setLastSource(
                { ...capture('item:7'), navAtGestureStart: { wasOpen: true, depth: 0 }, capturedAt: 1 } as CollectionMorphPending,
                1,
            );

            useCollectionMorphStore.getState().armNestedExit(hero());

            // 对不上的卡片不拿来用：上一页的替身卡画飞回去的那张图。
            expect(useCollectionMorphStore.getState().plan).toEqual({ kind: 'morph', coverUrl: 'song.jpg', title: 'Song Title' });
        });
    });

    describe('planForOpening', () => {
        it('is a morph with the clicked card\'s picture and title while a capture is pending, a cascade without one', () => {
            expect(planForOpening()).toEqual({ kind: 'cascade' });
            reportMorphCapture(capture());
            expect(planForOpening()).toEqual({ kind: 'morph', coverUrl: 'cover.jpg', title: 'Card Title' });
            vi.advanceTimersByTime(COLLECTION_MORPH_OBSERVATION_WINDOW_MS);
            expect(planForOpening()).toEqual({ kind: 'cascade' });
        });
    });

    describe('consume', () => {
        it('keeps lastHome so the eventual back-out still has a landing target', () => {
            const home = { ...capture(), navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 1 } as CollectionMorphPending;
            useCollectionMorphStore.setState({ lastHome: home });

            useCollectionMorphStore.getState().consume();

            expect(useCollectionMorphStore.getState().lastHome).toBe(home);
        });

        it('keeps a capture that arrived after the exit was armed (reopen during the exit)', () => {
            const late = { ...capture(), navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 200 } as CollectionMorphPending;
            useCollectionMorphStore.setState({
                pending: late,
                exit: { from: hero(), nested: false, sourceKey: null, armedDepth: 1, armedAt: 100 },
            });

            useCollectionMorphStore.getState().consume();

            expect(useCollectionMorphStore.getState().pending).toBe(late);
            expect(useCollectionMorphStore.getState().exit).toBeNull();
        });

        it('drops a capture older than the armed exit', () => {
            const stale = { ...capture(), navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 50 } as CollectionMorphPending;
            useCollectionMorphStore.setState({
                pending: stale,
                exit: { from: hero(), nested: false, sourceKey: null, armedDepth: 1, armedAt: 100 },
            });

            useCollectionMorphStore.getState().consume();

            expect(useCollectionMorphStore.getState().pending).toBeNull();
        });
    });

    it('clear wipes every remembered payload', () => {
        const home = { ...capture(), navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 1 } as CollectionMorphPending;
        useCollectionMorphStore.setState({
            pending: home,
            plan: { kind: 'morph' },
            lastHome: home,
            lastSource: home,
            lastSourceDepth: 1,
            exit: { from: hero(), nested: false, sourceKey: null, armedDepth: 1, armedAt: 1 },
        });

        useCollectionMorphStore.getState().clear();

        expect(useCollectionMorphStore.getState()).toMatchObject(emptyState);
    });

    // The poster wall's grown tile is a card like the others: the page opened from it remembers
    // it under its own kind of key, and the flight back is armed to land on it.
    describe('a page opened from the poster wall', () => {
        it('arms the flight back onto the wall\'s tile', () => {
            reportMorphCapture(capture('lattice:album-7'));
            expect(planForOpening()).toEqual({ kind: 'morph', coverUrl: 'cover.jpg', title: 'Card Title' });
            openAtDepth(1);
            // What the overlay does when it starts the flight to the page.
            useCollectionMorphStore.getState().setLastHome(useCollectionMorphStore.getState().pending!);
            useCollectionMorphStore.getState().ackPending();

            useCollectionMorphStore.getState().armExit(hero());

            expect(useCollectionMorphStore.getState().exit).toMatchObject({ sourceKey: 'lattice:album-7', nested: false, armedDepth: 1 });
        });
    });

    // The overlay runs an armed exit and draws the carrier. It is inside the home screen, which
    // is taken down for the poster wall and for the player: what it had under way must not be
    // found by its next mount.
    describe('overlayTakenDown', () => {
        afterEach(() => {
            useCollectionMorphStore.setState({ carrier: null });
        });

        it('leaves no armed exit and no carrier behind', () => {
            const home = { ...capture(), navAtGestureStart: { wasOpen: false, depth: 0 }, capturedAt: 1 } as CollectionMorphPending;
            openAtDepth(1);
            useCollectionMorphStore.getState().setLastHome(home);
            useCollectionMorphStore.getState().armExit(hero());
            useCollectionMorphStore.getState().setCarrier('flies');
            expect(useCollectionMorphStore.getState().exit).not.toBeNull();

            useCollectionMorphStore.getState().overlayTakenDown();

            expect(useCollectionMorphStore.getState()).toMatchObject({ exit: null, carrier: null });
            // The card the page was opened from is kept, as at the end of any flight.
            expect(useCollectionMorphStore.getState().lastHome).toBe(home);
        });

        it('leaves a capture and its plan alone where no exit is armed', () => {
            reportMorphCapture(capture('lattice:album-7'));
            useCollectionMorphStore.getState().commitPlan(planForOpening(), 1);
            const { pending, plan } = useCollectionMorphStore.getState();

            useCollectionMorphStore.getState().overlayTakenDown();

            expect(useCollectionMorphStore.getState().pending).toBe(pending);
            expect(useCollectionMorphStore.getState().plan).toBe(plan);
        });
    });
});
