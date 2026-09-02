import { describe, expect, it } from 'vitest';
import { VISUALIZER_REGISTRY } from '@/components/visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY } from '@/components/visualizer/backgrounds/registry';
import {
    BUILTIN_VISUALIZER_BACKGROUND_MODES,
    BUILTIN_VISUALIZER_MODES,
} from '@/types/visualizerModes';

// types/visualizerModes.ts 静态声明模式 id，好让 store / 同步 schema / OBS 短码只为校验一个字符串
// 就不必 import 整个 visualizer 层。清单本身由 registry 在初始化时断言（漂移直接抛错），这里再
// 显式测一遍，是为了让「清单必须和 entry 目录一致」这条约束在测试列表里看得见。
describe('内建模式清单与 entry 目录一致', () => {
    it('visualizer 模式', () => {
        expect([...BUILTIN_VISUALIZER_MODES].sort())
            .toEqual(VISUALIZER_REGISTRY.map(entry => entry.mode).sort());
    });

    it('background 模式', () => {
        expect([...BUILTIN_VISUALIZER_BACKGROUND_MODES].sort())
            .toEqual(VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode).sort());
    });
});
