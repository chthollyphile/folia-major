import { describe, expect, it } from 'vitest';
import {
    catalogueTagOf,
    integrationBranchOf,
    isIntegrationBranch,
    isTaskBranch,
    nextRunNumber,
    nextTaskNumber,
    parseScopeName,
    parseTaskId,
    runLabel,
    scopeLabel,
    taskBranchOf,
    taskLabel,
    tempoLabel,
    titleWithCatalogue,
} from '../src/catalogue.mjs';

// packages/coven/test/catalogue.test.mjs
// Coven 的乐谱编目：显示名和机器名互转、作品号和任务号只增不回收、范围名的体裁、风险级配的速度术语、PR 标题带代号。

describe('coven catalogue names', () => {
    it('turns machine names into score names and branches', () => {
        expect(runLabel('op3')).toBe('Op. 3');
        expect(runLabel('woo12')).toBe('WoO 12');
        expect(taskLabel('op3-no2')).toBe('Op. 3 No. 2');
        expect(taskLabel('op3-no2', 'lyric-match-sources')).toBe('Op. 3 No. 2 "lyric-match-sources"');
        expect(parseTaskId('woo1-no10')).toEqual({ run: 'woo1', number: 10 });
        expect(parseTaskId('op0-no1')).toBeNull();
        expect(integrationBranchOf('op3')).toBe('coven/op3');
        expect(catalogueTagOf('op3')).toBe('coven-op3');
        expect(taskBranchOf('op3-no2')).toBe('coven/op3-no2');
        expect(isIntegrationBranch('coven/op3')).toBe(true);
        expect(isIntegrationBranch('coven/op3-no2')).toBe(false);
        expect(isIntegrationBranch('main')).toBe(false);
        expect(isTaskBranch('coven/op3-no2')).toBe(true);
        expect(isTaskBranch('coven/task-2026-11-09-a')).toBe(false);
    });

    it('hands out the next opus number per kind and never reuses one', () => {
        const used = ['refs/heads/coven/op2', 'refs/heads/coven/op2-no5', 'coven/op10', 'op7.json', 'woo4', 'refs/heads/coven/run-2026-11-09', 'unknown-x'];
        expect(nextRunNumber(used, false)).toBe(11);
        // 分支合完删掉了，占号标签还在：号不会被再用
        expect(nextRunNumber(['refs/tags/coven-op12', 'refs/heads/coven/op3'], false)).toBe(13);
        expect(nextRunNumber(used, true)).toBe(5);
        expect(nextRunNumber([], false)).toBe(1);
        expect(nextTaskNumber('op3', ['op3-no1', 'op3-no4', 'op2-no9'])).toBe(5);
        expect(nextTaskNumber('op3', [])).toBe(1);
    });

    it('names a scope by a musical genre', () => {
        expect(parseScopeName('fugue-boundaries')).toEqual({ genre: 'fugue', title: 'boundaries' });
        expect(parseScopeName('interlude')).toEqual({ genre: 'interlude', title: null });
        expect(parseScopeName('arch-1108')).toBeNull();
        expect(parseScopeName('fugue-Bad')).toBeNull();
        expect(scopeLabel('etude-stores')).toBe('Étude "stores"');
        expect(scopeLabel('variations')).toBe('Variations');
    });

    it('puts a tempo on the risk level and the catalogue name at the end of a PR title', () => {
        expect(['R0', 'R1', 'R2', 'R3', 'R4'].map(tempoLabel)).toEqual(['Presto（R0）', 'Allegro（R1）', 'Andante（R2）', 'Adagio（R3）', 'Grave（R4）']);
        expect(titleWithCatalogue('refactor(stores): 收进 storagePrimitives', 'op3-no2')).toBe('refactor(stores): 收进 storagePrimitives [Op. 3 No. 2]');
        expect(titleWithCatalogue('refactor(stores): 收进 storagePrimitives [Op. 3 No. 2]', 'op3-no2')).toBe('refactor(stores): 收进 storagePrimitives [Op. 3 No. 2]');
    });
});
