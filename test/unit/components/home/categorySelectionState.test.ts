import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    canReuseCategorySongLists,
    categoryScopeOf,
} from '@/components/app/home/categorySelectionState';

// test/unit/components/home/categorySelectionState.test.ts
// 广场分类筛选的状态判据（2026-10-11 用户实测反馈三项的判据层）。

describe('categoryScopeOf', () => {
    it('separates the same category across providers', () => {
        // 分类 id 是各音源上游的内部键，QQ 的 categoryId 在酷狗/网易云那里根本不存在。
        // 所以 scope 必须带 provider，否则切音源后会误复用别的音源的数据。
        expect(categoryScopeOf('qq', '10000000')).not.toBe(categoryScopeOf('kugou', '10000000'));
    });

    it('separates different categories on the same provider', () => {
        expect(categoryScopeOf('qq', '10000000')).not.toBe(categoryScopeOf('qq', '10000001'));
    });

    it('is stable for the same provider and category', () => {
        expect(categoryScopeOf('qq', '10000000')).toBe(categoryScopeOf('qq', '10000000'));
    });
});

describe('canReuseCategorySongLists', () => {
    // 正常路径：切 tab 回来，同一分类、手上有数据 -> 复用，不重拉、不闪骨架。
    it('reuses the loaded lists when returning to the same category', () => {
        expect(canReuseCategorySongLists('qq:10000000', 'qq:10000000', 35)).toBe(true);
    });

    // 换了分类：手上那份是别的分类的，不能拿来顶。
    it('does not reuse another category\'s lists', () => {
        expect(canReuseCategorySongLists('qq:10000000', 'qq:10000001', 35)).toBe(false);
    });

    // 换了音源：同理。
    it('does not reuse another provider\'s lists', () => {
        expect(canReuseCategorySongLists('qq:10000000', 'kugou:10000000', 35)).toBe(false);
    });

    // 只有 scope 没有数据 —— 那是请求被取消或失败后留下的记账。误判成「已有数据」会让
    // 下一次切回来跳过拉取，直接对着空列表显示「暂无内容」。这是必须挡住的那一条。
    it('does not reuse when the recorded scope has no data left', () => {
        expect(canReuseCategorySongLists('qq:10000000', 'qq:10000000', 0)).toBe(false);
    });

    it('does not reuse before anything has been loaded', () => {
        expect(canReuseCategorySongLists(null, 'qq:10000000', 35)).toBe(false);
    });
});

// 「切 tab 不清分类筛选」是组件里的接线，判据函数管不到。Grid3D props 几十项又依赖 omni
// 单例与 zustand store，挂组件测试只会变成脆弱的大规模 mock，所以用静态断言钉住接线本身：
// tab 的 onClick 里不能出现 setCategorySelected(null)。曾经正因为它在那儿，用户反馈
// 「点发现再回来就不是刚刚出现的那些歌单了」。
describe('Grid3D tab switching keeps the category filter', () => {
    const grid3d = readFileSync(
        path.resolve(__dirname, '../../../../src/components/Grid3D.tsx'),
        'utf8',
    );

    it('never clears the category selection when switching tabs', () => {
        const tabOnClick = grid3d.match(
            /onClick=\{\(\) => \{\s*setHomeViewTab\(tab\.key as any\);([\s\S]*?)\}\}/,
        );
        expect(tabOnClick, 'tab onClick block not found').not.toBeNull();
        expect(tabOnClick?.[1]).not.toContain('setCategorySelected(null)');
    });

    it('does clear it when the provider switches', () => {
        // 跨 tab 保留 ≠ 跨音源保留：分类 id 是上游内部键，换音源必须清，否则旧音源的卡片
        // 可点、点进去却用新音源解析旧 id。
        const providerSwitch = grid3d.match(
            /const loggedOut = [\s\S]*?setFocusedIndex\(0\);/,
        );
        expect(providerSwitch?.[0]).toContain('setCategorySelected(null)');
    });

    it('resets the loading flag when leaving the radio tab', () => {
        // 切走时不复位，切回来会先看到一帧永远的骨架。
        expect(grid3d).toMatch(
            /if \(homeViewTab !== "radio"\) \{\s*setLoadingCategory\(false\);\s*return;/,
        );
    });
});
