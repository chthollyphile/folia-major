// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/settings/libraryWallLookSettings.test.ts
// 主页与歌单页的「Bravais 墙面」分组（pages/BravaisWallGroup）与其中的透光设置（B6b②）：整组只在生效 suite 是 bravais
// 时渲染，设置搜索也只在那时列出它；透光三档单选，部分透明时才出现 1–6 档的每块窗数（行下写着占比）；集合叠页边是
// 一个开关（默认开）；点击都写进 useLibraryWallLookStore。谓词本身在 bravaisLibraryActive.test 里测，这里用替身控制它；
// 文案用 key 原样输出。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gate = vi.hoisted(() => ({ isBravaisActive: false }));

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => (
            options ? `${key}:${JSON.stringify(options)}` : key
        ),
    }),
}));

vi.mock('@/library/app/bravaisLibraryActive', () => ({
    isBravaisLibraryActive: () => gate.isBravaisActive,
    useIsBravaisLibraryActive: () => gate.isBravaisActive,
}));

let storage: Map<string, string>;
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const { useLibraryWallLookStore } = await import('@/stores/useLibraryWallLookStore');
    useLibraryWallLookStore.setState({ look: 'partial', windowsPerBlock: 3, collectionStackEdges: true });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    gate.isBravaisActive = false;
});

const render = async () => {
    const { BravaisWallGroup } = await import('@/components/modal/settings/pages/BravaisWallGroup');
    act(() => {
        root.render(createElement(BravaisWallGroup));
    });
};

const buttonsOf = (rowId: string) => [...container.querySelectorAll<HTMLButtonElement>(`[data-settings-row="${rowId}"] button[aria-pressed]`)];
const lookButtons = () => buttonsOf('libraryWallLook');
const windowButtons = () => buttonsOf('libraryWallWindows');
const pressed = (buttons: HTMLButtonElement[]) => buttons.map(button => button.getAttribute('aria-pressed'));

/** A closed Reveal leaves the document once its closing has run. */
const waitForUnfold = async () => {
    const { KIT_MOTION } = await import('@/components/modal/settings/kit/motion');
    await act(() => new Promise(resolve => window.setTimeout(resolve, KIT_MOTION.unfold * 1000 + 20)));
};

describe('BravaisWallGroup', () => {
    it('renders nothing unless bravais is the effective suite', async () => {
        gate.isBravaisActive = false;
        await render();

        expect(container.innerHTML).toBe('');
    });

    it('groups the transparency, the windows per block and the stack edges under one heading', async () => {
        gate.isBravaisActive = true;
        await render();

        expect(container.querySelector('h3')?.textContent).toContain('options.bravaisSettings');
        expect(container.querySelector('[data-settings-anchor="bravaisSettings"]')).not.toBeNull();
        expect(lookButtons()).toHaveLength(3);
        expect(windowButtons()).toHaveLength(6);
        expect(container.querySelector('[data-settings-row="bravaisStackEdges"] [role="switch"]')).not.toBeNull();
    });

    it('turns the collection stack edges off and on again', async () => {
        gate.isBravaisActive = true;
        await render();
        const { useLibraryWallLookStore } = await import('@/stores/useLibraryWallLookStore');
        const toggle = () => container.querySelector<HTMLButtonElement>('[data-settings-row="bravaisStackEdges"] [role="switch"]')!;

        expect(toggle().getAttribute('aria-checked')).toBe('true');
        act(() => toggle().click());
        expect(useLibraryWallLookStore.getState().collectionStackEdges).toBe(false);
        expect(storage.get('library_wall_stack_edges')).toBe('false');
        expect(toggle().getAttribute('aria-checked')).toBe('false');
        act(() => toggle().click());
        expect(useLibraryWallLookStore.getState().collectionStackEdges).toBe(true);
        expect(storage.get('library_wall_stack_edges')).toBe('true');
    });

    it('shows the three looks with the stored one chosen, and the window counts with their share under partial', async () => {
        gate.isBravaisActive = true;
        await render();

        expect(lookButtons().map(button => button.textContent)).toEqual([
            'options.libraryWallLookSolid',
            'options.libraryWallLookPartial',
            'options.libraryWallLookClear',
        ]);
        expect(pressed(lookButtons())).toEqual(['false', 'true', 'false']);

        expect(windowButtons().map(button => button.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(pressed(windowButtons())).toEqual(['false', 'false', 'true', 'false', 'false', 'false']);
        expect(container.querySelector('[data-settings-row="libraryWallWindows"]')?.textContent)
            .toContain('options.libraryWallWindowsOption:{"count":3,"percent":25}');
    });

    it('stores a picked window count and hides the counts outside partial', async () => {
        gate.isBravaisActive = true;
        await render();
        const { useLibraryWallLookStore } = await import('@/stores/useLibraryWallLookStore');

        act(() => windowButtons()[4].click());
        expect(useLibraryWallLookStore.getState().windowsPerBlock).toBe(5);
        expect(windowButtons()[4].getAttribute('aria-pressed')).toBe('true');

        act(() => lookButtons()[2].click());
        expect(useLibraryWallLookStore.getState().look).toBe('clear');
        await waitForUnfold();
        expect(windowButtons()).toEqual([]);

        act(() => lookButtons()[0].click());
        expect(useLibraryWallLookStore.getState().look).toBe('solid');
        expect(windowButtons()).toEqual([]);

        act(() => lookButtons()[1].click());
        expect(windowButtons().find(button => button.getAttribute('aria-pressed') === 'true')?.textContent).toBe('5');
    });

    // The group is drawn only under bravais, so the settings search may only offer it then.
    it('is found by the settings search only while bravais is the effective suite', async () => {
        const { BRAVAIS_WALL_OPTIONS } = await import('@/components/modal/settings/pages/BravaisWallGroup');
        const { buildSettingsNavGroups } = await import('@/components/modal/settings/navigation/settingsNavModel');
        const { buildSettingsSearchEntries } = await import('@/components/modal/settings/navigation/settingsNavSearch');
        const echo = (key: string) => key;
        const listsGroup = () => buildSettingsSearchEntries(
            buildSettingsNavGroups(echo, { isElectron: false }),
            { home: BRAVAIS_WALL_OPTIONS },
            echo,
            { isElectron: false },
        ).some(entry => entry.targetId === 'bravaisSettings');

        gate.isBravaisActive = false;
        expect(listsGroup()).toBe(false);
        gate.isBravaisActive = true;
        expect(listsGroup()).toBe(true);
        // The search module loads the whole command registry the first time.
    }, 30000);
});
