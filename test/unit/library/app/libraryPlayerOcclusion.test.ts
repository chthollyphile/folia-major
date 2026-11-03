// @vitest-environment jsdom
import React, { act, createElement, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import LibrarySuiteStageSlot from '@/library/app/LibrarySuiteStageSlot';
import type { ResolvedLibraryStage } from '@/library/registry';
import { buildLibrarySuiteIndex, LIBRARY_ACCOUNT_ACTION_IDS } from '@/library/core/suite/librarySuites';
import type { LibraryNavigationContext, LibrarySuiteManifest, LibrarySuiteStageProps } from '@/library/core/suite/suite.contract';
import {
    NO_LIBRARY_PLAYER_BACKDROP,
    selectLibraryOccludesPlayer,
    selectLibraryPlayerBackdrop,
    useLibraryPlayerOcclusionStore,
    type LibraryPlayerOcclusionOwner,
} from '@/stores/useLibraryPlayerOcclusionStore';
import type { Theme } from '@/types';

// test/unit/library/app/libraryPlayerOcclusion.test.ts
// stage 报告遮挡的通道（B6b）：stage 经 reportPlayerOcclusion 报告，挂载位写进 useLibraryPlayerOcclusionStore。
// 用测试夹具里的假 suite（不进生产 registry）：报 true / false 生效；挂载位卸载、换 suite、换成没有 stage 的 suite
// 都自动复位为 false（stage 不必自己报 false）；旧 stage 晚到的报告不生效；grid（没有 stage）永远是 false。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const surface = (name: string) => Object.assign(() => name, { displayName: name });

const gridLike: LibrarySuiteManifest = {
    id: 'grid',
    labelKey: 'grid',
    surfaces: {
        home: { component: surface('grid-home'), actions: [] },
        collection: { component: surface('grid-collection'), actions: ['play'] },
        artist: { component: surface('grid-artist'), actions: ['play'] },
        account: { component: surface('grid-account'), actions: [...LIBRARY_ACCOUNT_ACTION_IDS] },
    },
};

/** 每个假 stage 最近一次拿到的报告函数，测试借它模拟 stage 的报告（含卸载后晚到的报告）。 */
const reporters: Record<string, LibrarySuiteStageProps['reportPlayerOcclusion']> = {};
/** 同上，透出画面的报告函数（2026-10-09）。 */
const backdropReporters: Record<string, LibrarySuiteStageProps['reportPlayerBackdrop']> = {};
/** 挂载时就报告的初值（模拟 bravais：实色档挂载即报 true）。 */
const initialReports: Record<string, boolean | undefined> = {};

const createFakeStage = (id: string) => (props: LibrarySuiteStageProps) => {
    reporters[id] = props.reportPlayerOcclusion;
    backdropReporters[id] = props.reportPlayerBackdrop;
    useEffect(() => {
        const initial = initialReports[id];
        if (initial !== undefined) props.reportPlayerOcclusion(initial);
    }, [props.reportPlayerOcclusion]);
    return createElement('div', { 'data-fake-stage': id });
};

const HOME: LibraryNavigationContext = { depth: 0, origin: null, activeType: null };
const THEME = {} as Theme;

let container: HTMLDivElement;
let root: Root;
let index: ReturnType<typeof buildLibrarySuiteIndex>;

const resetStore = () => useLibraryPlayerOcclusionStore.setState({
    mountedOwner: null,
    reportOwner: null,
    reportedOccludes: false,
    backdropOwner: null,
    reportedBackdrop: NO_LIBRARY_PLAYER_BACKDROP,
});

beforeEach(() => {
    resetStore();
    for (const key of Object.keys(reporters)) delete reporters[key];
    for (const key of Object.keys(initialReports)) delete initialReports[key];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    index = buildLibrarySuiteIndex([
        gridLike,
        {
            id: 'wall',
            labelKey: 'wall',
            surfaces: { collection: { component: surface('wall-collection'), actions: ['play'] } },
            stage: React.lazy(async () => ({ default: createFakeStage('wall') })),
        },
        {
            id: 'other',
            labelKey: 'other',
            surfaces: { collection: { component: surface('other-collection'), actions: ['play'] } },
            stage: React.lazy(async () => ({ default: createFakeStage('other') })),
        },
    ]);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const occludes = () => selectLibraryOccludesPlayer(useLibraryPlayerOcclusionStore.getState());

/** 照宿主的做法：store 里的 suite id → resolveStage → 挂载位；等 lazy 解析完。strict 时包 StrictMode。 */
const renderSlot = async (suiteId: string, { strict = false } = {}) => {
    const slot = createElement(LibrarySuiteStageSlot, {
        stage: index.resolveStage(suiteId) as unknown as ResolvedLibraryStage | null,
        isInteractive: true,
        theme: THEME,
        isDaylight: false,
        navigation: HOME,
    });
    await act(async () => {
        root.render(strict ? createElement(StrictMode, null, slot) : slot);
    });
    await act(async () => {});
};

const report = async (id: string, value: boolean) => {
    await act(async () => reporters[id](value));
};

describe('library player occlusion channel (B6b)', () => {
    it('follows what the mounted stage reports', async () => {
        await renderSlot('wall');
        expect(occludes()).toBe(false);

        await report('wall', true);
        expect(occludes()).toBe(true);
        await report('wall', false);
        expect(occludes()).toBe(false);
        await report('wall', true);
        expect(occludes()).toBe(true);
    });

    it('takes a report made while the stage mounts (before the slot registers it), also under StrictMode', async () => {
        initialReports.wall = true;
        await renderSlot('wall');
        expect(occludes()).toBe(true);

        await act(async () => root.unmount());
        root = createRoot(container);
        resetStore();
        await renderSlot('wall', { strict: true });
        expect(occludes()).toBe(true);
    });

    it('resets to false when the slot unmounts (Home returning null), without the stage reporting false', async () => {
        initialReports.wall = true;
        await renderSlot('wall');
        expect(occludes()).toBe(true);

        await act(async () => root.unmount());
        expect(occludes()).toBe(false);
        expect(useLibraryPlayerOcclusionStore.getState().mountedOwner).toBeNull();
        root = createRoot(container);
    });

    it('resets to false when switching to a suite without a stage, and stays false there', async () => {
        await renderSlot('wall');
        await report('wall', true);
        expect(occludes()).toBe(true);

        await renderSlot('grid');
        expect(occludes()).toBe(false);
        // 旧 stage 卸载后晚到的报告不生效。
        await report('wall', true);
        expect(occludes()).toBe(false);
    });

    it('resets on switching to another stage suite and ignores the old stage from then on', async () => {
        await renderSlot('wall');
        await report('wall', true);
        const staleWall = reporters.wall;

        await renderSlot('other');
        expect(occludes()).toBe(false);

        await report('other', true);
        expect(occludes()).toBe(true);
        // 旧 stage 晚到的 false 不能顶掉新 stage 的 true。
        await act(async () => staleWall(false));
        expect(occludes()).toBe(true);
        await report('other', false);
        expect(occludes()).toBe(false);
    });

    it('is a fresh registration when the same suite stage mounts again', async () => {
        await renderSlot('wall');
        await report('wall', true);
        const firstReporter = reporters.wall;
        await act(async () => root.unmount());
        root = createRoot(container);
        expect(occludes()).toBe(false);

        await renderSlot('wall');
        expect(reporters.wall).not.toBe(firstReporter);
        expect(occludes()).toBe(false);
        // 上一次挂载的报告函数已经作废。
        await act(async () => firstReporter(true));
        expect(occludes()).toBe(false);
        await report('wall', true);
        expect(occludes()).toBe(true);
    });

    it('is always false for the grid (no stage) and for an unknown suite', async () => {
        await renderSlot('grid');
        expect(occludes()).toBe(false);
        expect(useLibraryPlayerOcclusionStore.getState().mountedOwner).toBeNull();
        await renderSlot('nope');
        expect(occludes()).toBe(false);
        expect(useLibraryPlayerOcclusionStore.getState().mountedOwner).toBeNull();
    });
});

describe('library player occlusion store', () => {
    const owner = (suiteId: string): LibraryPlayerOcclusionOwner => ({ suiteId });

    it('needs both a registration and a report from that same owner', () => {
        const a = owner('wall');
        const { mount, report, release } = useLibraryPlayerOcclusionStore.getState();
        report(a, true);
        expect(occludes()).toBe(false);
        mount(a);
        expect(occludes()).toBe(true);
        release(a);
        expect(occludes()).toBe(false);
    });

    it('does not let a stale owner release the current one', () => {
        const a = owner('wall');
        const b = owner('wall');
        const { mount, report, release } = useLibraryPlayerOcclusionStore.getState();
        mount(a);
        mount(b);
        report(b, true);
        release(a);
        expect(occludes()).toBe(true);
    });

    it('does not write the store when a report repeats the current value', () => {
        const a = owner('wall');
        const { mount, report } = useLibraryPlayerOcclusionStore.getState();
        mount(a);
        report(a, true);
        let writes = 0;
        const unsubscribe = useLibraryPlayerOcclusionStore.subscribe(() => { writes += 1; });
        report(a, true);
        report(a, true);
        unsubscribe();
        expect(writes).toBe(0);
    });
});

// 2026-10-09：同一个持有者还报告透出的画面（歌词 / 模糊）。生效规则与遮挡相同：只认当前挂着的 stage，卸载、换 suite 复位。
describe('library player backdrop channel', () => {
    const backdrop = () => selectLibraryPlayerBackdrop(useLibraryPlayerOcclusionStore.getState());

    it('follows what the mounted stage reports and resets when the slot unmounts or the suite changes', async () => {
        await renderSlot('wall');
        expect(backdrop()).toBe(NO_LIBRARY_PLAYER_BACKDROP);

        await act(async () => backdropReporters.wall({ lyrics: true, blur: false }));
        expect(backdrop()).toEqual({ lyrics: true, blur: false });
        const reported = backdrop();
        await act(async () => backdropReporters.wall({ lyrics: true, blur: false }));
        expect(backdrop()).toBe(reported);

        // 换成另一套带 stage 的 suite：旧报告不再生效，旧 stage 晚到的报告也不算。
        const stale = backdropReporters.wall;
        await renderSlot('other');
        expect(backdrop()).toBe(NO_LIBRARY_PLAYER_BACKDROP);
        await act(async () => stale({ lyrics: true, blur: true }));
        expect(backdrop()).toBe(NO_LIBRARY_PLAYER_BACKDROP);
        await act(async () => backdropReporters.other({ lyrics: false, blur: true }));
        expect(backdrop()).toEqual({ lyrics: false, blur: true });

        // 挂载位卸载（Home 返回 null）：复位。
        await act(async () => root.unmount());
        root = createRoot(container);
        expect(backdrop()).toBe(NO_LIBRARY_PLAYER_BACKDROP);
    });

    it('is always plain for a suite without a stage', async () => {
        await renderSlot('grid');
        expect(backdrop()).toBe(NO_LIBRARY_PLAYER_BACKDROP);
    });
});
