// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { closeFoliumHomeTab, homeTabsRegistry, selectFoliumHomeTab, useFoliumHomeTabStore } from '@/mods/folium/registries/homeTabs';
import { createFoliumClientApi, listFoliumHostRegistries } from '@/mods/folium/api';
import { clientApiOptions } from './clientApiOptions';
import { createFoliumUiService, registerFoliumHostActions, type FoliumHostActions } from '@/mods/folium/services';
import type { ModRuntimeInfo } from '@/mods/types';
import { selectNativeHomeTabFromPage, useFoliumHomeNavigation } from '@/components/app/home/useFoliumHomeNavigation';
import {
    claimHomePageFocus,
    deepActiveElement,
    focusHomePageEdge,
    homePageFocusTargets,
    resolveHomePageGuardEdge,
} from '@/components/app/home/foliumHomePageFocus';
import { installFoliumHomePageDismissal, selectNativeHomeTabWithoutSurface } from '@/components/app/home/foliumHomePageDismissal';
import { createHomeTabCommand } from '@/components/command-palette/commandFactories';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import { useLibraryHomeSurfaceStore } from '@/library/core/home/useLibraryHomeSurfaceStore';
import { useLibraryHomeTabsRegistration } from '@/library/core/home/useLibraryHomeSurfaceRegistration';
import type { GridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';

// test/unit/mod-system/foliumHomeTabs.test.ts
// Registration ownership, selection cleanup, and the client/export service boundary.
// 另外：Home 外壳那一侧的导航 hook（选中态、只在页面开着时监听原生页签）、页面页头选原生页签走句柄，
// 与页面的焦点工具（首尾守卫往哪头送、ShadowRoot 与 slot 投影穿透、focus() 没生效时往下一个试）。
// 再有：首页之外关掉页面的两条规则（显式打开集合、首页 surface 不在时命令面板选原生页签）、打开时不从别的窗口里抢焦点、
// 页签句柄带上 suite 的 F6 循环。

vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => { items.set(key, String(value)); },
        removeItem: (key: string) => { items.delete(key); }, clear: () => items.clear(),
    } });
});

// 一个能切语言的假 i18n 实例：Home 外壳的导航 hook 经 getI18n 订阅 languageChanged。
const fakeI18n = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    return {
        language: 'en',
        on: (_event: string, listener: () => void) => { listeners.add(listener); },
        off: (_event: string, listener: () => void) => { listeners.delete(listener); },
        changeLanguage(language: string) { this.language = language; listeners.forEach(listener => listener()); },
    };
});

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: fakeI18n }),
    getI18n: () => fakeI18n,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mod = { id: 'home-test', permissions: [], experimental: [] } as unknown as ModRuntimeInfo;
const definition = { id: 'messages', label: { en: 'Messages' }, mount: () => () => {} };

afterEach(() => {
    listFoliumHostRegistries().forEach(registry => { registry.unregisterAll('home-test'); registry.unregisterAll('other'); });
    registerFoliumHostActions(null);
});

