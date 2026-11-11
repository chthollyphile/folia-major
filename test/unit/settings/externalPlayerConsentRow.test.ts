// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationPage from '@/components/modal/settings/pages/IntegrationPage';
import { SettingsPageContext, type SettingsPageContextValue } from '@/components/modal/settings/pages/settingsPageContext';
import en from '@/i18n/locales/en';
import inLocale from '@/i18n/locales/in';
import viLocale from '@/i18n/locales/vi';
import zhCN from '@/i18n/locales/zh-CN';

// test/unit/settings/externalPlayerConsentRow.test.ts
// 「允许 Folia 重启外部播放器」这一行在主进程答不出状态时要说清是读不到：开关画成关、说明还写着
// 「关掉这一项会怎样」都等于把一个没读到过的回答说成没同意过。后者尤其误导——用的人会以为撤销过。
// 四份语言都要有这两句话，且共用设置页上不点名平台。

const KEY = 'options.externalPlayerRestartConsentUnread';

const LOCALES = { 'zh-CN': zhCN, en, in: inLocale, vi: viLocale };

// The page's own text is the keys here: what is pinned is which key the row asks for.
vi.mock('react-i18next', async importOriginal => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

let root: Root | null = null;
let host: HTMLDivElement;

/** The settings dialog's view props, with nothing that the consent row reads from them. */
const viewProps = {
    integration: {
        navidrome: {
            navidromeConfigured: false, navidromeEnabled: false, navidromePassword: '', navidromeServerProfile: null,
            navidromeTestStatus: 'idle', navidromeUrl: '', navidromeUsername: '', navidromeCanRestorePreset: false,
            navidromeRestoreFailed: false, navidromeRestoring: false, navidromeUsesPreset: false,
            onRestoreNavidromePreset: () => {}, onClearNavidrome: () => {}, onToggleNavidrome: () => {},
            setNavidromePassword: () => {}, setNavidromeUrl: () => {}, setNavidromeUsername: () => {},
            testNavidromeConnection: () => {},
        },
        discord: { enabled: false, onToggle: () => {} },
        lyricApi: { status: null },
        stage: { nowPlayingConnectionStatus: 'disconnected' },
    },
} as unknown as SettingsPageContextValue['viewProps'];

/** `answer` is what the main process says about the agreement; null is a channel that answers nothing. */
const render = async (answer: boolean | null) => {
    Object.defineProperty(window, 'electron', {
        value: {
            platform: 'win32',
            saveSettings: vi.fn(),
            externalPlayerRestartConsent: vi.fn(async () => (answer === null ? undefined : answer)),
        },
        configurable: true,
        writable: true,
    });
    const value = {
        isElectron: true,
        viewProps,
        onToggleTransparentPlayerBackground: () => {},
        themeControls: {},
    } as unknown as SettingsPageContextValue;
    if (!root) {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(React.createElement(SettingsPageContext.Provider, { value }, React.createElement(IntegrationPage)));
    });
};

/** The row of the restart consent, and the switch in it. */
const row = () => host.querySelector<HTMLElement>('[data-settings-row="externalPlayerRestartConsent"]')!;
const switchIn = () => row().querySelector<HTMLButtonElement>('[role="switch"]')!;

beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { window.localStorage.clear(); });
afterEach(async () => {
    await act(async () => { root?.unmount(); });
    host?.remove();
    root = null;
    vi.clearAllMocks();
    delete (window as any).electron;
});

describe('the restart consent row', () => {
    it('says the state could not be read, instead of describing a switch that is off', async () => {
        await render(null);
        const text = row().textContent ?? '';
        expect(text).toContain(KEY);
        expect(text).not.toContain('options.externalPlayerRestartConsentDesc');
        expect(switchIn().disabled).toBe(true);
    });

    it('describes the switch again once the answer is there', async () => {
        await render(true);
        const text = row().textContent ?? '';
        expect(text).toContain('options.externalPlayerRestartConsentDesc');
        expect(text).not.toContain(KEY);
        expect(switchIn().disabled).toBe(false);
        expect(switchIn().getAttribute('aria-checked')).toBe('true');
    });

    it('says what it means in every language, and names no platform', async () => {
        const PLATFORM_NAMES = /spotify|netease|qq|kugou|bodian|youtube|apple music|qishui|fnmusic/i;
        for (const [language, locale] of Object.entries(LOCALES)) {
            const text = (locale.options as Record<string, string>).externalPlayerRestartConsentUnread;
            expect(text, language).toBeTruthy();
            expect(text, language).not.toMatch(PLATFORM_NAMES);
        }
        expect(zhCN.options.externalPlayerRestartConsentUnread).toBe('读不到当前状态，暂时无法修改');
    });
});
