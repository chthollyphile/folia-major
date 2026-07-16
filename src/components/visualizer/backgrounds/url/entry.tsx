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