describe('owned home tabs', () => {
    it('validates presentation and snapshots labels rather than keeping mutable definitions', () => {
        expect(() => homeTabsRegistry.register('home-test', { ...definition, mount: null as never })).toThrow('mount');
        expect(() => homeTabsRegistry.register('home-test', { ...definition, label: 'text' as never })).toThrow('label');
        expect(() => homeTabsRegistry.register('home-test', { ...definition, order: NaN })).toThrow('finite');
        const def = { ...definition, label: { en: 'Messages' } };
        const handle = homeTabsRegistry.register('home-test', def);
        def.label.en = 'Mutated';
        expect(homeTabsRegistry.get(handle.id)?.def.label.en).toBe('Messages');
    });

    it('only selects registered pages and falls back when their owner is removed', () => {
        homeTabsRegistry.register('home-test', definition);
        homeTabsRegistry.register('other', definition);
        expect(selectFoliumHomeTab('missing:messages')).toBe(false);
        expect(selectFoliumHomeTab('home-test:messages')).toBe(true);
        homeTabsRegistry.unregisterAll('other');
        expect(useFoliumHomeTabStore.getState().activeId).toBe('home-test:messages');
        homeTabsRegistry.unregisterAll('home-test');
        expect(useFoliumHomeTabStore.getState().activeId).toBeNull();
    });

    it('a stale handle cannot remove or deselect a re-enabled page', () => {
        const previous = homeTabsRegistry.register('home-test', definition);
        homeTabsRegistry.unregisterAll('home-test');
        homeTabsRegistry.register('home-test', definition);
        selectFoliumHomeTab('home-test:messages');
        previous.unregister();
        expect(homeTabsRegistry.list()).toHaveLength(1);
        expect(useFoliumHomeTabStore.getState().activeId).toBe('home-test:messages');
    });

    it('exposes the registry in the main API and makes it inert in an export context', () => {
        const exported = createFoliumClientApi(mod, clientApiOptions('export'));
        exported.registries.homeTabs.register(definition);
        expect(homeTabsRegistry.list()).toHaveLength(0);
        const client = createFoliumClientApi(mod, clientApiOptions('main'));
        expect(client.registries.homeTabs.register(definition).id).toBe('home-test:messages');
    });

    it('openHomeTab names only its owner, validates before navigation, and selects after navigation', () => {
        const navigate = vi.fn(() => useFoliumHomeTabStore.setState({ activeId: null }));
        registerFoliumHostActions({ navigate } as unknown as FoliumHostActions);
        const ui = createFoliumUiService(mod, 'main');
        homeTabsRegistry.register('other', definition);
        expect(() => ui.openHomeTab('messages')).toThrow('not-registered');
        expect(navigate).not.toHaveBeenCalled();
        homeTabsRegistry.register('home-test', definition);
        ui.openHomeTab('messages');
        expect(navigate).toHaveBeenCalledWith('home');
        expect(useFoliumHomeTabStore.getState().activeId).toBe('home-test:messages');
        expect(() => createFoliumUiService(mod, 'export').openHomeTab('messages')).toThrow('unavailable');
    });
});

describe('Home shell navigation', () => {
    let root: Root | null = null;

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
        useFoliumHomeTabStore.setState({ activeId: null });
        fakeI18n.language = 'en';
        vi.restoreAllMocks();
    });

    /** 挂一个只调用 useFoliumHomeNavigation 的组件，记下最近一次的结果与渲染次数。 */
    const renderNavigation = () => {
        const seen: { current: ReturnType<typeof useFoliumHomeNavigation> | null; renders: number } = { current: null, renders: 0 };
        const Probe = () => {
            seen.current = useFoliumHomeNavigation();
            seen.renders += 1;
            return null;
        };
        root = createRoot(document.createElement('div'));
        act(() => root!.render(React.createElement(Probe)));
        return seen;
    };

    it('orders pages and reports which one is open as the host-computed selection', () => {
        homeTabsRegistry.register('home-test', { ...definition, id: 'later', label: { en: 'Later' } });
        homeTabsRegistry.register('home-test', { ...definition, order: 10 });
        const seen = renderNavigation();
        expect(seen.current!.extraTabs.map(tab => [tab.id, tab.label, tab.active])).toEqual([
            ['home-test:messages', 'Messages', false],
            ['home-test:later', 'Later', false],
        ]);
        expect(seen.current!.activeEntry).toBeNull();
        act(() => { seen.current!.extraTabs[1].select(); });
        expect(seen.current!.activeEntry?.id).toBe('home-test:later');
        expect(seen.current!.extraTabs.map(tab => tab.active)).toEqual([false, true]);
    });

    it('follows the interface language only while there are pages to label', () => {
        const seen = renderNavigation();
        const renders = seen.renders;
        act(() => fakeI18n.changeLanguage('zh-CN'));
        expect(seen.renders).toBe(renders);
        act(() => { homeTabsRegistry.register('home-test', { ...definition, label: { en: 'Messages', 'zh-CN': '私信' } }); });
        expect(seen.current!.extraTabs.map(tab => tab.label)).toEqual(['私信']);
        act(() => fakeI18n.changeLanguage('en'));
        expect(seen.current!.extraTabs.map(tab => tab.label)).toEqual(['Messages']);
    });

    it('does not re-render on native tab changes and only listens for them while a page is open', () => {
        homeTabsRegistry.register('home-test', definition);
        const subscribe = vi.spyOn(useSearchNavigationStore, 'subscribe');
        const seen = renderNavigation();
        const renders = seen.renders;
        act(() => { useSearchNavigationStore.getState().setHomeViewTab('albums'); });
        act(() => { useSearchNavigationStore.getState().setHomeViewTab('local'); });
        expect(seen.renders).toBe(renders);
        expect(subscribe).not.toHaveBeenCalled();

        act(() => { selectFoliumHomeTab('home-test:messages'); });
        expect(subscribe).toHaveBeenCalledTimes(1);
        // 重选同一个原生页签不改 homeViewTab，页面不关（宿主的页签句柄另外负责）；换页签才关。
        act(() => { useSearchNavigationStore.getState().setHomeViewTab('local'); });
        expect(useFoliumHomeTabStore.getState().activeId).toBe('home-test:messages');
        act(() => { useSearchNavigationStore.getState().setHomeViewTab('playlist'); });
        expect(useFoliumHomeTabStore.getState().activeId).toBeNull();
        expect(seen.current!.activeEntry).toBeNull();
        // 关掉之后监听也拆了：再写 homeViewTab 不会碰页面状态，重新打开才重新挂。
        act(() => { useSearchNavigationStore.getState().setHomeViewTab('albums'); });
        expect(subscribe).toHaveBeenCalledTimes(1);
        act(() => { selectFoliumHomeTab('home-test:messages'); });
        expect(subscribe).toHaveBeenCalledTimes(2);
    });
});

