import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import zhCN from '@/i18n/locales/zh-CN';
import id from '@/i18n/locales/in';
import {
    PLAYBACK_FAILURE_ACTION_LABEL_KEYS,
    PLAYBACK_FAILURE_MESSAGE_KEYS,
} from '@/services/playbackRecovery/playbackFailurePolicy';

// test/unit/playback/playbackFailureLocaleCoverage.test.ts
// 播放失败文案缺键不会报错，只会把 "status.songNetworkFailed" 原样显示在状态条上。
// 策略表导出的全部文案 key 和按钮 key 在这里逐个对三份 locale 校验，印尼语那份尤其容易漏。

const LOCALES = { en, 'zh-CN': zhCN, in: id } as const;

const lookup = (bundle: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>(
        (node, segment) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined),
        bundle,
    );

const allKeys = (): string[] => [...new Set<string>([
    ...PLAYBACK_FAILURE_MESSAGE_KEYS,
    ...PLAYBACK_FAILURE_ACTION_LABEL_KEYS,
])];

/** 一条文案里出现的全部插值占位符，排序后用于跨语言比较。 */
const placeholdersOf = (text: string): string[] =>
    [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(match => match[1]).sort();

describe('playback failure locale coverage', () => {
    it.each(Object.keys(LOCALES))('%s 有全部播放失败文案和按钮文案', localeName => {
        const bundle = LOCALES[localeName as keyof typeof LOCALES];
        const missing = allKeys().filter(key => {
            const value = lookup(bundle, key);
            return typeof value !== 'string' || value.trim().length === 0;
        });

        expect(missing, `${localeName} 缺少或为空：${missing.join(', ')}`).toEqual([]);
    });

    it('覆盖的 key 包含新增的失败文案、重试提示和倒计时文案', () => {
        const keys = allKeys();

        expect(keys).toEqual(expect.arrayContaining([
            'status.songTemporarilyUnavailable',
            'status.songTemporarilyUnavailableSignInHint',
            'status.songNetworkFailed',
            'status.songRequestTimedOut',
            'status.songRetrying',
            'status.songServiceUnavailable',
            'status.songServiceNotConfigured',
            'status.songRateLimited',
            'status.songRateLimitedNoWait',
            'status.songLoginRequired',
            'status.songMembershipRequired',
            'status.songPurchaseRequired',
            'status.songEntitlementRequired',
            'status.songUnavailablePrompt',
            'ui.retry',
            'status.skipUnavailableAction',
            'status.cancel',
        ]));
    });

    it('含 {{seconds}} 的 key 在三份 locale 里都含 {{seconds}}', () => {
        const secondsKeys = allKeys().filter(key =>
            Object.values(LOCALES).some(bundle => String(lookup(bundle, key) ?? '').includes('{{seconds}}')),
        );

        // 限流等待秒数和下架倒计时都靠这个占位符；少了它用户只会看到没有数字的句子。
        expect(secondsKeys).toEqual(expect.arrayContaining(['status.songRateLimited', 'status.songUnavailablePrompt']));
        secondsKeys.forEach(key => {
            Object.entries(LOCALES).forEach(([localeName, bundle]) => {
                expect(String(lookup(bundle, key) ?? ''), `${localeName} 的 ${key} 缺少 {{seconds}}`).toContain('{{seconds}}');
            });
        });
    });

    it('三份 locale 的插值占位符完全一致', () => {
        allKeys().forEach(key => {
            const [reference, ...others] = Object.entries(LOCALES).map(([localeName, bundle]) => ({
                localeName,
                placeholders: placeholdersOf(String(lookup(bundle, key) ?? '')),
            }));
            others.forEach(({ localeName, placeholders }) => {
                expect(placeholders, `${localeName} 的 ${key} 占位符与 ${reference.localeName} 不一致`)
                    .toEqual(reference.placeholders);
            });
        });
    });
});
