import { DEFAULT_FUME_TUNING } from '../../../types';
import type { VisualizerBackgroundConfig } from '../backgrounds/definition';
import type { VisualizerSharedProps } from '../definition';

// src/components/visualizer/fume/backgroundConfig.ts
// The background Fume is drawn over: the one it is given, with the geometric shapes off where Fume's
// own setting says so (by default it does). Its registry entry hands this to the backdrop
// VisualizerRenderer draws, and VisualizerFume to its own shell where that one stands alone.

export const fumeBackgroundConfig = (props: VisualizerSharedProps): VisualizerBackgroundConfig => ({
    ...props.background,
    common: {
        ...props.background?.common,
        disableGeometricBackground: Boolean(props.background?.common?.disableGeometricBackground)
            || (props.fumeTuning?.disableGeometricBackground ?? DEFAULT_FUME_TUNING.disableGeometricBackground),
    },
});
