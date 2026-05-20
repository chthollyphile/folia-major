import React from 'react';
import { type VisualizerMode } from '../../types';
import { type VisualizerSharedProps } from './definition';
import { getVisualizerRegistryEntry } from './registry';

interface VisualizerRendererProps extends VisualizerSharedProps {
    mode: VisualizerMode;
}

const VisualizerRenderer: React.FC<VisualizerRendererProps> = ({ mode, ...props }) =>
    getVisualizerRegistryEntry(mode).render(props);

export default VisualizerRenderer;
