// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/mod-system/foliumSelectField.test.ts
// A `select` param renders through the host CustomSelect (#485): labels follow
// the UI language, picks reach onChange, disabled holds, a stored value outside
// the options shows the default (or first) option without being rewritten, and
// Escape closes only the menu — not the palette or settings dialog around it.
// Like a native select, the trigger's name carries the current value, and
// picking the option already stored is not reported as a change.

const i18nState = vi.hoisted(() => ({ language: 'en' }));

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: i18nState.language } }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FoliumSetting } from '@/mods/folium/contract';
import { FoliumParamFields, type FoliumParamFieldToken } from '@/mods/params/FoliumParamFields';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN: FoliumParamFieldToken = {
    label: 'field-label',
    readonlyLabel: 'field-readonly',
    input: 'w-full rounded-lg px-2.5 py-1.5 text-xs folium-input',
    inputStyle: { color: 'rgb(1, 2, 3)' },
    toggleOn: '',
    toggleOff: '',
    dotOn: '',
    dotOff: '',
};

const codec: FoliumSetting = {
    key: 'codec',
    type: 'select',
    label: { en: 'Codec', 'zh-CN': '编码' },
    defaultValue: 'hevc',
    options: [
        { value: 'h264', label: { en: 'H.264 (compatible)', 'zh-CN': 'H.264（兼容）' } },
        { value: 'hevc', label: { en: 'HEVC', 'zh-CN': 'HEVC' } },
        { value: 'prores', label: { ja: 'ProRes（日本語だけ）' } },
    ],
};

let root: Root | null = null;
const windowListeners: Array<(event: KeyboardEvent) => void> = [];

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    windowListeners.splice(0).forEach(listener => window.removeEventListener('keydown', listener));
    document.body.replaceChildren();
    i18nState.language = 'en';
});

const renderFields = (props: { params?: FoliumSetting[]; values?: Record<string, unknown>; disabled?: boolean } = {}) => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = () => act(() => root!.render(React.createElement(FoliumParamFields, {
        params: props.params ?? [codec],
        values: props.values ?? { codec: 'hevc' },
        disabled: props.disabled,
        token: TOKEN,
        isDaylight: false,
        onChange,
    })));
    render();
    const trigger = () => host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const optionLabels = () => options().map(option => option.textContent);
    return { host, trigger, options, optionLabels, onChange, render };
};

/** The name aria-labelledby gives an element: its referenced elements' text, space-joined (jsdom computes no names). */
const labelledName = (element: Element) => (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ');

const pressEnter = (target: Element) => act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
});

describe('Folium select field', () => {
    it('renders the host dropdown, named by the field label and its value, outside any <label>', () => {
        const { host, trigger } = renderFields();
        expect(host.querySelector('select')).toBeNull();
        // A select-only combobox: arrow keys reach screen readers through aria-activedescendant.
        expect(trigger().getAttribute('role')).toBe('combobox');
        // aria-label would replace the button text, so the value would go unannounced.
        expect(trigger().hasAttribute('aria-label')).toBe(false);
        expect(labelledName(trigger())).toBe('Codec HEVC');
        // The name comes from the visible label of the row, not from a copy of it.
        const [labelId] = trigger().getAttribute('aria-labelledby')!.split(/\s+/);
        expect(document.getElementById(labelId)?.className).toBe('field-label');
        expect(trigger().closest('label')).toBeNull();
        expect(trigger().className).toContain('folium-input');
        expect(trigger().style.color).toBe('rgb(1, 2, 3)');
    });

    it('labels options in the UI language and falls back to the value', () => {
        const { trigger, optionLabels, render } = renderFields();
        act(() => trigger().click());
        expect(optionLabels()).toEqual(['H.264 (compatible)', 'HEVC', 'prores']);
        act(() => trigger().click());

        i18nState.language = 'zh-CN';
        render();
        expect(labelledName(trigger())).toBe('编码 HEVC');
        act(() => trigger().click());
        expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('编码');
        expect(optionLabels()).toEqual(['H.264（兼容）', 'HEVC', 'prores']);
    });

    it('keeps the current value in the trigger name as the value changes', () => {
        const { trigger } = renderFields({ values: { codec: 'h264' } });
        expect(labelledName(trigger())).toBe('Codec H.264 (compatible)');
    });

    it('reports the picked value with its param', () => {
        const { trigger, onChange } = renderFields();
        act(() => trigger().click());
        const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))[0];
        act(() => option.click());
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'codec' }), 'h264');
    });

    it('does not report a pick of the option already stored, by pointer or by Enter', () => {
        const { trigger, options, onChange } = renderFields();
        act(() => trigger().click());
        act(() => options()[1].click());
        expect(trigger().getAttribute('aria-expanded')).toBe('false');

        // The highlight opens on the current option; Enter right away there only closes the menu.
        act(() => trigger().click());
        pressEnter(trigger());
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('still writes the shown fallback over a stale stored value when it is clicked', () => {
        const { trigger, options, onChange } = renderFields({ values: { codec: 'vp9' } });
        expect(trigger().textContent).toBe('HEVC');

        // Enter on the shown fallback is Enter on the current option: it only closes, as the
        // native select did (picking the option it showed fired no change there either).
        act(() => trigger().focus());
        pressEnter(trigger());
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        pressEnter(trigger());
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(onChange).not.toHaveBeenCalled();

        act(() => trigger().click());
        act(() => options()[1].click());
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ key: 'codec' }), 'hevc');
    });

    it('keeps the trigger disabled while the form is', () => {
        const { trigger, onChange } = renderFields({ disabled: true });
        expect(trigger().disabled).toBe(true);
        act(() => trigger().click());
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows the default, else the first option, for a stored value outside the options without rewriting it', () => {
        const stale = renderFields({ values: { codec: 'vp9' } });
        expect(stale.trigger().textContent).toBe('HEVC');
        expect(stale.onChange).not.toHaveBeenCalled();
        act(() => root!.unmount());
        root = null;
        document.body.replaceChildren();

        const unlistedDefault: FoliumSetting = { ...codec, defaultValue: 'vp9' };
        const fallback = renderFields({ params: [unlistedDefault], values: { codec: undefined } });
        expect(fallback.trigger().textContent).toBe('H.264 (compatible)');
        expect(fallback.onChange).not.toHaveBeenCalled();
    });

    it('closes only the menu on Escape', () => {
        const outer = vi.fn();
        const listener = (event: KeyboardEvent) => outer(event.key);
        window.addEventListener('keydown', listener);
        windowListeners.push(listener);

        const { trigger } = renderFields();
        act(() => trigger().click());
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        act(() => {
            trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(outer).not.toHaveBeenCalled();
    });
});
