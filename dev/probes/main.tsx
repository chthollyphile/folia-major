import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import '../../src/index.css';
import type { ProbeDefinition } from './definition';
import { PROBES, PROBE_LIST } from './registry';
// dev/probes/main.tsx

/**
 * 组件探针的挂载入口，同时是 Playwright component testing 的 gallery。
 *
 * 存在的理由：这个仓库没有 jsdom/RTL 组件测试环境，而实际踩到的坑（层叠命中测试、
 * Tailwind v4 语法、StrictMode 双调用）全都只在真实浏览器里才暴露。探针提供的是
 * 真实 vite + 真实 Tailwind + StrictMode 的最小宿主，能单独挂一个组件反复戳。
 *
 * 一个页面两个门面：
 * - 给人看：`?probe=<id>` 挂单个探针，缺省时列出全部。
 * - 给测试用：`window.mount` / `window.unmount`，由 @playwright/test 的内置 mount
 *   fixture 驱动。契约见 node_modules/playwright-core/lib/tools/skills/
 *   playwright-component-testing/references/gallery-spec.md。
 *
 * 不另起一个 gallery 页，是因为 StrictMode、index.css、registry 这套宿主只该有一份；
 * 两个页面各维护一份迟早会漂移。
 *
 * StrictMode 是刻意开的：effect 双调用引发的 bug 只有在这里才复现。
 */
const ProbeIndex: React.FC = () => (
    <div className="mx-auto max-w-2xl p-10 font-sans text-zinc-100">
        <h1 className="mb-1 text-xl font-bold">Component Probes</h1>
        <p className="mb-6 text-sm text-zinc-400">在 URL 上加 ?probe=&lt;id&gt; 挂载单个组件。</p>
        <ul className="flex flex-col gap-3">
            {PROBE_LIST.map(probe => (
                <li key={probe.id}>
                    <a
                        className="block rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:bg-white/10"
                        href={`?probe=${probe.id}`}
                    >
                        <span className="block text-sm font-semibold">{probe.title}</span>
                        <span className="mt-1 block text-xs text-zinc-400">{probe.description}</span>
                        <code className="mt-2 block text-[11px] text-zinc-500">?probe={probe.id}</code>
                    </a>
                </li>
            ))}
            {PROBE_LIST.length === 0 && <li className="text-sm text-zinc-400">还没有探针。</li>}
        </ul>
    </div>
);

const rootEl = document.getElementById('root')!;
let root: Root | undefined;

/**
 * 复用同一个 root。gallery 契约要求 `component.update(props)` 能在不重新挂载的前提下换 props，
 * 靠的就是 React 对同一个 root 做协调；每次重建 root 会把组件内部状态清掉，update() 就退化成
 * 重新挂载了。
 *
 * flushSync 是为了让渲染期抛的错同步冒出来 —— 否则 window.mount 会先 resolve，错误再被 React
 * 吞进 console，测试那头只能看到「元素找不到」这种毫无线索的失败。
 */
const render = (probe: ProbeDefinition | undefined, props?: Record<string, unknown>) => {
    // 现有探针都不收 props（场景写死在探针里）。props 通道留给「同一个探针跑标量参数扫描」
    // 这类用法，所以这里放宽类型而不是改 ProbeDefinition 去逼所有探针声明 props。
    const Component = probe?.Component as React.ComponentType<Record<string, unknown>> | undefined;
    root ??= createRoot(rootEl);
    flushSync(() => {
        root!.render(
            <React.StrictMode>
                <div className="min-h-screen bg-zinc-900" data-probe-id={probe?.id ?? ''}>
                    {Component ? <Component {...props} /> : <ProbeIndex />}
                </div>
            </React.StrictMode>,
        );
    });
};

declare global {
    interface Window {
        mount: (params: { story: string; props?: Record<string, unknown> }) => Promise<void>;
        unmount: () => Promise<void>;
    }
}

// story id 沿用探针 id（fmTab、settingsNavigation……）。gallery 自己拥有解析，不必套
// Playwright 文档里那套 `src/` 路径约定 —— 那样只会让 spec 里的标识凭空变长。
window.mount = async ({ story, props }) => {
    const probe = PROBES[story];
    if (!probe) {
        throw new Error(`[Probe] Unknown story "${story}". Available: ${PROBE_LIST.map(p => p.id).join(', ')}`);
    }
    render(probe, props);
};

window.unmount = async () => {
    root?.unmount();
    root = undefined;
};

const requestedId = new URLSearchParams(window.location.search).get('probe');
const selected = requestedId ? PROBES[requestedId] : undefined;

if (requestedId && !selected) {
    console.error(`[Probe] Unknown probe "${requestedId}". Available: ${PROBE_LIST.map(p => p.id).join(', ')}`);
}

render(selected);