describe('native tabs from the page header', () => {
    afterEach(() => {
        useLibraryHomeSurfaceStore.setState({ tabs: null });
        closeFoliumHomeTab();
    });

    const openPage = () => {
        homeTabsRegistry.register('home-test', definition);
        selectFoliumHomeTab('home-test:messages');
    };

    it('goes through the suite tab handle so suite side effects run, then closes the page', () => {
        openPage();
        const setTab = vi.fn(() => true);
        const write = vi.fn();
        useLibraryHomeSurfaceStore.getState().registerTabs({ getState: () => ({ active: 'playlist', tabs: [] }), setTab });
        expect(selectNativeHomeTabFromPage('albums', write)).toBe(true);
        expect(setTab).toHaveBeenCalledWith('albums');
        expect(write).not.toHaveBeenCalled();
        expect(useFoliumHomeTabStore.getState().activeId).toBeNull();
    });

    it('keeps the page open when the handle refuses the tab', () => {
        openPage();
        const write = vi.fn();
        useLibraryHomeSurfaceStore.getState().registerTabs({ getState: () => ({ active: 'playlist', tabs: [] }), setTab: () => false });
        expect(selectNativeHomeTabFromPage('navidrome', write)).toBe(false);
        expect(write).not.toHaveBeenCalled();
        expect(useFoliumHomeTabStore.getState().activeId).toBe('home-test:messages');
    });

    it('writes the native tab directly only when no home surface registered a handle', () => {
        openPage();
        const write = vi.fn();
        expect(selectNativeHomeTabFromPage('local', write)).toBe(true);
        expect(write).toHaveBeenCalledWith('local');
        expect(useFoliumHomeTabStore.getState().activeId).toBeNull();
    });
});

