import type { ReactNode } from 'react';
import type { Theme } from '../../types';
import type { VisualizerComplexV1 } from '../visualizer/complex';

// Shared contracts for the visualizer complex editor UI.
export interface VisEditorProps {
    complex: VisualizerComplexV1;
    theme: Theme;
    isDaylight: boolean;
    onChange: (complex: VisualizerComplexV1) => void;
    onSave?: () => void;
    onReset?: () => void;
    onBack?: () => void;
    preview?: ReactNode;
    isPreviewPlaying?: boolean;
    onTogglePreviewPlayback?: () => void;
}
