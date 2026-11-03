import React from 'react';
import type { SettingsOptionDef } from '../../kit';
import HifiEngineGroup from './HifiEngineGroup';
import HifiOutputGroup from './HifiOutputGroup';
import { O } from './options';

// src/components/modal/settings/pages/hifi/HifiSettings.tsx
// The playback engine settings the 播放控制 page draws first in the desktop app: the engine choice
// (Web Audio or mpv) for local and Navidrome songs, then, with mpv chosen, mpv's output.

/** What the settings search can find among them; PlaybackPage adds these to its own. */
export const HIFI_OPTIONS: SettingsOptionDef[] = Object.values(O);

const HifiSettings: React.FC = () => (
    <>
        <HifiEngineGroup />
        <HifiOutputGroup />
    </>
);

export default HifiSettings;