describe('dismissing an open page from outside Home', () => {
    let uninstall: (() => void) | null = null;

    afterEach(() => {
        uninstall?.();
        uninstall = null;
        useCollectionNavigationStore.setState({ snapshot: null });
        useLibraryHomeSurfaceStore.setState({ tabs: null });
        closeFoliumHomeTab();
    });

    const album = (id: string) => ({
        source: 'online', providerId: 'netease', id, name: `Album ${id}`, type: 'album',
    } as unknown as GridViewCollectionDescriptor);
    const openPage = () => {
        if (!homeTabsRegistry.get('home-test:messages')) homeTabsRegistry.register('home-test', definition);
        expect(selectFoliumHomeTab('home-test:messages')).toBe(true);
    };
    const pageOpen = () => useFoliumHomeTabStore.getState().activeId !== null;

    it('closes the page when a collection is explicitly opened or pushed, not when history restores one', () => {
        uninstall = installFoliumHomePageDismissal();
        const navigation = useCollectionNavigationStore.getState();
        // 页面打开在已有集合之上：快照不变，页面照旧在最上面。
        navigation.openRoot(album('a'), 'home');
        openPage();
        expect(pageOpen()).toBe(true);
        // 浏览器前进后退恢复的集合不算显式打开。
        navigation.restore(null);
        navigation.restore({ origin: 'home', stack: [album('a'), album('b')] });
        expect(pageOpen()).toBe(true);
        // 已经在看的那一层（noop）、紧邻往返（back，交给应用内返回）都没有压新的一层。
        expect(navigation.push(album('b')).kind).toBe('noop');
        expect(navigation.push(album('a')).kind).toBe('back');
        expect(pageOpen()).toBe(true);
        // 播放页面板、搜索结果里点专辑或歌手：navigateToCollection 打开一个根集合。
        navigation.openRoot(album('c'), 'player');
        expect(pageOpen()).toBe(false);
        openPage();
        expect(navigation.push(album('d')).kind).toBe('push');
        expect(pageOpen()).toBe(false);
        // 卸下之后不再管。
        uninstall();
        uninstall = null;
        openPage();
        navigation.openRoot(album('e'), 'search');
        expect(pageOpen()).toBe(true);
    });

    it('the palette closes the page itself when no home surface handle takes the native tab, including a reselect', () => {
        const navigateToHome = vi.fn();
        type Tab = 'playlist' | 'albums' | 'local';
        const run = (tab: Tab, selectHomeViewTab: (tab: Tab) => void) => {
            createHomeTabCommand(tab, '', '', []).execute('', {
                navigation: { selectHomeViewTab, navigateToHome },
            } as unknown as CommandPaletteContext);
        };
        useSearchNavigationStore.getState().setHomeViewTab('playlist');
        openPage();
        // 播放页下首页藏起、句柄已注销：重选当前页签时 homeViewTab 不变，Home 外壳的监听收不到。
        run('playlist', selectNativeHomeTabWithoutSurface);
        expect(pageOpen()).toBe(false);
        expect(useSearchNavigationStore.getState().homeViewTab).toBe('playlist');
        expect(navigateToHome).toHaveBeenCalledTimes(1);
        // Lattice 下 Home 整个卸载，外壳的监听也不在：换页签同样要在这里关。
        openPage();
        run('albums', selectNativeHomeTabWithoutSurface);
        expect(pageOpen()).toBe(false);
        expect(useSearchNavigationStore.getState().homeViewTab).toBe('albums');
        // 句柄在时交给句柄（挂着的 surface 自己关页面），不走宿主这一支。
        const setTab = vi.fn(() => true);
        const select = vi.fn();
        useLibraryHomeSurfaceStore.getState().registerTabs({ getState: () => ({ active: 'albums', tabs: [] }), setTab });
        run('local', select);
        expect(setTab).toHaveBeenCalledWith('local');
        expect(select).not.toHaveBeenCalled();
    });
});

describe('the home tabs handle carries the suite F6 cycle', () => {
    let root: Root | null = null;

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
    });

    const register = (cycleTab?: (delta: 1 | -1) => boolean) => {
        const Probe = () => {
            useLibraryHomeTabsRegistration({ getState: () => ({ active: 'playlist', tabs: [] }), setTab: () => true, cycleTab });
            return null;
        };
        root ??= createRoot(document.createElement('div'));
        act(() => root!.render(React.createElement(Probe)));
    };

    it('exposes cycleTab only for suites that have one and always calls the latest callback', () => {
        register();
        expect(useLibraryHomeSurfaceStore.getState().tabs).not.toBeNull();
        expect(useLibraryHomeSurfaceStore.getState().tabs?.cycleTab).toBeUndefined();
        const first = vi.fn(() => true);
        register(first);
        expect(useLibraryHomeSurfaceStore.getState().tabs?.cycleTab?.(1)).toBe(true);
        expect(first).toHaveBeenCalledWith(1);
        const second = vi.fn(() => false);
        register(second);
        expect(useLibraryHomeSurfaceStore.getState().tabs?.cycleTab?.(-1)).toBe(false);
        expect(second).toHaveBeenCalledWith(-1);
        expect(first).toHaveBeenCalledTimes(1);
        act(() => root?.unmount());
        root = null;
        expect(useLibraryHomeSurfaceStore.getState().tabs).toBeNull();
    });
});

