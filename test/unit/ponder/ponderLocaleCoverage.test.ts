import { describe, expect, it } from 'vitest';
import { PONDER_TARGET_LIST } from '@/components/ponder/ponderRegistry';
import en from '@/i18n/locales/en';
import zhCN from '@/i18n/locales/zh-CN';
import id from '@/i18n/locales/in';
import type { PonderStep } from '@/types/ponder';

// test/unit/ponder/ponderLocaleCoverage.test.ts
// 场景文案缺键不会报任何错，只会把 "ponder.captions.panelSlide.intro" 原样画进教程里。
// 命令注册表那套契约测试管不到这些 key，这是唯一会发现它的地方 —— 印尼语那份尤其容易漏。

const LOCALES = { en, 'zh-CN': zhCN, in: id } as const;

const lookup = (bundle: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>(
        (node, segment) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined),
        bundle,
    );

/** 一个步骤引用到的所有 i18n key。 */
const stepTextKeys = (step: PonderStep): string[] => (step.kind === 'caption' ? [step.textKey] : []);

const allKeys = (): string[] => {
    const keys = new Set<string>();
    // 外框和胶囊自己用的固定 key，和场景文案一起校验。
    [
        'ponder.title', 'ponder.hintCapsulePage', 'ponder.hintCapsuleHold', 'ponder.sceneCounter',
        'ponder.playPause', 'ponder.replay', 'ponder.seekKeyframe', 'ponder.prevKeyframe', 'ponder.nextKeyframe',
        'ponder.legend.keyframe', 'ponder.legend.chapter', 'ponder.legend.pause', 'ponder.legend.exit',
        'ponder.navigation.title', 'ponder.navigation.all', 'ponder.navigation.unseen', 'ponder.navigation.search',
        'ponder.navigation.empty', 'ponder.navigation.seen',
        'ponder.categories.basics', 'ponder.categories.playback', 'ponder.categories.browsing',
        'ponder.categories.appearance', 'ponder.categories.desktop',
        'options.ponderHints', 'options.ponderHintsDesc',
        'options.ponderHintsAlways', 'options.ponderHintsUnseen', 'options.ponderHintsOff',
    ].forEach(key => keys.add(key));

    PONDER_TARGET_LIST.forEach(target => {
        keys.add(target.titleKey);
        // 导航页卡片上那一行。缺了就把 key 本身画在卡上，而这一屏是新用户最先看到的地方。
        if (target.summaryKey) keys.add(target.summaryKey);
        target.scenes.forEach(scene => {
            keys.add(scene.titleKey);
            if (scene.action) keys.add(scene.action.labelKey);
            scene.steps.forEach(step => stepTextKeys(step).forEach(key => keys.add(key)));
            // 锚点标签同样是画在屏幕上的文案，缺了就会把 key 本身渲染到骨架旁边。
            Object.values(scene.anchors).forEach(source => {
                if (source.labelKey) keys.add(source.labelKey);
            });
        });
    });
    return [...keys];
};

describe('ponder locale coverage', () => {
    it.each(Object.keys(LOCALES))('%s 有全部思索文案', localeName => {
        const bundle = LOCALES[localeName as keyof typeof LOCALES];
        const missing = allKeys().filter(key => typeof lookup(bundle, key) !== 'string');

        expect(missing, `${localeName} 缺少：${missing.join(', ')}`).toEqual([]);
    });

    it('三份 locale 的思索 key 集合完全一致', () => {
        const flatten = (node: unknown, prefix = ''): string[] => {
            if (typeof node === 'string') return [prefix];
            if (!node || typeof node !== 'object') return [];
            return Object.entries(node as Record<string, unknown>)
                .flatMap(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key));
        };

        const sets = Object.entries(LOCALES).map(([name, bundle]) => ({
            name,
            keys: flatten((bundle as Record<string, unknown>).ponder).sort(),
        }));

        sets.forEach(({ name, keys }) => {
            expect(keys, `${name} 的 ponder key 集合与 en 不一致`).toEqual(sets[0].keys);
        });
    });
});
