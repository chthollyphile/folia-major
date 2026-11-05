import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqPreferences.test.ts
// QQ 账号的音乐偏好：回包形状取自 qq-music-api 3.3.6 的 /user/recommendation-preferences
// （{ profiles:[{ key, name, score }] }）与 /update（{ writeAttempted, verified }）；分数是虚构示例。

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/qq/qqTransport', () => ({ requestQq: requestMock }));

import { getQqRecommendationPreferences, saveQqRecommendationPreferences } from '@/services/onlineMusic/qq/qqPreferences';
import { normalizeRecommendationPreferences } from '@/services/onlineMusic/recommendationPreferences';
import type { RecommendationPreferenceChoice, RecommendationPreferenceRatio } from '@/types/onlineMusic';
import { OnlineProviderError } from '@/types/onlineMusic';
import i18n from '@/i18n/config';

const PROFILES = [
    { key: '10008', name: '歌曲熟悉度', score: 75 },
    { key: '10009', name: '音乐情绪', score: 50 },
    { key: '10010', name: '翻唱&现场', score: 30 },
    { key: '10007', name: '纯音乐', score: 50 },
    { key: '10003', name: '国语', score: 99 },
    { key: '10004', name: '英语', score: 50 },
    { key: '10006', name: '日语', score: 50 },
    { key: '10005', name: '韩语', score: 50 },
    { key: '10011', name: '粤语', score: 50 },
    { key: '10012', name: 'AI', score: 0 },
];