describe('home page focus', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    /** jsdom 没有布局：有 data-no-box 的元素当作没有布局盒子，其余都有。 */
    const mockLayout = () => vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
        return (this.hasAttribute('data-no-box') ? [] : [{}]) as unknown as DOMRectList;
    });

    /** 一个带首尾守卫的页面；x-toolbar 是带 slot 的 open ShadowRoot 组件，Send 是投影进去的 light DOM 子元素。 */
    const buildPage = () => {
        const section = document.createElement('section');
        section.innerHTML = '<span id="start" tabindex="0" data-folium-focus-guard="start"></span>'
            + '<header><button id="back">Back</button></header><div id="host"></div>'
            + '<span id="end" tabindex="0" data-folium-focus-guard="end"></span>';
        const shadow = section.querySelector('#host')!.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<textarea id="draft"></textarea><x-toolbar><button id="send">Send</button></x-toolbar>'
            + '<a id="fake-button">Not a link</a>';
        const toolbar = shadow.querySelector('x-toolbar')!.attachShadow({ mode: 'open' });
        toolbar.innerHTML = '<button id="menu">Menu</button><slot></slot>';
        document.body.append(section);
        const byId = (id: string) => [section, shadow, toolbar].map(root => root.querySelector('#' + id)).find(Boolean) as HTMLElement;
        return { section, byId };
    };

    it('sends focus leaving the page to the other end and focus arriving from outside to the nearest end', () => {
        const page = document.createElement('section');
        const inside = page.appendChild(document.createElement('button'));
        const outside = document.createElement('button');
        // Shift+Tab 越过返回按钮 / Tab 越过最后一个控件：绕回另一头。
        expect(resolveHomePageGuardEdge('start', inside, page)).toBe('last');
        expect(resolveHomePageGuardEdge('end', inside, page)).toBe('first');
        // 从页面外面 Tab / Shift+Tab 进来：落在离它最近的那一头。
        expect(resolveHomePageGuardEdge('start', outside, page)).toBe('first');
        expect(resolveHomePageGuardEdge('end', outside, page)).toBe('last');
        // 来源不明：首守卫当作从外面进来；尾守卫当作从页面里（模组的 iframe）Tab 出来。
        expect(resolveHomePageGuardEdge('start', null, page)).toBe('first');
        expect(resolveHomePageGuardEdge('end', null, page)).toBe('first');
    });

    it('lists focus targets through open ShadowRoots and slots, skipping guards and elements the browser cannot focus', () => {
        mockLayout();
        const section = document.createElement('section');
        section.innerHTML = '<span tabindex="0" data-folium-focus-guard="start"></span>'
            + '<header><button id="back">Back</button><button id="off" disabled>Off</button>'
            + '<div inert><button id="inert">Inert</button></div><div hidden><button id="hidden">Hidden</button></div>'
            + '<span id="plain">Text</span><span id="skipped" tabindex="-1">Skipped</span></header>'
            + '<div id="host"></div><button id="after">After</button>';
        const shadow = section.querySelector('#host')!.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<div><textarea id="draft"></textarea><button id="action">Action</button>'
            + '<div id="invisible" tabindex="0" style="visibility: hidden"></div><a id="unboxed" href="#x" data-no-box="1">Link</a>'
            + '<a id="no-href">Fake button</a><map><area id="no-href-area"></map>'
            + '<x-toolbar><button id="send">Send</button><button id="unslotted" slot="nowhere">Unslotted</button></x-toolbar>'
            + '<svg><a id="svg-link" href="#chart"><text>Node</text></a></svg></div>';
        shadow.querySelector('x-toolbar')!.attachShadow({ mode: 'open' }).innerHTML = '<button id="menu">Menu</button><slot></slot>'
            + '<slot name="empty"><button id="fallback">Fallback</button></slot>';
        document.body.append(section);
        expect(homePageFocusTargets(section).map(element => element.id))
            .toEqual(['back', 'draft', 'action', 'menu', 'send', 'fallback', 'svg-link', 'after']);
    });

    it('wrapping backwards reaches a slotted control and skips targets whose focus() does not take', () => {
        mockLayout();
        const { section, byId } = buildPage();
        const start = byId('start');
        start.focus();
        // 从返回按钮 Shift+Tab 落到首守卫：送到最后一个，也就是投影进 x-toolbar 的 Send（没有 href 的 a 不算）。
        expect(focusHomePageEdge(section, resolveHomePageGuardEdge('start', byId('back'), section), start)).toBe(byId('send'));
        expect(deepActiveElement()).toBe(byId('send'));
        // Send 的 focus() 不生效时往前一个试（Menu），焦点不会停在守卫上。
        start.focus();
        byId('send').focus = () => {};
        expect(focusHomePageEdge(section, 'last', start)).toBe(byId('menu'));
        expect(deepActiveElement()).toBe(byId('menu'));
        // Tab 越过最后一个落到尾守卫：回到页头的返回按钮。
        const end = byId('end');
        end.focus();
        expect(focusHomePageEdge(section, resolveHomePageGuardEdge('end', byId('host'), section), end)).toBe(byId('back'));
        expect(document.activeElement).toBe(byId('back'));
    });

    /** 原生首页那一层（打开页面的入口、被页面盖住的对话框）、页面（页头当前页签与一个输入框），再加一个页面之外的窗口。 */
    const buildOpening = () => {
        const nativeLayer = document.createElement('div');
        nativeLayer.innerHTML = '<button id="opener">Open</button>'
            + '<div data-folia-keyboard-window="true"><button id="covered">Covered dialog</button></div>';
        const page = document.createElement('section');
        page.setAttribute('data-folia-keyboard-window', 'true');
        page.innerHTML = '<button id="tab">Page tab</button><textarea id="draft"></textarea>';
        const modal = document.createElement('div');
        modal.setAttribute('data-folia-keyboard-window', 'true');
        modal.innerHTML = '<button id="run">Run</button>';
        document.body.append(nativeLayer, page);
        const byId = (id: string) => document.getElementById(id)!;
        return { nativeLayer, page, modal, byId, tab: () => byId('tab') };
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    it('takes focus lost with the native home, ignoring windows the page covers', () => {
        const { nativeLayer, page, byId, tab } = buildOpening();
        byId('opener').focus();
        nativeLayer.setAttribute('inert', '');
        claimHomePageFocus(page, tab);
        expect(document.activeElement).toBe(tab());
        // 在几个模组页之间切换：焦点在页面里，交给新的当前页签。
        byId('draft').focus();
        claimHomePageFocus(page, tab);
        expect(document.activeElement).toBe(tab());
    });

    it('does not take focus from another keyboard window and takes it once that window is gone', async () => {
        const { nativeLayer, page, modal, byId, tab } = buildOpening();
        nativeLayer.setAttribute('inert', '');
        document.body.append(modal);
        byId('run').focus();
        claimHomePageFocus(page, tab);
        expect(document.activeElement).toBe(byId('run'));
        // 设置弹窗的 Esc 监听在 window 上：焦点留在弹窗里，按键照常冒泡到它。
        const escapes = vi.fn();
        window.addEventListener('keydown', escapes);
        byId('run').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        window.removeEventListener('keydown', escapes);
        expect(escapes).toHaveBeenCalledTimes(1);
        // 窗口关掉（命令面板淡出）、焦点空出来之后再交。
        modal.remove();
        await settle();
        expect(document.activeElement).toBe(tab());
    });

    it('waits while a window is open even with focus on body, and gives up once focus is put elsewhere', async () => {
        const { nativeLayer, page, modal, byId, tab } = buildOpening();
        nativeLayer.setAttribute('inert', '');
        document.body.append(modal);
        (document.activeElement as HTMLElement | null)?.blur();
        const stop = claimHomePageFocus(page, tab);
        expect(document.activeElement).toBe(document.body);
        // 撤掉 data-folia-keyboard-window 也算窗口不在了。
        modal.removeAttribute('data-folia-keyboard-window');
        await settle();
        expect(document.activeElement).toBe(tab());
        stop();

        // 再来一次：等待中用户自己把焦点放进了页面，窗口关掉后不再挪它。
        modal.setAttribute('data-folia-keyboard-window', 'true');
        byId('run').focus();
        claimHomePageFocus(page, tab);
        byId('draft').focus();
        modal.remove();
        await settle();
        expect(document.activeElement).toBe(byId('draft'));
    });

    it('leaves focus held by a live element outside the page and does not wait for it', async () => {
        const { nativeLayer, page, tab } = buildOpening();
        nativeLayer.setAttribute('inert', '');
        const search = document.body.appendChild(document.createElement('input'));
        search.focus();
        claimHomePageFocus(page, tab);
        expect(document.activeElement).toBe(search);
        search.remove();
        await settle();
        expect(document.activeElement).not.toBe(tab());
    });

    it('reads the focused element inside a ShadowRoot', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        shadow.append(button);
        button.focus();
        expect(document.activeElement).toBe(host);
        expect(deepActiveElement()).toBe(button);
    });
});
