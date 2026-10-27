import { CONTROL_TOOLS } from '../../shared/controlCatalog.mjs';
import { eventHandlers } from './handlers/events';
import { libraryHandlers } from './handlers/library';
import { lyricHandlers } from './handlers/lyrics';
import { navigationHandlers } from './handlers/navigation';
import { paletteHandlers } from './handlers/palette';
import { playbackHandlers } from './handlers/playback';
import { queueHandlers } from './handlers/queue';
import { searchHandlers } from './handlers/search';
import { settingsHandlers } from './handlers/settings';
import { systemHandlers } from './handlers/system';
import { visualizerHandlers } from './handlers/visualizer';
import { windowHandlers } from './handlers/window';
import type { ControlHandler } from './types';

// src/control/registry.ts
// The one place tool names meet handlers. shared/controlCatalog.mjs is the source of truth: every
// executor='bridge' tool needs exactly one handler here, and the names must match verbatim.

type CatalogTool = { name: string; executor: 'bridge' | 'main' };

const CATALOG_TOOLS = CONTROL_TOOLS as unknown as readonly CatalogTool[];

const BRIDGE_TOOL_NAMES = CATALOG_TOOLS
    .filter(tool => tool.executor === 'bridge')
    .map(tool => tool.name);

export const CONTROL_BRIDGE_HANDLERS: Readonly<Record<string, ControlHandler>> = Object.freeze({
    ...systemHandlers,
    ...paletteHandlers,
    ...searchHandlers,
    ...playbackHandlers,
    ...queueHandlers,
    ...lyricHandlers,
    ...visualizerHandlers,
    ...settingsHandlers,
    ...navigationHandlers,
    ...libraryHandlers,
    ...windowHandlers,
    ...eventHandlers,
});

export const CONTROL_BRIDGE_TOOL_NAMES: readonly string[] = BRIDGE_TOOL_NAMES;

const registeredNames = Object.keys(CONTROL_BRIDGE_HANDLERS);
const missingHandlers = BRIDGE_TOOL_NAMES.filter(name => !(name in CONTROL_BRIDGE_HANDLERS));
const extraHandlers = registeredNames.filter(name => !BRIDGE_TOOL_NAMES.includes(name));

// The catalog consistency test asserts this union; the warning inside the running app is only a
// breadcrumb, because a catalog change must never take the whole renderer down at startup.
if (missingHandlers.length > 0 || extraHandlers.length > 0) {
    console.error('[Control] bridge handler/catalog mismatch', {
        missingHandlers,
        extraHandlers,
    });
}

export const getControlHandler = (name: string): ControlHandler | null => (
    CONTROL_BRIDGE_HANDLERS[name] ?? null
);
