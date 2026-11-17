import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from '../../visualizer/backgrounds/registry';
import { buildPickerMatches } from '../commands/pickerOptions';
import type { CommandPaletteSurface } from './types';

// src/components/command-palette/surfaces/pickerSurface.ts
// Visualizer and background pickers: the input filters, arrows move, Enter or a click applies.
// The rows are a single column, so the palette's default one-per-press list navigation already
// matches the layout and no arrow handling is overridden here.

const createPickerSurface = (kind: 'visualizer' | 'background'): CommandPaletteSurface => ({
    // Both pickers change what is drawn behind the palette, so they keep it in view.
    backdrop: 'clear',
    load: () => import('./PickerSurfaceView'),
    useLiveQuery: true,
    buildMatches: ({ context, query }) => buildPickerMatches(kind, context, query),
    mapProps: ({ context, matches, activeIndex, setActiveIndex, executeMatch, isDaylight, theme, isExecuting }) => ({
        kind,
        matches,
        activeIndex,
        setActiveIndex,
        executeMatch,
        isDaylight,
        theme,
        isExecuting,
        currentMode: kind === 'visualizer'
            ? context.visualizer.visualizerMode
            : String(context.visualizer.visualizerBackgroundMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE),
        // Only the visualizer picker offers to stay open, like the queue surface does.
        keepOpen: kind === 'visualizer'
            ? {
                checked: context.visualizer.visualizerPickerKeepOpen,
                onChange: context.visualizer.setVisualizerPickerKeepOpen,
            }
            : null,
    }),
});

export const visualizerPickerSurface = createPickerSurface('visualizer');
export const backgroundPickerSurface = createPickerSurface('background');
