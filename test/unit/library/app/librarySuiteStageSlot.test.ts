// @vitest-environment jsdom
import React, { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibrarySuiteStageSlot from '@/library/app/LibrarySuiteStageSlot';
import type { ResolvedLibraryStage } from '@/library/registry';
import { buildLibrarySuiteIndex, LIBRARY_ACCOUNT_ACTION_IDS } from '@/library/core/suite/librarySuites';
import type { LibraryNavigationContext, LibrarySuiteManifest, LibrarySuiteStageProps } from '@/library/core/suite/suite.contract';
import type { Theme } from '@/types';

// test/unit/library/app/librarySuiteStageSlot.test.ts
// 集合宿主的 stage 挂载位（B1），用测试夹具里的假 suite（不进生产 registry）：
// - 选中带 stage 的 suite 才挂载，stage 是 lazy，选 grid / 未知 id 时连 chunk 都不加载；
// - 打开 / 关闭集合（navigation 变化）、isInteractive 变化都只换 props，不重挂；
// - 切走时卸载；换成另一套带 stage 的 suite 时重挂。

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

type StageLog = { mounts: number; unmounts: number };

/** 假的 stage：记下挂载 / 卸载次数，把收到的 props 写在 DOM 上。 */
const createFakeStage = (log: StageLog) => (props: LibrarySuiteStageProps) => {
    useEffect(() => {
        log.mounts += 1;
        return () => { log.unmounts += 1; };
    }, []);
    return createElement('div', {
        'data-fake-stage': '',
        'data-depth': props.navigation.depth,
        'data-interactive': String(props.isInteractive),
    });
};

const HOME: LibraryNavigationContext = { depth: 0, origin: null, activeType: null };
const IN_COLLECTION: LibraryNavigationContext = { depth: 1, origin: 'home', activeType: 'playlist' };
const THEME = {} as Theme;

let container: HTMLDivElement;
let root: Root;
let wallLog: StageLog;
let otherLog: StageLog;
type StageModule = { default: React.ComponentType<LibrarySuiteStageProps> };
let loadWall: ReturnType<typeof vi.fn<() => Promise<StageModule>>>;
let loadOther: ReturnType<typeof vi.fn<() => Promise<StageModule>>>;
let index: ReturnType<typeof buildLibrarySuiteIndex>;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    wallLog = { mounts: 0, unmounts: 0 };
    otherLog = { mounts: 0, unmounts: 0 };
    const WallStage = createFakeStage(wallLog);
    const OtherStage = createFakeStage(otherLog);
    loadWall = vi.fn(async (): Promise<StageModule> => ({ default: WallStage }));
    loadOther = vi.fn(async (): Promise<StageModule> => ({ default: OtherStage }));
    index = buildLibrarySuiteIndex([
        gridLike,
        {
            id: 'wall',
            labelKey: 'wall',
            surfaces: { collection: { component: surface('wall-collection'), actions: ['play'] } },
            stage: React.lazy(loadWall),
        },
        {
            id: 'other',
            labelKey: 'other',
            surfaces: { collection: { component: surface('other-collection'), actions: ['play'] } },
            stage: React.lazy(loadOther),
        },
    ]);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

/** 照宿主的做法：store 里的 suite id → resolveStage → 挂载位；等 lazy 解析完。 */
const renderSlot = async (suiteId: string, navigation: LibraryNavigationContext = HOME, isInteractive = true) => {
    await act(async () => {
        root.render(createElement(LibrarySuiteStageSlot, {
            stage: index.resolveStage(suiteId) as unknown as ResolvedLibraryStage | null,
            isInteractive,
            theme: THEME,
            isDaylight: false,
            navigation,
        }));
    });
    await act(async () => {});
};

const stageElement = () => container.querySelector<HTMLElement>('[data-fake-stage]');

describe('library suite stage slot (B1)', () => {
    it('renders nothing and loads no chunk for the grid or an unknown suite', async () => {
        await renderSlot('grid');
        await renderSlot('nope', IN_COLLECTION);
        expect(container.innerHTML).toBe('');
        expect(loadWall).not.toHaveBeenCalled();
        expect(loadOther).not.toHaveBeenCalled();
    });

    it('mounts the selected suite stage lazily and keeps the instance while layers open and close', async () => {
        await renderSlot('wall');
        expect(loadWall).toHaveBeenCalledTimes(1);
        expect(loadOther).not.toHaveBeenCalled();
        const element = stageElement();
        expect(element?.dataset.depth).toBe('0');
        expect(wallLog).toEqual({ mounts: 1, unmounts: 0 });

        // 打开集合（导航深度变化）、上面盖了一层（isInteractive=false）、再关上：同一个实例。
        await renderSlot('wall', IN_COLLECTION, false);
        expect(stageElement()).toBe(element);
        expect(element?.dataset.depth).toBe('1');
        expect(element?.dataset.interactive).toBe('false');
        await renderSlot('wall', HOME, true);
        expect(stageElement()).toBe(element);
        expect(wallLog).toEqual({ mounts: 1, unmounts: 0 });
        expect(loadWall).toHaveBeenCalledTimes(1);
    });

    it('unmounts when switching away and remounts for another stage suite', async () => {
        await renderSlot('wall', IN_COLLECTION);
        expect(wallLog).toEqual({ mounts: 1, unmounts: 0 });

        await renderSlot('grid', IN_COLLECTION);
        expect(stageElement()).toBeNull();
        expect(wallLog).toEqual({ mounts: 1, unmounts: 1 });

        await renderSlot('other', IN_COLLECTION);
        expect(loadOther).toHaveBeenCalledTimes(1);
        expect(otherLog).toEqual({ mounts: 1, unmounts: 0 });

        await renderSlot('wall', IN_COLLECTION);
        expect(otherLog).toEqual({ mounts: 1, unmounts: 1 });
        expect(wallLog).toEqual({ mounts: 2, unmounts: 1 });
        // lazy 只加载一次。
        expect(loadWall).toHaveBeenCalledTimes(1);
    });
});
