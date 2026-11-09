import React from 'react';
import SceneGroups, { SCENE_GROUP_OPTIONS } from '../../../scenes/settings/SceneGroups';
import SoundTracingGroup, { SOUND_TRACING_OPTIONS } from '../../../scenes/settings/SoundTracingGroup';
import type { SettingsOptionDef } from '../kit';

// src/components/modal/settings/pages/ScenePage.tsx
// The 场景 page: which scene the player page is, the chosen scene's settings, and sound tracing.
// The rows live with the scenes (src/components/scenes/settings/).

export const OPTIONS: SettingsOptionDef[] = [...SCENE_GROUP_OPTIONS, ...SOUND_TRACING_OPTIONS];

const ScenePage: React.FC = () => (
    <>
        <SceneGroups />
        <SoundTracingGroup />
    </>
);

export default ScenePage;
