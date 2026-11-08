import { describe, expect, it } from 'vitest';
import config from '../../../dev/coven/config.json';
import { riskOf } from '../../../dev/coven/risk.mjs';
import { lintKey, scopeFromBaseline, scopeFromSuppressions } from '../../../dev/coven/scope.mjs';

// test/unit/coven/scope.test.ts
// 范围和风险分级：由代码和路径确定性地算（plan/coven-plan.md 第 4 节），config.json 的 risk 是敏感路径表。

const rules = config.risk;

describe('coven risk', () => {
    it('starts from the code and goes up for sensitive paths', () => {
        expect(riskOf('D431', ['src/stores/useLibraryStore.ts'], rules).risk).toBe('R0');
        expect(riskOf('D405', ['src/utils/format.ts'], rules).risk).toBe('R1');
        expect(riskOf('D102', ['src/utils/lyrics/lyricMatchSources.ts', 'src/stores/useOnlineProviderAccountStore.ts'], rules).risk).toBe('R2');
        const store = riskOf('D101', ['src/stores/useVisualizerSettingsStore.ts', 'src/components/visualizer/registry.tsx'], rules);
        expect(store.risk).toBe('R3');
        expect(store.reasons.join('\n')).toContain('registry.tsx');
        expect(riskOf('D190', ['src/services/onlineMusic/kugou/kugouProvider.ts'], rules).risk).toBe('R3');
        expect(riskOf('D431', ['electron/main.cjs'], rules).risk).toBe('R3');
        expect(riskOf('D190', ['dev/dedicatus/rules.mjs'], rules).risk).toBe('R4');
        expect(riskOf('D431', ['package.json'], rules).risk).toBe('R4');
    });
});

describe('coven scope', () => {
    const entries = [
        'D101:src/stores/useVisualizerSettingsStore.ts->src/components/visualizer/registry.tsx',
        'D102:src/utils/lyrics/lyricMatchSources.ts->src/stores/useOnlineProviderAccountStore.ts',
        'D190:src/utils/themeColorMath.ts->src/components/visualizer/colorMix.ts',
        'D301:src/components/command-palette/commandRegistry.ts',
        'D999:retired/or/unknown.ts',
    ];

    it('turns baseline entries into items, filtered by code prefix', () => {
        const all = scopeFromBaseline(entries, { rules });
        expect(all.map(item => item.code)).toEqual(['D101', 'D102', 'D190', 'D301']);
        expect(all[1]).toMatchObject({ kind: 'baseline', action: 'refactor', risk: 'R2', paths: ['src/utils/lyrics/lyricMatchSources.ts', 'src/stores/useOnlineProviderAccountStore.ts'] });
        expect(all[3].paths).toEqual(['src/components/command-palette/commandRegistry.ts']);
        expect(scopeFromBaseline(entries, { codes: ['D1'], rules }).map(item => item.code)).toEqual(['D101', 'D102', 'D190']);
        expect(scopeFromBaseline(entries, { codes: ['D190', 'D301'], rules }).map(item => item.code)).toEqual(['D190', 'D301']);
    });

    it('folds suppressions into one item per rule and path prefix', () => {
        const suppressions = {
            'src/demo/a.ts': { '@stylistic/indent': { count: 3 }, '@stylistic/quotes': { count: 1 } },
            'src/demo/b.ts': { '@stylistic/indent': { count: 2 } },
            'src/utils/c.ts': { '@stylistic/indent': { count: 9 } },
        };
        const items = scopeFromSuppressions(suppressions, { rules: ['@stylistic/indent', '@stylistic/quotes', '@stylistic/eol-last'], prefixes: ['src/demo/'], riskRules: rules });
        expect(items).toEqual([
            expect.objectContaining({ key: lintKey('@stylistic/indent', 'src/demo/'), code: 'D430', files: ['src/demo/a.ts', 'src/demo/b.ts'], count: 5, risk: 'R0' }),
            expect.objectContaining({ key: 'lint:@stylistic/quotes@src/demo/', code: 'D431', count: 1 }),
        ]);
    });
});
