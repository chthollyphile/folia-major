// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import inLocale from '@/i18n/locales/in';
import viLocale from '@/i18n/locales/vi';
import zhCN from '@/i18n/locales/zh-CN';

// test/unit/settings/externalPlayerSettingsText.test.ts
// 设置页里与外部播放器有关的那几行文字，要和现在的行为对得上：未同意时不重启，开关开着时只在外部
// 播放器放 Folia 发起或已接管的歌时占用媒体键。这几行在共用的设置页上，所以不写死平台名；平台名
// 留在 Spotify 自己的那几段文案里。

const LOCALES = { 'zh-CN': zhCN, en, in: inLocale, vi: viLocale };

/** 共用设置页上那几行：键名是共用的，文案里不该出现具体的平台。 */
const SHARED_KEYS = [
    'wakeExternalPlayersOnLaunch',
    'wakeExternalPlayersOnLaunchDesc',
    'closeExternalPlayerOnQuit',
    'closeExternalPlayerOnQuitDesc',
    'holdMediaKeysForExternalPlayer',
    'holdMediaKeysForExternalPlayerDesc',
    'externalPlayerRestartConsent',
    'externalPlayerRestartConsentDesc',
    'externalSystemAudioSpectrum',
    'externalSystemAudioSpectrumDesc',
];

const PLATFORM_NAMES = /spotify|netease|qq|kugou|bodian|youtube|apple music|qishui|fnmusic/i;

/** 「始终 / 一直」这类说法：新的规则按歌算，不是整个运行期都占着。 */
const ALWAYS_WORDS = /始终|一直|always|selalu|luôn|toàn bộ thời gian/i;

describe('the shared settings rows of the external player', () => {
    it('names no platform in the shared settings page, in every language', () => {
        for (const [language, locale] of Object.entries(LOCALES)) {
            for (const key of SHARED_KEYS) {
                const text = (locale.options as Record<string, string>)[key];
                expect(text, `${language} options.${key}`).toBeTruthy();
                expect(text, `${language} options.${key} names a platform`).not.toMatch(PLATFORM_NAMES);
            }
        }
    });

    it('no longer says the app is restarted without asking first', () => {
        // 未同意时不会重启：这一行要说的是先同意，之后才关掉重开一次。
        const hint = zhCN.options.wakeExternalPlayersOnLaunchDesc;
        expect(hint).toContain('同意');
        expect(en.options.wakeExternalPlayersOnLaunchDesc).toMatch(/agree/i);
        expect(inLocale.options.wakeExternalPlayersOnLaunchDesc).toMatch(/setuju/i);
        expect(viLocale.options.wakeExternalPlayersOnLaunchDesc).toMatch(/đồng ý/i);
        for (const [language, locale] of Object.entries(LOCALES)) {
            expect(locale.options.wakeExternalPlayersOnLaunchDesc, language).not.toMatch(/会被重启一次/);
        }
    });

    it('describes the media keys as held for the songs Folia plays, not for the whole run', () => {
        for (const [language, locale] of Object.entries(LOCALES)) {
            expect(locale.options.holdMediaKeysForExternalPlayer, `${language} title`).not.toMatch(ALWAYS_WORDS);
            expect(locale.options.holdMediaKeysForExternalPlayerDesc, `${language} hint`).not.toMatch(ALWAYS_WORDS);
        }
    });

    // 这一行说的是「使用某种客户端时才…」：接管是按歌算的，和哪一种客户端无关，标题里不该点名。
    it('does not name a way of playing in the media keys title', () => {
        const NAMES_A_CLIENT = /official|官方|resmi|chính thức/i;
        for (const [language, locale] of Object.entries(LOCALES)) {
            expect(locale.options.holdMediaKeysForExternalPlayer, `${language} title`)
                .not.toMatch(NAMES_A_CLIENT);
        }
    });

    // 开关标题要是「做这件事」的动宾短语，不是一句陈述：读的人要知道打开它意味着允许什么。
    it('states the restart consent as what the switch allows, in every language', () => {
        for (const [language, locale] of Object.entries(LOCALES)) {
            expect(locale.options.externalPlayerRestartConsent, `${language} title`).toBeTruthy();
            expect(locale.options.externalPlayerRestartConsentDesc, `${language} hint`).toBeTruthy();
        }
        // 四份都说的是「允许 / 让 Folia 重启」，不是「Folia 已经可以重启」这种状态陈述。
        expect(zhCN.options.externalPlayerRestartConsent).toMatch(/^允许|^让/);
        expect(en.options.externalPlayerRestartConsent).toMatch(/^(Let|Allow)\b/);
        expect(inLocale.options.externalPlayerRestartConsent).toMatch(/^(Izinkan|Biarkan)\b/);
        expect(viLocale.options.externalPlayerRestartConsent).toMatch(/^(Cho phép|Để)\b/);
    });

    it('tells the Vietnamese reader that turning the switch off asks again next time', () => {
        expect(viLocale.options.externalPlayerRestartConsentDesc.trim().endsWith('Tắt mục này thì lần gặp sau sẽ hỏi lại.'))
            .toBe(true);
    });
});
