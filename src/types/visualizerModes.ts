import type { VisualizerBackgroundMode, VisualizerMode } from '../types';

// src/types/visualizerModes.ts
// 内建模式 id 的权威清单，以及只需要「这个字符串是不是合法模式」时该用的判定。
//
// 运行时真正的注册表是 components/visualizer/registry.tsx，它用 import.meta.glob 从各模式的
// entry.tsx 发现成员——那是唯一能包含 mod 投稿模式的来源，但也会 eager 拉进全部 renderer
// （183 个模块，含 three.js）。store、同步 schema、OBS 短码解析都只是在校验一个字符串，
// 不该为此扛整个 visualizer 层，也不该让叶子层反向依赖 UI。
//
// 清单静态写在这里，但**不靠人去同步**：registry 初始化时断言 glob 发现的集合与这里逐字相等，
// 对不上就抛错（assertBuiltinVisualizerModes）。漏加一个模式会当场炸，不会像旧文档那样
// 悄悄少两个。

export const BUILTIN_VISUALIZER_MODES = [
    'cadenza',
    'cappella',
    'claddagh',
    'classic',
    'diorama',
    'fume',
    'monet',
    'partita',
    'pendolo',
    'sonnet',
    'still',
    'tempera',
    'tilt',
] as const;

export const BUILTIN_VISUALIZER_BACKGROUND_MODES = [
    'common',
    'latent',
    'monet',
    'nomand',
    'sora',
    'url',
] as const;

export const DEFAULT_VISUALIZER_MODE: VisualizerMode = 'classic';
export const DEFAULT_VISUALIZER_BACKGROUND_MODE: VisualizerBackgroundMode = 'latent';

const VISUALIZER_MODE_SET: ReadonlySet<string> = new Set(BUILTIN_VISUALIZER_MODES);
const VISUALIZER_BACKGROUND_MODE_SET: ReadonlySet<string> = new Set(BUILTIN_VISUALIZER_BACKGROUND_MODES);

// mod 投稿的模式 id 一律带 `mod:` 前缀（由加载器加上），所以内建判定不会误判它们为合法，
// 也不会把它们当成未知值——两者结构上可区分。需要认 mod 模式的地方用 registry 的
// hasVisualizerMode，它查的是活注册表。
export const isBuiltinVisualizerMode = (mode: unknown): mode is VisualizerMode =>
    typeof mode === 'string' && VISUALIZER_MODE_SET.has(mode);

// 背景模式没有 mod 投稿通道（registry 只给 visualizer 开了 appendVisualizerEntry），
// 所以这个判定与活注册表在任何时刻都等价。
export const isBuiltinVisualizerBackgroundMode = (mode: unknown): mode is VisualizerBackgroundMode =>
    typeof mode === 'string' && VISUALIZER_BACKGROUND_MODE_SET.has(mode);

// 供两个 registry 在初始化时自检。discovered 是 glob 实际发现的模式 id。
export const assertBuiltinModeList = (
    label: string,
    discovered: readonly string[],
    declared: readonly string[],
): void => {
    const missing = discovered.filter(mode => !declared.includes(mode));
    const stale = declared.filter(mode => !discovered.includes(mode));
    if (missing.length === 0 && stale.length === 0) return;
    throw new Error(
        `[${label}] src/types/visualizerModes.ts 的清单与 entry 目录不一致：`
        + `${missing.length > 0 ? ` 缺少 ${missing.join(', ')}；` : ''}`
        + `${stale.length > 0 ? ` 多出 ${stale.join(', ')}；` : ''}`
        + ' 改完模式目录请同步这份清单。',
    );
};
