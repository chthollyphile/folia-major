import React, { useMemo, useRef } from 'react';
import ObsWebSourceApp from './ObsWebSourceApp';
import { usePlayerCapSource } from '../../hooks/usePlayerCapSource';
import { playerCapToWebLyricSource } from '../../utils/playerCapWebSource';
import { buildObsAppearanceFromShortcode, parseObsWebParams } from '../../utils/obsWebAppearance';
import type { PlayerCapTimeBasis } from '../../utils/playerCapMapping';

// src/components/obs/ObsPlayerCapSourceApp.tsx
// Bootstrap entry: wires the PlayerCap source into the source-neutral ObsWebSourceApp shell.
// Appearance is driven by URL params (including cfg); the PlayerCap connection params (host is
// shared with parseObsWebParams, plus nxpcPlayer/nxpcBasis/nxpcSticky here) come from the URL too, since the
// OBS browser context cannot read the main app's localStorage.

const DEFAULT_PLAYERCAP_HOST = 'localhost:8765';

interface ObsPlayerCapExtras {
    player: string;
    timeBasis: PlayerCapTimeBasis;
    sticky: boolean;
}

// PlayerCap-specific params beyond the shared appearance ones parsed by parseObsWebParams.
const parsePlayerCapExtras = (search: string): ObsPlayerCapExtras => {
    const params = new URLSearchParams(search);
    return {
        player: params.get('nxpcPlayer')?.trim() || '',
        timeBasis: params.get('nxpcBasis') === 'timestamp' ? 'timestamp' : 'play_time',
        // Lyrics sticky defaults on (matches the main window); only nxpcSticky=0 disables.
        sticky: params.get('nxpcSticky') !== '0',
    };
};

const ObsPlayerCapSourceApp: React.FC = () => {
    const paramsRef = useRef(parseObsWebParams(window.location.search));
    const extrasRef = useRef(parsePlayerCapExtras(window.location.search));
    const { host, cfg, isDaylight, transparent, visualizer } = paramsRef.current;
    const { player, timeBasis, sticky } = extrasRef.current;

    const pc = usePlayerCapSource({ enabled: true, host: host || DEFAULT_PLAYERCAP_HOST, player, timeBasis, sticky });
    const source = playerCapToWebLyricSource(pc);
    const appearance = useMemo(
        () => buildObsAppearanceFromShortcode(cfg, { isDaylight, transparent, visualizerOverride: visualizer }),
        [cfg, isDaylight, transparent, visualizer],
    );

    return <ObsWebSourceApp source={source} appearance={appearance} />;
};

export default ObsPlayerCapSourceApp;
