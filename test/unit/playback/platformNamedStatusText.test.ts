import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import inLocale from '@/i18n/locales/in';
import vi from '@/i18n/locales/vi';
import zhCN from '@/i18n/locales/zh-CN';
import { platformNamedText } from '@/services/onlineMusic/failure/onlineFailureTexts';

// test/unit/playback/platformNamedStatusText.test.ts
// 队列说的那两句带平台名的话，四份词条都要真的把名字插进去：`t` 不带实参时 i18next 不报错，只是把
// {{platform}} 原样留在界面上，所以这里断言的是渲染后的文字，不是 key 名。

const LOCALES = { 'zh-CN': zhCN, en, in: inLocale, vi };

const PLATFORM = 'Spotify';

/** 四份词条里真正的那一次翻译，不经过任何替身。 */
const realTranslate = async (language: keyof typeof LOCALES) => {
    const instance = createInstance();
    await instance.init({
        lng: language,
        resources: { [language]: { translation: LOCALES[language] } },
        interpolation: { escapeValue: false },
    });
    return (key: string, values?: Record<string, string | number>): string => String(instance.t(key, values));
};

describe('the queue lines that name the platform', () => {
    const LINES = [
        ['status.externalPlayerUnreachable', 'status.externalPlayerUnreachableBare'],
        ['status.songSubscriptionRequiredSkipped', 'status.songSubscriptionRequiredSkippedBare'],
    ] as const;

    it.each(Object.keys(LOCALES) as (keyof typeof LOCALES)[])(
        'renders the platform name into %s and never shows the placeholder',
        async language => {
            const t = await realTranslate(language);
            for (const [key, bare] of LINES) {
                const said = platformNamedText(t, key, bare, PLATFORM);
                expect(said, `${language} ${key}`).not.toContain('{{');
                expect(said, `${language} ${key}`).toContain(PLATFORM);
            }
        },
    );

    // 取不到是哪一个平台时说的那一句：一样不能留占位符，也不能空着。
    it.each(Object.keys(LOCALES) as (keyof typeof LOCALES)[])(
        'says a line without the name in %s when no platform is known',
        async language => {
            const t = await realTranslate(language);
            for (const [key, bare] of LINES) {
                const said = platformNamedText(t, key, bare, null);
                expect(said, `${language} ${bare}`).not.toContain('{{');
                expect(said.trim(), `${language} ${bare}`).not.toBe('');
                // 兜底的那一句认不出是哪一次翻译：它就是词条本身，没有平台名可插。
                expect(said, `${language} ${bare}`).not.toBe(bare);
            }
        },
    );
});
