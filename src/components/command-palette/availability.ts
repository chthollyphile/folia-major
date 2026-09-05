import type { CommandPaletteContext, CommandScope } from './types';

// src/components/command-palette/availability.ts
// Declarative platform and scope gating for command palette entries, replacing the id switchboard
// that used to live inside getAvailableCommandPaletteCommands.

// 'electron' matches any desktop build; the OS names imply desktop; 'web' means a browser
// without the Electron bridge.
export type CommandPlatform = 'web' | 'electron' | 'win' | 'mac' | 'linux';

const OS_BY_NODE_PLATFORM: Record<string, Extract<CommandPlatform, 'win' | 'mac' | 'linux'>> = {
    win32: 'win',
    darwin: 'mac',
    linux: 'linux',
};

type RuntimePlatform = {
    isElectron: boolean;
    os: CommandPlatform | null;
};

// Resolved per call, never cached: tests stub window.electron between assertions, and the
// bridge is not guaranteed to exist at module-evaluation time.
const detectRuntimePlatform = (): RuntimePlatform | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const electron = (window as any).electron;
    if (!electron) {
        return { isElectron: false, os: 'web' };
    }

    return { isElectron: true, os: OS_BY_NODE_PLATFORM[String(electron.platform)] ?? null };
};

export const matchesCommandPlatform = (platform?: CommandPlatform[]): boolean => {
    if (!platform || platform.length === 0) {
        return true;
    }

    const runtime = detectRuntimePlatform();
    if (!runtime) {
        // Node / SSR cannot tell the platforms apart; keep every command rather than
        // silently hiding half the registry from unit tests.
        return true;
    }

    return platform.some(candidate => {
        if (candidate === 'web') {
            return !runtime.isElectron;
        }
        if (candidate === 'electron') {
            return runtime.isElectron;
        }
        return runtime.isElectron && runtime.os === candidate;
    });
};

/**
 * Whether the palette's surroundings are what a command declared it needs: the unified panel only
 * exists on the player, and a filter only exists where something registered one. They grey out
 * elsewhere rather than executing into nothing.
 *
 * An absent context means "nobody is asking about a live app" (the registry contract test, the
 * pinned-command picker), and every one of those callers wants the full list — same convention as
 * the rest of the registry's gating.
 */
export const matchesCommandScope = (scope: CommandScope | undefined, context?: CommandPaletteContext): boolean => {
    if (!scope || !context) {
        return true;
    }

    if (scope === 'lattice') return context.scope.view === 'lattice';
    return scope === 'player-surface'
        ? context.scope.view === 'player'
        : context.scope.filter !== null;
};
