import React from 'react';
import LegacyUnifiedPanel from '../UnifiedPanel';
import type { PlayerPanelViewModel } from './player-panel/buildPlayerPanelModel';

// App-level entry for the player side panel backed by a view model.
type PlayerPanelProps = {
    model: PlayerPanelViewModel;
};

const PlayerPanel: React.FC<PlayerPanelProps> = ({ model }) => {
    return <LegacyUnifiedPanel {...model.legacyProps} />;
};

export default PlayerPanel;
