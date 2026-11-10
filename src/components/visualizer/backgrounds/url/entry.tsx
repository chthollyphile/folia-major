import React from 'react';
import UrlBackgroundLayer from './UrlBackgroundLayer';
import { UrlBackgroundSettingsCard } from './UrlBackgroundSettingsCard';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/url/entry.tsx
// Registers the embedded webpage shell background.

export default defineVisualizerBackground({
    mode: 'url',
    order: 40,
    labelKey: 'options.visualizerBackgroundModeUrl',
    labelFallback: 'Embed',
    // 嵌入：网页框
    glyph: (
        <>
            <rect x="3.5" y="5" width="17" height="14" rx="2" />
            <path d="M3.5 9.5h17" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Background: Embedded Background',
        description: 'Switch background to embedded webpage mode',
        keywords: ['embedded background', 'embed background', 'background embed', 'background url', 'url background', 'url', 'webpage', '嵌入背景', '网页背景', '背景切换到 嵌入背景', '背景切换到嵌入背景'],
    },
    render: ({ config }) => (
        <UrlBackgroundLayer
            urlBackgroundList={config?.url?.items}
            urlBackgroundSelectedId={config?.url?.selectedId}
        />
    ),
    renderSettingsPanel: ({ config, actions, ...props }) => (
        <UrlBackgroundSettingsCard
            {...props}
            urlBackgroundList={config?.url?.items}
            urlBackgroundSelectedId={config?.url?.selectedId}
            onAddUrlBackgroundItem={actions?.url?.onAdd}
            onUpdateUrlBackgroundItem={actions?.url?.onUpdate}
            onDeleteUrlBackgroundItem={actions?.url?.onDelete}
            onSetUrlBackgroundSelectedId={actions?.url?.onSelect}
        />
    ),
});
