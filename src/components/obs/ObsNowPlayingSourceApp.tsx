import React, { useMemo, useRef } from 'react';
import ObsWebSourceApp from './ObsWebSourceApp';
import { useNowPlayingSource } from '../../hooks/useNowPlayingSource';
import { buildObsAppearanceFromShortcode, parseObsAiParams, parseObsWebParams } from '../../utils/obsWebAppearance';

// src/components/obs/ObsNowPlayingSourceApp.tsx
// Bootstrap entry: wires the NowPlaying source into the source-neutral ObsWebSourceApp
// shell. Appearance is driven by URL params (including cfg).

const DEFAULT_NOW_PLAYING_HOST = 'localhost:9863';

const ObsNowPlayingSourceApp: React.FC = () => {
    const paramsRef = useRef(parseObsWebParams(window.location.search));
    const obsAiConfigRef = useRef(parseObsAiParams(window.location.search));
    const { host, cfg, isDaylight, transparent, visualizer, themeMode, language } = paramsRef.current;

    const source = useNowPlayingSource({ enabled: true, host: host || DEFAULT_NOW_PLAYING_HOST });
    const appearance = useMemo(
        () => buildObsAppearanceFromShortcode(cfg, { isDaylight, transparent, visualizerOverride: visualizer, themeMode }),
        [cfg, isDaylight, transparent, visualizer, themeMode],
    );

    return <ObsWebSourceApp source={source} appearance={appearance} language={language} obsAiConfig={obsAiConfigRef.current} />;
};

export default ObsNowPlayingSourceApp;
