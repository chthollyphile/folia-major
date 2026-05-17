import { useMemo } from 'react';
import type React from 'react';
import LegacyUnifiedPanel from '../../UnifiedPanel';

// Player panel view model hides legacy UnifiedPanel prop flattening from App.tsx.
type LegacyUnifiedPanelProps = React.ComponentProps<typeof LegacyUnifiedPanel>;

type PlayerPanelViewModelInput = {
    playback: LegacyUnifiedPanelProps['playback'];
    queue: LegacyUnifiedPanelProps['queue'];
    library: LegacyUnifiedPanelProps['library'];
    account: LegacyUnifiedPanelProps['account'];
};

export type PlayerPanelViewModel = PlayerPanelViewModelInput & {
    legacyProps: LegacyUnifiedPanelProps;
};

export const usePlayerPanelViewModel = (input: PlayerPanelViewModelInput): PlayerPanelViewModel => {
    return useMemo(() => ({
        ...input,
        legacyProps: input,
    }), [input]);
};
