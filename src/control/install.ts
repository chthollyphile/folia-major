import { CONTROL_API_VERSION, CONTROL_TOOLS } from '../../shared/controlCatalog.mjs';
import { createControlEventRing, subscribeControlStoreEvents } from './events';
import { ControlError, toControlErrorEnvelope, validateToolArgs } from './errors';
import { getControlHandler, CONTROL_BRIDGE_HANDLERS } from './registry';
import { buildStateSnapshot, buildToolsList } from './state';
import type { ControlHostDeps } from './controlHostDeps';
import type {
    ControlAppInfo,
    ControlBridge,
    ControlBridgeInfo,
    ControlEventStore,
    ControlStateQuery,
    ControlToolSchema,
} from './types';

// src/control/install.ts
// createControlBridge() is the React-free core (unit-testable with mock deps);
// installControlBridge() additionally subscribes the stores and puts the object on window.
// PROTOCOL §2 is the contract: version 1, unified envelope, invoke never throws.

type CatalogTool = {
    name: string;
    executor: 'bridge' | 'main';
    readOnly?: boolean;
    inputSchema: ControlToolSchema;
};

const CATALOG_TOOLS = CONTROL_TOOLS as unknown as readonly CatalogTool[];

const findTool = (name: string): CatalogTool | null => (
    CATALOG_TOOLS.find(tool => tool.name === name) ?? null
);

const validateForTool = (name: string, args: unknown): Record<string, unknown> => {
    const tool = findTool(name);
    if (!tool) {
        return (args ?? {}) as Record<string, unknown>;
    }
    return validateToolArgs(tool.inputSchema, args);
};

/** The app facts the bridge exposes. `installedAt` is when the bridge object was created. */
export const readControlAppInfo = (installedAt = Date.now()): ControlAppInfo => {
    const hasWindow = typeof window !== 'undefined';
    const electronPlatform = hasWindow ? window.electron?.platform : undefined;
    const webPlatform = typeof navigator !== 'undefined' ? navigator.platform : '';
    return {
        name: 'Folia',
        version: typeof __APP_VERSION__ === 'undefined' ? '0.0.0' : __APP_VERSION__,
        platform: electronPlatform || webPlatform || 'node',
        isElectron: hasWindow && Boolean(window.electron),
        installedAt,
    };
};

export type CreateControlBridgeOptions = {
    /** App.tsx's latest control props; called fresh for every invocation. */
    getHostDeps: () => ControlHostDeps;
    app?: ControlAppInfo;
    events?: ControlEventStore;
    now?: () => number;
};

/** The bridge object without touching window or subscribing stores: the testable core. */
export const createControlBridge = ({
    getHostDeps,
    app = readControlAppInfo(),
    events = createControlEventRing(),
    now = () => Date.now(),
}: CreateControlBridgeOptions): ControlBridge => {
    const handlerDeps = () => ({ ...getHostDeps(), app, events });

    const bridge: ControlBridge = {
        version: CONTROL_API_VERSION as 1,
        app,
        ready: true,

        list: () => buildToolsList(),

        state: (args?: ControlStateQuery) => {
            const validated = validateForTool('folia_state', args);
            return buildStateSnapshot({
                ...(validated.includeQueue !== undefined ? { includeQueue: validated.includeQueue as boolean } : {}),
                ...(validated.includeLyrics !== undefined ? { includeLyrics: validated.includeLyrics as boolean } : {}),
                ...(validated.includeProviders !== undefined ? { includeProviders: validated.includeProviders as boolean } : {}),
            }, app);
        },

        invoke: async (name: string, args?: Record<string, unknown>) => {
            const startedAt = now();
            const toolName = typeof name === 'string' ? name : String(name);
            try {
                const tool = findTool(toolName);
                if (!tool) {
                    throw new ControlError('unknown_tool', `Unknown control tool "${toolName}"`);
                }
                const handler = getControlHandler(toolName);
                if (!handler) {
                    throw new ControlError(
                        'unavailable',
                        `Tool "${toolName}" is handled by the ${tool.executor} process, not the renderer bridge`,
                    );
                }
                const validated = validateToolArgs(tool.inputSchema, args);
                const data = await handler(validated, handlerDeps());
                const durationMs = now() - startedAt;
                if (tool.readOnly !== true) {
                    console.log(`[Control] ${toolName} ok in ${durationMs}ms`);
                }
                return { ok: true, tool: toolName, data, durationMs, ts: now() };
            } catch (error) {
                const durationMs = now() - startedAt;
                const envelope = toControlErrorEnvelope(error);
                if (envelope.code !== 'bad_request') {
                    console.warn(`[Control] ${toolName} failed (${envelope.code}):`, error);
                }
                return { ok: false, tool: toolName, error: envelope, durationMs, ts: now() };
            }
        },

        events: async (args) => {
            const validated = validateForTool('folia_events', args);
            return events.read({
                ...(validated.since !== undefined ? { since: validated.since as number } : {}),
                ...(validated.limit !== undefined ? { limit: validated.limit as number } : {}),
                ...(validated.waitMs !== undefined ? { waitMs: validated.waitMs as number } : {}),
            });
        },

        info: (): ControlBridgeInfo => ({
            installedAt: app.installedAt,
            toolCount: Object.keys(CONTROL_BRIDGE_HANDLERS).length,
            versions: { app: app.version, catalog: 1 },
        }),
    };

    return bridge;
};

export type InstallControlBridgeOptions = {
    getHostDeps: () => ControlHostDeps;
    app?: ControlAppInfo;
};

export type InstalledControlBridge = {
    bridge: ControlBridge;
    uninstall: () => void;
};

let activeInstall: InstalledControlBridge | null = null;

/**
 * Installs window.__FOLIA_CONTROL__ and starts recording store events. Always installed, even when
 * the Electron control server is off (PROTOCOL §2: the server's own switch is separate).
 */
export const installControlBridge = ({ getHostDeps, app }: InstallControlBridgeOptions): InstalledControlBridge => {
    activeInstall?.uninstall();

    const events = createControlEventRing();
    const bridge = createControlBridge({
        getHostDeps,
        events,
        ...(app !== undefined ? { app } : {}),
    });
    const unsubscribeEvents = subscribeControlStoreEvents(events);

    if (typeof window !== 'undefined') {
        window.__FOLIA_CONTROL__ = bridge;
    }
    console.log(`[Control] bridge installed tools=${Object.keys(CONTROL_BRIDGE_HANDLERS).length} version=1`);

    const uninstall = () => {
        unsubscribeEvents();
        if (typeof window !== 'undefined' && window.__FOLIA_CONTROL__ === bridge) {
            delete window.__FOLIA_CONTROL__;
        }
        if (activeInstall?.bridge === bridge) {
            activeInstall = null;
        }
    };
    activeInstall = { bridge, uninstall };
    return { bridge, uninstall };
};
