import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCacheTableName } from '../../../../src/services/repositories/cacheRepository';
import { matchesCategory } from '../../../../src/services/repositories/cacheUsage';

// test/unit/dedicatus/contracts/cacheCategories.test.ts
// D509：每种歌曲资源缓存（SongResourceKind）的键都要在 cacheRepository 的分表和 cacheUsage 的清理分类里有归属：
// 落进 api_cache 兜底表的条目“变成清不掉的孤儿”，也不计进用量（src/services/onlineMusic/README.md）。
// 每个键恰好属于一个清理分类。

const ROOT = path.resolve(__dirname, '../../../..');
const CATEGORIES = ['playlist', 'lyrics', 'cover', 'analysis', 'volumeBalance', 'media'] as const;

/**
 * 还没归进清理分类的种类，写明原因；归好以后删掉这一条。
 * theme：主题缓存进了 metadata_cache 表，但设置页的“清除缓存”没有分类认它（2026-11-08 发现，待维护者决定归哪一类）。
 */
const KNOWN_UNCATEGORIZED: Record<string, string> = {
    theme: '待决定归哪个清理分类',
};

/** resourceKeys.ts 里的 SongResourceKind，以及 getSongResourceCacheKey 会用到的带版本的写法。 */
const resourceKinds = () => {
    const text = readFileSync(path.join(ROOT, 'src/services/onlineMusic/resourceKeys.ts'), 'utf8');
    const union = /export type SongResourceKind = ([^;]+);/.exec(text)?.[1] ?? '';
    const kinds = [...union.matchAll(/'(\w+)'/g)].map(match => match[1]);
    const versioned = [...text.matchAll(/\?\s*'(\w+_v\d+)'/g)].map(match => match[1]);
    return [...kinds, ...versioned];
};

describe('D509 every song resource cache key has a table and a cleanup category', () => {
    const kinds = resourceKinds();

    it('reads the resource kinds, so the pattern still matches something', () => {
        expect(kinds).toEqual(expect.arrayContaining(['audio', 'lyric', 'cover', 'theme', 'replayGain', 'cover_v2']));
    });

    it('keeps each kind out of the api_cache fall-through table', () => {
        const fallThrough = kinds.filter(kind => getCacheTableName(`${kind}_netease_123`) === 'api_cache');
        expect(fallThrough, 'D509：在 cacheRepository.ts 的 getCacheTableName 里给这些前缀分表').toEqual([]);
    });

    it('puts each kind in exactly one cleanup category', () => {
        const wrong = kinds
            .filter(kind => !Object.hasOwn(KNOWN_UNCATEGORIZED, kind.replace(/_v\d+$/, '')))
            .map(kind => ({ kind, categories: CATEGORIES.filter(category => matchesCategory(`${kind}_netease_123`, category)) }))
            .filter(entry => entry.categories.length !== 1)
            .map(entry => `${entry.kind}：${entry.categories.join('、') || '没有分类'}`);
        expect(wrong, 'D509：在 cacheUsage.ts 的 matchesCategory 里给这些前缀归类（恰好一个）').toEqual([]);
    });

    it('lists as uncategorized only kinds that really are', () => {
        const nowCategorized = Object.keys(KNOWN_UNCATEGORIZED)
            .filter(kind => CATEGORIES.some(category => matchesCategory(`${kind}_netease_123`, category)));
        expect(nowCategorized, 'D509：这些已经归好类了，从 KNOWN_UNCATEGORIZED 删掉').toEqual([]);
    });
});
