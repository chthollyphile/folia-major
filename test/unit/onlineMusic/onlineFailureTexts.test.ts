import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import id from '@/i18n/locales/in';
import zh from '@/i18n/locales/zh-CN';
import { omni } from '@/services/onlineMusic/omni';
import { ONLINE_FAILURE_CASE_IDS, mediaFailureOf, onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
import { onlineFailureMessage } from '@/services/onlineMusic/failure/onlineFailureTexts';
import type { OnlineFailureDetail, OnlineFailureOperation, OnlineProviderId } from '@/types/onlineMusic';

// test/unit/onlineMusic/onlineFailureTexts.test.ts
// What the listener reads for each case: a title in the three languages, the line saying what to do,
// and the platform's own words quoted under it.

const textOf = (texts: unknown, key: string): string | undefined => {
    const found = key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], texts);
    return typeof found === 'string' ? found : undefined;
};
const zhT = (key: string, values?: Record<string, string | number>) => (
    (textOf(zh, key) ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => (values?.[name] === undefined ? `{{${name}}}` : String(values[name])))
);
const keys = (key: string) => key;
// `null`: a song that names no platform.
const failure = (detail: OnlineFailureDetail, operation: OnlineFailureOperation = 'audio', providerId: OnlineProviderId | null = 'netease') => (
    onlineFailureOf({ operation, providerId: providerId ?? undefined }, { detail })
);

describe('the texts of the cases', () => {
    it('has a title and a note in the three languages for every case, on both kinds of request and a media failure', () => {
        const used = [
            ...ONLINE_FAILURE_CASE_IDS.flatMap(caseId => (['audio', 'collection'] as const).flatMap(operation => {
                const { title, note } = onlineFailureMessage(failure({ case: caseId }, operation), keys);
                const { title: bare } = onlineFailureMessage(failure({ case: caseId }, operation, null), keys);
                return [title, bare, ...(note ? [note] : [])];
            })),
            onlineFailureMessage(mediaFailureOf({ code: 3 }, 'netease'), keys).title,
            'failure.skipCountdown', 'failure.signIn',
        ];
        const missing = [...new Set(used)].flatMap(key => [['zh-CN', zh], ['en', en], ['in', id]].filter(([, texts]) => !textOf(texts, key)).map(([name]) => `${key} in ${name}`));
        expect(missing).toEqual([]);
    });

    it('fills in the platform\'s name, and says 已下架 for no case', () => {
        const label = omni.getProviderLabel('netease');
        expect(onlineFailureMessage(failure({ case: 'unreachable' }), zhT)).toEqual({ title: `无法连接${label}`, note: '请检查网络' });
        expect(onlineFailureMessage(failure({ case: 'local-service-stopped' }), zhT).note).toBe('请重启 Folia');
        // 「要求稍后再试」的标题自己说了该做什么；不知道平台时标题只剩「播放失败」，要补上这一句。
        expect(onlineFailureMessage(failure({ case: 'retry-later' }), zhT).note).toBeUndefined();
        expect(onlineFailureMessage(failure({ case: 'retry-later' }, 'audio', null), zhT)).toEqual({ title: '播放失败', note: '请稍后重试' });
        // Only the platform's own record says a song is taken down (getAvailability).
        for (const caseId of ONLINE_FAILURE_CASE_IDS.filter(id => id !== 'taken-down')) {
            expect(onlineFailureMessage(failure({ case: caseId }), zhT).title, caseId).not.toMatch(/已下架|\{\{/);
        }
        expect(onlineFailureMessage(failure({ case: 'taken-down' }), zhT).title).toBe('歌曲已下架');
    });

    it('says the sign-in has ended without a platform\'s name when the song names none', () => {
        expect(onlineFailureMessage(failure({ case: 'sign-in-needed' }), keys).title).toBe('failure.signInNeeded');
        expect(onlineFailureMessage(failure({ case: 'sign-in-needed' }, 'audio', null), keys).title).toBe('status.loginExpired');
        expect(onlineFailureMessage(failure({ case: 'subscription-required' }, 'audio', null), keys).title).toBe('status.loginExpired');
        expect(onlineFailureMessage(failure({ case: 'unreachable' }, 'audio', null), keys).title).toBe('status.playbackFailed');
    });

    it('keeps the refusals\' own sentences, and says 播放失败 or 加载失败 when nothing is known', () => {
        expect(onlineFailureMessage(failure({ case: 'subscription-required' }), keys)).toEqual({ title: 'status.songSubscriptionRequired' });
        expect(onlineFailureMessage(failure({ case: 'preview-only' }), keys)).toEqual({ title: 'status.songPreviewOnly' });
        expect(onlineFailureMessage(failure({ case: 'region-restricted' }), keys)).toEqual({ title: 'status.songRegionRestricted' });
        expect(onlineFailureMessage(failure({ case: 'not-public' }, 'collection'), keys)).toEqual({ title: 'playlist.loadNotPublic' });
        expect(onlineFailureMessage(failure({}), keys)).toEqual({ title: 'status.playbackFailed', note: 'failure.noteUnknown' });
        expect(onlineFailureMessage(failure({}, 'collection'), keys)).toEqual({ title: 'playlist.loadFailedPlain', note: 'failure.noteUnknown' });
    });

    it('has a note in the three languages for every possible likely cause', () => {
        const causes = ['sign-in', 'subscription', 'region'] as const;
        const noteKeys = ['failure.noteMaybeSignIn', 'failure.noteMaybeSubscription', 'failure.noteMaybeRegion'];
        for (const [cause, key] of causes.map((c, i) => [c, noteKeys[i]] as const)) {
            expect(onlineFailureMessage(failure({ case: 'no-audio', likelyCause: cause }), keys).note).toBe(key);
        }
        // 每个「可能的原因」的 note key 在三份语言文件里都要有译文。
        const missing = noteKeys.flatMap(key => [['zh-CN', zh], ['en', en], ['in', id]].filter(([, texts]) => !textOf(texts, key)).map(([name]) => `${key} in ${name}`));
        expect(missing).toEqual([]);
    });
});

describe('the quote', () => {
    it('is the platform\'s words with their code, else the code, else the HTTP status, else nothing', () => {
        expect(onlineFailureMessage(failure({ code: '-462', message: '操作频繁' }), keys).quote).toEqual({ text: '操作频繁', code: '-462' });
        expect(onlineFailureMessage(failure({ case: 'no-audio', code: '404' }), keys).quote).toEqual({ text: '404' });
        expect(onlineFailureMessage(failure({ httpStatus: 503 }), keys).quote).toEqual({ text: 'HTTP 503' });
        expect(onlineFailureMessage(failure({ case: 'no-audio' }), keys).quote).toBeUndefined();
    });

    it('is the MediaError code with its name for a media failure, never the browser\'s words', () => {
        expect(onlineFailureMessage(mediaFailureOf({ code: 3, message: 'PIPELINE_ERROR_DECODE' }, 'qq'), keys)).toEqual({
            title: 'failure.audioUnplayable',
            quote: { text: 'MEDIA_ERR_DECODE', code: '3' },
        });
        expect(onlineFailureMessage(mediaFailureOf({ code: 2 }, 'qq'), keys).quote).toEqual({ text: 'MEDIA_ERR_NETWORK', code: '2' });
        expect(onlineFailureMessage(mediaFailureOf(null), keys).quote).toBeUndefined();
    });
});
