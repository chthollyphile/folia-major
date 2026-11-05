import {
    OnlineProviderError,
    type RecommendationPreferenceChanges,
    type RecommendationPreferenceItem,
    type RecommendationPreferenceLabel,
    type RecommendationPreferences,
    type RecommendationPreferencesSaveResult,
} from '../../../types/onlineMusic';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqPreferences.ts
// QQ 账号上的「我的音乐偏好」（qq-music-api 3.3.6 的 /user/recommendation-preferences 与 /update）。
// 私人 FM 和每日 30 首共用这一份，所以说明行写「会影响所有推荐的歌」。分数换算只在这里：
// 歌曲熟悉度、音乐情绪是三选一，分数 25／50／75；其余各项是比例，1–99，离 50 不到 5 就算 50（和官方页一样）。
// 重置是把各项拉回 50，面板只交改了的项，后端按现有顺序把整份写一次、再读回确认。

type ChoiceOption = { name: string; words: string };

/** 三选一的两项：低、中、高三档的名字（分数依次是 25、50、75），`words` 是官方页的字。 */
const CHOICES: Readonly<Record<string, { name: string; options: readonly [ChoiceOption, ChoiceOption, ChoiceOption] }>> = {
    10008: {
        name: 'familiarity',
        options: [
            { name: 'familiarityExplore', words: '更探索' },
            { name: 'keep', words: '保持现状' },
            { name: 'familiarityFamiliar', words: '更熟悉' },
        ],
    },
    10009: {
        name: 'mood',
        options: [
            { name: 'moodSad', words: '更伤感' },
            { name: 'keep', words: '保持现状' },
            { name: 'moodHappy', words: '更欢快' },
        ],
    },
};
const CHOICE_SCORES = ['25', '50', '75'] as const;

/** 比例项的名字；不在这里的 key 用后端给的名字。 */
const RATIO_NAMES: Readonly<Record<string, string>> = {
    10010: 'coverLive',
    10007: 'instrumental',
    10003: 'mandarin',
    10004: 'english',
    10006: 'japanese',
    10005: 'korean',
    10011: 'cantonese',
    10012: 'ai',
};

const DEFAULT_SCORE = 50;
const RATIO_MIN = 1;
const RATIO_MAX = 99;
const SNAP_WITHIN = 4;

const NOTE: RecommendationPreferenceLabel = {
    labelKey: 'qqPreferences.note',
    labelFallback: '保存在账号上，会影响所有推荐的歌',
};

const labelOf = (name: string | undefined, fallback: string): RecommendationPreferenceLabel => (
    name ? { labelKey: `qqPreferences.${name}`, labelFallback: fallback } : { labelFallback: fallback }
);

/** 三选一读到的分数不一定正好是 25／50／75：按在 50 的哪一边归到那一档。 */
const choiceScoreOf = (score: number): string => (
    score < DEFAULT_SCORE ? CHOICE_SCORES[0] : score > DEFAULT_SCORE ? CHOICE_SCORES[2] : CHOICE_SCORES[1]
);

const itemOf = (key: string, name: string, score: number): RecommendationPreferenceItem => {
    const choice = Object.hasOwn(CHOICES, key) ? CHOICES[key] : undefined;
    if (choice) {
        return {
            kind: 'choice',
            key,
            label: labelOf(choice.name, name),
            options: CHOICE_SCORES.map((value, at) => ({
                value,
                label: labelOf(choice.options[at].name, choice.options[at].words),
            })),
            value: choiceScoreOf(score),
            defaultValue: String(DEFAULT_SCORE),
        };
    }
    return {
        kind: 'ratio',
        key,
        label: labelOf(Object.hasOwn(RATIO_NAMES, key) ? RATIO_NAMES[key] : undefined, name),
        min: RATIO_MIN,
        max: RATIO_MAX,
        defaultValue: DEFAULT_SCORE,
        snapWithin: SNAP_WITHIN,
        value: Math.min(RATIO_MAX, Math.max(RATIO_MIN, score)),
    };
};

/** 读账号的偏好，照后端给的顺序；缺字段的项不要。 */
export const getQqRecommendationPreferences = async (): Promise<RecommendationPreferences> => {
    let answer: { profiles?: unknown };
    try {
        answer = await requestQq<{ profiles?: unknown }>('user_recommendation_preferences');
    } catch (error) {
        // 账号上一项偏好都没有时，后端回 422（resource.not-found）：这是空的，不是读失败。
        if (error instanceof OnlineProviderError && error.code === 'network' && error.httpStatus === 422) {
            console.info('[QQProvider] preferences:read', { items: 0 });
            return { items: [], note: NOTE };
        }
        throw error;
    }
    if (!Array.isArray(answer?.profiles)) {
        throw new OnlineProviderError('invalid-response', 'QQMusicApi user_recommendation_preferences answered without profiles', 'qq');
    }
    const items = answer.profiles.flatMap((profile: any) => {
        const key = typeof profile?.key === 'string' ? profile.key.trim() : '';
        const score = profile?.score;
        if (!key || typeof score !== 'number' || !Number.isFinite(score)) return [];
        const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : key;
        return [itemOf(key, name, score)];
    });
    console.info('[QQProvider] preferences:read', { items: items.length });
    return { items, note: NOTE };
};

/** 改了的项换回分数：三选一是选项的值，比例是整数。对不上的值是调用方写错了。 */
const scoreOf = (key: string, value: string | number): number => {
    const score = typeof value === 'string' ? Number(value) : value;
    if (!Number.isInteger(score) || score < 0 || score > 100) {
        throw new OnlineProviderError('invalid-response', `QQ preference ${key} has no whole score from 0 to 100`, 'qq');
    }
    return score;
};

/**
 * 只交改了的项；后端先读现值、只换这几项，按现有顺序整份写一次，再读回核对。
 * 读回全部对上才算确认；所有项本来就是这个值时后端不写，也算确认。失败抛错，不重送。
 */
export const saveQqRecommendationPreferences = async (
    changes: RecommendationPreferenceChanges,
): Promise<RecommendationPreferencesSaveResult> => {
    const profiles = Object.entries(changes).map(([key, value]) => ({ key, score: scoreOf(key, value) }));
    if (!profiles.length) return { confirmed: true };
    try {
        const answer = await requestQq<any>('user_recommendation_preferences_update', {}, { profiles });
        const confirmed = answer?.writeAttempted === false || answer?.verified === true;
        console.info('[QQProvider] preferences:saved', { changed: profiles.length, confirmed });
        return { confirmed };
    } catch (error) {
        // 写已经发出、之后读回核对失败：后端回非 2xx，错误体里带 writeAttempted。账号上可能已经改了，
        // 按「存了但没确认」交回，不当成没存成。
        if (error instanceof OnlineProviderError && (error.cause as { writeAttempted?: unknown } | undefined)?.writeAttempted === true) {
            console.warn('[QQProvider] preferences:saved, read-back failed', error);
            return { confirmed: false };
        }
        console.warn('[QQProvider] preferences:save failed', error);
        throw error;
    }
};
