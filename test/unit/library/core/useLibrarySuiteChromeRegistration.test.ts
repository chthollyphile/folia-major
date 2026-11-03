// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibrarySuiteChromeRegistration } from '@/library/core/suite/useLibrarySuiteChromeRegistration';
import { useLibrarySuiteChromeStore } from '@/library/core/suite/useLibrarySuiteChromeStore';
import type { LibrarySuiteChromeHandle, LibrarySuiteChromeHandlers } from '@/library/core/suite/suiteChrome.contract';

// test/unit/library/core/useLibrarySuiteChromeRegistration.test.ts
// suite 外观动作的注册（B2）：随 isInteractive 注册 / 注销，组件卸载（换 suite）自动注销且不误伤接手的新实例，
// 句柄读最近一次渲染的 handlers（不因每次渲染重注册），没有实现或此刻不可用的动作不执行。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ProbeProps = { suiteId: string; isInteractive: boolean; handlers: LibrarySuiteChromeHandlers };

const Probe = (props: ProbeProps) => {
    useLibrarySuiteChromeRegistration(props);
    return null;
};

let root: Root;
let container: HTMLDivElement;

const render = (element: React.ReactElement) => act(() => { root.render(element); });
// 单测只收 .test.ts（不含 JSX），所以用 createElement。
const probe = (props: ProbeProps & { key?: string }) => React.createElement(Probe, props);
const chrome = (): LibrarySuiteChromeHandle | null => useLibrarySuiteChromeStore.getState().chrome;

beforeEach(() => {
    useLibrarySuiteChromeStore.setState({ chrome: null });
    container = document.createElement('div');
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
});

describe('library suite chrome registration', () => {
    it('registers only while interactive and unregisters when it stops being', () => {
        const handlers = { seam: { isAvailable: () => true, run: vi.fn() } };
        render(probe({ suiteId: 'wall', isInteractive: false, handlers }));
        expect(chrome()).toBeNull();

        render(probe({ suiteId: 'wall', isInteractive: true, handlers }));
        expect(chrome()?.suiteId).toBe('wall');

        render(probe({ suiteId: 'wall', isInteractive: false, handlers }));
        expect(chrome()).toBeNull();
    });

    it('unregisters on unmount, and a suite switch hands the slot to the incoming suite', () => {
        const handlers = { seam: { isAvailable: () => true, run: vi.fn() } };
        render(probe({ key: 'wall', suiteId: 'wall', isInteractive: true, handlers }));
        expect(chrome()?.suiteId).toBe('wall');

        // 换 suite：旧组件卸载、新组件挂载在同一次提交里，卸载的注销不能清掉新 suite 的注册。
        render(probe({ key: 'tiles', suiteId: 'tiles', isInteractive: true, handlers }));
        expect(chrome()?.suiteId).toBe('tiles');

        render(React.createElement(React.Fragment));
        expect(chrome()).toBeNull();
    });

    it('ignores a late teardown from an owner that has already been replaced', () => {
        const store = useLibrarySuiteChromeStore.getState();
        const outgoing: LibrarySuiteChromeHandle = { suiteId: 'wall', isAvailable: () => false, run: () => false };
        const incoming: LibrarySuiteChromeHandle = { suiteId: 'tiles', isAvailable: () => false, run: () => false };
        const releaseOutgoing = store.registerChrome(outgoing);
        store.registerChrome(incoming);
        releaseOutgoing();
        expect(chrome()).toBe(incoming);
    });

    it('reads the latest handlers without re-registering on every render', () => {
        const firstRun = vi.fn();
        const secondRun = vi.fn();
        render(probe({ suiteId: 'wall', isInteractive: true, handlers: { seam: { isAvailable: () => false, run: firstRun } } }));
        const handle = chrome();
        expect(handle?.isAvailable('seam')).toBe(false);

        render(probe({ suiteId: 'wall', isInteractive: true, handlers: { seam: { isAvailable: () => true, run: secondRun } } }));
        expect(chrome()).toBe(handle);
        expect(handle?.isAvailable('seam')).toBe(true);
        expect(handle?.run('seam')).toBe(true);
        expect(secondRun).toHaveBeenCalledTimes(1);
        expect(firstRun).not.toHaveBeenCalled();
    });

    it('re-registers under the new id when the suite id changes', () => {
        const handlers = { seam: { isAvailable: () => true, run: vi.fn() } };
        render(probe({ suiteId: 'wall', isInteractive: true, handlers }));
        const first = chrome();
        render(probe({ suiteId: 'tiles', isInteractive: true, handlers }));
        expect(chrome()).not.toBe(first);
        expect(chrome()?.suiteId).toBe('tiles');
    });

    it('runs nothing that has no handler or is unavailable right now', () => {
        const run = vi.fn();
        render(probe({ suiteId: 'wall', isInteractive: true, handlers: { seam: { isAvailable: () => false, run } } }));
        const handle = chrome()!;
        expect(handle.run('seam')).toBe(false);
        expect(run).not.toHaveBeenCalled();

        expect(handle.isAvailable('missing')).toBe(false);
        expect(handle.run('missing')).toBe(false);
        // 原型上的键不是动作。
        expect(handle.isAvailable('constructor')).toBe(false);
        expect(handle.run('toString')).toBe(false);
    });
});
