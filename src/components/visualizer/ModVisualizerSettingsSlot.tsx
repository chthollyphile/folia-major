import React from 'react';

// src/components/visualizer/ModVisualizerSettingsSlot.tsx
/*
 * 模组 visualizer 设置面板的挂载锚点。
 *
 * 宿主的 `renderSettingsPanel` 是内置模式在源码里注册的 React 组件，模组拿不到；所以宿主在这里
 * 留一个空的、带稳定 data 属性的节点，模组自己的 DOM 面板把它当作挂载点。属性值就是当前模式 id，
 * 模组因此不必再猜「我是不是当前模式」。
 *
 * 契约（模组侧不要依赖别的属性，宿主重排布局时不保证其它结构）：
 *   [data-mod-visualizer-settings-slot="<当前 mode id>"]
 * 锚点缺席时模组必须能安全退化（面板不出现），见 mods/README.md。
 */
const ModVisualizerSettingsSlot: React.FC<{ mode: string }> = ({ mode }) => (
    <div data-mod-visualizer-settings-slot={mode} />
);

export default ModVisualizerSettingsSlot;