describe('QQ recommendation preferences', () => {
    beforeEach(() => {
        requestMock.mockReset();
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    it('reads the ten items in QQ order: familiarity and mood as three choices, the rest as ratios', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, scope: 'account', profiles: PROFILES });
        const preferences = await getQqRecommendationPreferences();
        expect(requestMock).toHaveBeenCalledWith('user_recommendation_preferences');
        expect(preferences.items.map(item => [item.key, item.kind])).toEqual([
            ['10008', 'choice'], ['10009', 'choice'],
            ['10010', 'ratio'], ['10007', 'ratio'], ['10003', 'ratio'], ['10004', 'ratio'],
            ['10006', 'ratio'], ['10005', 'ratio'], ['10011', 'ratio'], ['10012', 'ratio'],
        ]);
        const familiarity = preferences.items[0] as RecommendationPreferenceChoice;
        expect(familiarity.options.map(option => option.value)).toEqual(['25', '50', '75']);
        expect(familiarity.options.map(option => option.label.labelFallback)).toEqual(['更探索', '保持现状', '更熟悉']);
        expect(familiarity).toMatchObject({ value: '75', defaultValue: '50' });
        expect((preferences.items[1] as RecommendationPreferenceChoice).options.map(option => option.label.labelFallback))
            .toEqual(['更伤感', '保持现状', '更欢快']);
        const cover = preferences.items[2] as RecommendationPreferenceRatio;
        expect(cover).toMatchObject({ min: 1, max: 99, defaultValue: 50, snapWithin: 4, value: 30 });
        // The slider stays within 1–99, the way QQ's own page shows it.
        expect(preferences.items.find(item => item.key === '10003')).toMatchObject({ value: 99 });
        expect(preferences.items.find(item => item.key === '10012')).toMatchObject({ value: 1 });
        expect(preferences.note?.labelFallback).toBe('保存在账号上，会影响所有推荐的歌');
    });

    it('names every item and option through its own key, in all four languages', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, profiles: PROFILES });
        const preferences = await getQqRecommendationPreferences();
        const labels = [
            preferences.note!,
            ...preferences.items.flatMap(item => [item.label, ...(item.kind === 'choice' ? item.options.map(option => option.label) : [])]),
        ];
        for (const language of ['zh-CN', 'en', 'in', 'vi']) {
            for (const label of labels) {
                expect(label.labelKey, label.labelFallback).toMatch(/^qqPreferences\./);
                expect(i18n.exists(label.labelKey!, { lng: language }), `${language} ${label.labelKey}`).toBe(true);
            }
        }
    });

    it('puts a three-choice score on the side of 50 it lies, and names an unknown key by QQ\'s own words', async () => {
        requestMock.mockResolvedValueOnce({
            code: 200,
            profiles: [
                { key: '10008', name: '歌曲熟悉度', score: 99 },
                { key: '10009', name: '音乐情绪', score: 10 },
                { key: '19999', name: '新的一项', score: 60 },
                { key: '', name: '空', score: 50 },
                { key: '10004', name: '英语', score: '50' },
            ],
        });
        const preferences = await getQqRecommendationPreferences();
        expect(preferences.items.map(item => [item.key, item.value])).toEqual([['10008', '75'], ['10009', '25'], ['19999', 60]]);
        expect(preferences.items[2].label).toEqual({ labelFallback: '新的一项' });
    });

    it('treats inherited object keys as ratios named by QQ', async () => {
        requestMock.mockResolvedValueOnce({ profiles: [
            { key: '__proto__', name: '新偏好', score: 60 },
            { key: 'constructor', name: '另一项', score: 40 },
        ] });
        const { items } = await getQqRecommendationPreferences();
        expect(items.map(item => [item.kind, item.label])).toEqual([
            ['ratio', { labelFallback: '新偏好' }], ['ratio', { labelFallback: '另一项' }],
        ]);
    });

    it('passes the omni tidying unchanged', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, profiles: PROFILES });
        const preferences = await getQqRecommendationPreferences();
        expect(normalizeRecommendationPreferences(preferences)).toEqual(preferences);
    });

    it('throws when the answer has no profiles', async () => {
        requestMock.mockResolvedValueOnce({ code: 200 });
        await expect(getQqRecommendationPreferences()).rejects.toThrow('without profiles');
    });

    it('saves only what changed, as whole scores, and is confirmed by the read-back', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, writeAttempted: true, verified: true, verification: 'confirmed' });
        await expect(saveQqRecommendationPreferences({ 10008: '25', 10003: 70 })).resolves.toEqual({ confirmed: true });
        expect(requestMock).toHaveBeenCalledWith('user_recommendation_preferences_update', {}, {
            profiles: [{ key: '10003', score: 70 }, { key: '10008', score: 25 }],
        });
    });

    it('is unconfirmed when the read-back differs, and confirmed when nothing had to be written', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, writeAttempted: true, verified: false, verification: 'unconfirmed' });
        await expect(saveQqRecommendationPreferences({ 10010: 20 })).resolves.toEqual({ confirmed: false });
        requestMock.mockResolvedValueOnce({ code: 200, writeAttempted: false });
        await expect(saveQqRecommendationPreferences({ 10010: 20 })).resolves.toEqual({ confirmed: true });
    });

    it('keeps a __proto__ key as an ordinary change', async () => {
        requestMock.mockResolvedValueOnce({ code: 200, writeAttempted: true, verified: true });
        const changes = Object.fromEntries([['__proto__', 60]]);
        await saveQqRecommendationPreferences(changes);
        expect(requestMock.mock.calls[0][2]).toEqual({ profiles: [{ key: '__proto__', score: 60 }] });
    });

    it('refuses a score that is not whole or out of range, and sends nothing for no change', async () => {
        await expect(saveQqRecommendationPreferences({ 10010: 20.5 })).rejects.toThrow('whole score');
        await expect(saveQqRecommendationPreferences({ 10008: 'more' })).rejects.toThrow('whole score');
        await expect(saveQqRecommendationPreferences({ 10010: 101 })).rejects.toThrow('whole score');
        await expect(saveQqRecommendationPreferences({})).resolves.toEqual({ confirmed: true });
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('throws a failed write and does not send it again', async () => {
        requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', undefined, 502));
        await expect(saveQqRecommendationPreferences({ 10010: 20 })).rejects.toThrow('502');
        expect(requestMock).toHaveBeenCalledTimes(1);
    });

    // 写已经发出、核对那一读失败：账号上可能已经改了，按存了但没确认交回，也不再送一次。
    it('is unconfirmed, not failed, when the write went out and only the read-back failed', async () => {
        requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi failed: HTTP 502', 'qq', {
            retryable: false, writeAttempted: true, accepted: true, verified: false, verification: 'unconfirmed',
        }, 502));
        await expect(saveQqRecommendationPreferences({ 10010: 20 })).resolves.toEqual({ confirmed: false });
        expect(requestMock).toHaveBeenCalledTimes(1);
    });

    // 账号上一项偏好都没有时后端回 422：是空的，不是读失败。
    it('reads an account without any preference as empty', async () => {
        requestMock.mockRejectedValueOnce(new OnlineProviderError('network', 'QQMusicApi failed: HTTP 422', 'qq', { errorKey: 'resource.not-found' }, 422));
        await expect(getQqRecommendationPreferences()).resolves.toMatchObject({ items: [] });
    });
});
