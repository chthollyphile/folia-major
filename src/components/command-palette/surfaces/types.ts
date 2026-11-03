import type React from 'react';
import type { Theme } from '../../../types';
import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteMatch } from '../types';

// src/components/command-palette/surfaces/types.ts
// Declarative contract for commands that take over the palette body instead of showing the
// default match list. Everything the old id-based branches in CommandPalette.tsx and
// useCommandPalette.ts did is expressed here, so a new rich command is one module.

/** Everything a surface needs to reason about input and execution. */
export type CommandSurfaceArgs = {
    context: CommandPaletteContext;
    query: string;
    /** Writes query and matchQuery together, skipping the debounce. */
    setQuery: (next: string) => void;
    matches: CommandPaletteMatch[];
    activeIndex: number;
    setActiveIndex: (index: number) => void;
    isExecuting: boolean;
    executeMatch: (index: number) => Promise<boolean>;
    /** Runs one command through the normal pipeline, or enters it when it takes input. */
    executeCommand: (command: CommandPaletteCommand) => Promise<boolean>;
    close: () => void;
};

/** Adds the palette's presentation state, which only the rendering path can supply. */
export type CommandSurfaceRenderArgs = CommandSurfaceArgs & {
    isDaylight: boolean;
    theme: Theme;
};

/** Args available before matches exist, used by surfaces that produce their own list. */
export type CommandSurfaceMatchArgs = {
    context: CommandPaletteContext;
    query: string;
};

export type CommandPaletteSurface = {
    /**
     * How the palette dresses itself for this command. `overlay` is the full-screen panel;
     * `inline` drops the backdrop, the match list and the pinned row and renders just the input,
     * portalled into the place the command's own surface points at. Used where the palette stands
     * in for a control that already had a home on screen.
     */
    presentation?: 'overlay' | 'inline';
    /**
     * How the overlay treats what is behind it. `blur` is the default frosted scrim.
     *
     * `clear` drops the blur and thins the scrim, for a surface whose controls change what is
     * drawn behind the palette: with the default backdrop the poster wall or the card grid being
     * tuned is the very thing the palette hides, so every slider is dragged blind. The panel turns
     * near-opaque in exchange, because it no longer has a blurred plate to sit legibly on.
     */
    backdrop?: 'blur' | 'clear';
    /**
     * Opens the palette in its top overlay even while the player bar is on screen, instead of growing
     * it out of the bar. For a surface that edits what sits just above the bar — the bottom subtitle —
     * which the bar-grown panel would cover exactly where the change is meant to be seen.
     *
     * Only read when the palette opens straight into this surface (a button or shortcut that names
     * the command). A palette already grown out of the bar keeps that shell when the surface is picked
     * from its list: switching shells midway remounts the input and cannot animate either shell out.
     */
    keepsClearOfPlayerBar?: boolean;
    /**
     * Lazily imported so the registry stays a pure-TS module: pulling react-window,
     * react-i18next or the eager visualizer glob into the module graph would break the
     * node-environment registry tests.
     *
     * Optional, because an `inline` surface has no body — its input row is the whole UI.
     */
    load?: () => Promise<{ default: React.ComponentType<any> }>;
    mapProps?: (args: CommandSurfaceRenderArgs) => Record<string, unknown>;
    /** Input element overrides, e.g. the volume command's numeric input. */
    inputProps?: (args: CommandSurfaceRenderArgs) => React.InputHTMLAttributes<HTMLInputElement>;
    /** Replaces the default match list source, e.g. the queue command's songs. */
    buildMatches?: (args: CommandSurfaceMatchArgs) => CommandPaletteMatch[];
    /** Enter handling; return null to fall through to the default executeMatch. */
    onSubmit?: (args: CommandSurfaceArgs) => Promise<boolean> | boolean | null;
    /** Runs whenever the query changes; return true when it already executed and closed. */
    onQueryChange?: (args: CommandSurfaceArgs) => Promise<boolean> | boolean | null;
    /** Staged escape: return true to keep the palette open. */
    onEscape?: (args: CommandSurfaceArgs) => boolean;
    /** Extra key bindings; return true when the event is consumed. */
    onKeyDown?: (event: KeyboardEvent, args: CommandSurfaceArgs) => boolean;
    /** Read the live query instead of the 120ms debounced matchQuery. */
    useLiveQuery?: boolean;
};
