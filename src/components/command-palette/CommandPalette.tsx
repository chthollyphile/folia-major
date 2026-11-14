import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CircleHelp, Command, CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import type { CommandPaletteContext, CommandPaletteMatch, CommandPaletteCommand } from './types';
import type { CommandPaletteSurface, CommandSurfaceRenderArgs } from './surfaces/types';
import CommandPaletteSyntaxHints from './CommandPaletteSyntaxHints';
import CommandPaletteInlineFrame from './CommandPaletteInlineFrame';
import { parseCommandQuery } from './syntax/parse';
import { buildFlagSuggestions, type SyntaxSuggestion } from './syntax/suggest';
import { getCommandDescription, getCommandTitle } from './commandText';
import { getCommandPrimaryTerm } from './search/commandSearchIndex';
import { isTextEntryTarget } from './useCommandPalette';
import PinnedCommandRow from './PinnedCommandRow';
import CommandPaletteAllCommandsList from './CommandPaletteAllCommandsList';
import { setIsCommandFilterOpen } from '../../stores/useAppViewStore';
import { isGridFilterSyntaxAvailable, resolveGridFilterAction } from './gridFilterQuery';
import { FILTER_VIEW_COMMAND_ID } from './commands/filterViewCommand';
import { CAPSULE_HANDBACK_DELAY_MS, capsuleBodyHeight, listArrowStep, readCapsuleFrame, type CapsuleFrame } from './capsuleFrame';
import CommandPaletteCapsuleFrame from './CommandPaletteCapsuleFrame';
import { useCapsulePaletteStore } from '../../stores/useCapsulePaletteStore';

// src/components/command-palette/CommandPalette.tsx
// Full-screen command input overlay with autocomplete and keyboard execution.

type CommandPaletteProps = {
    activeIndex: number;
    activePreview: string | null;
    activeCommand: CommandPaletteCommand | null;
    availableCommands: CommandPaletteCommand[];
    context: CommandPaletteContext;
    isDaylight: boolean;
    isComposing: boolean;
    isExecuting: boolean;
    isOpen: boolean;
    matches: CommandPaletteMatch[];
    pinnedCommands: Array<CommandPaletteCommand | null>;
    query: string;
    theme: Theme;
    onActiveCommandChange: (command: CommandPaletteCommand | null) => void;
    onActiveIndexChange: (index: number) => void;
    onClose: () => void;
    onCompositionEnd: (query: string) => void;
    onCompositionStart: () => void;
    onExecuteActive: () => Promise<boolean>;
    onExecuteMatch: (index: number) => Promise<boolean>;
    onExecutePinnedCommand: (command: CommandPaletteCommand) => Promise<boolean>;
    onQueryChange: (query: string) => void;
    /** Writes query and matchQuery together, bypassing the debounce. */
    onQueryCommit: (query: string) => void;
};

// React.lazy identities must be stable across renders, so each surface descriptor keeps one.
const surfaceComponentCache = new WeakMap<CommandPaletteSurface, React.ComponentType<any>>();

/**
 * A touch screen, where the overlay and the capsule open with the query input unfocused: focusing it
 * would raise the on-screen keyboard, and iOS Safari will not scroll the list while it is focused.
 */
const isTouchInput = () => 'ontouchstart' in window;

const resolveSurfaceComponent = (surface: CommandPaletteSurface) => {
    if (!surface.load) {
        return null;
    }

    const cached = surfaceComponentCache.get(surface);
    if (cached) {
        return cached;
    }

    const component = React.lazy(surface.load);
    surfaceComponentCache.set(surface, component);
    return component;
};

const groupLabelKey: Record<string, string> = {
    search: 'commandPalette.groupSearch',
    settings: 'commandPalette.groupSettings',
    navigation: 'commandPalette.groupNavigation',
    panel: 'commandPalette.groupPanel',
    playback: 'commandPalette.groupPlayback',
    visualizer: 'commandPalette.groupVisualizer',
    grid: 'commandPalette.groupGrid',
};

const IDLE_PLACEHOLDER_COUNT = 5;
const IDLE_PLACEHOLDER_INTERVAL_MS = 2800;

const pickNextPlaceholderIndex = (currentIndex: number) => {
    const offset = 1 + Math.floor(Math.random() * (IDLE_PLACEHOLDER_COUNT - 1));
    return (currentIndex + offset) % IDLE_PLACEHOLDER_COUNT;
};

const CommandPalette: React.FC<CommandPaletteProps> = ({
    activeIndex,
    activePreview,
    activeCommand,
    availableCommands,
    context,
    isDaylight,
    isComposing,
    isExecuting,
    isOpen,
    matches,
    pinnedCommands,
    query,
    theme,
    onActiveCommandChange,
    onActiveIndexChange,
    onClose,
    onCompositionEnd,
    onCompositionStart,
    onExecuteActive,
    onExecuteMatch,
    onExecutePinnedCommand,
    onQueryChange,
    onQueryCommit,
}) => {
    const { t, i18n } = useTranslation();
    const inputRef = useRef<HTMLInputElement | null>(null);
    // Puts the focus back into the query input a frame later: a click has put it on what was
    // clicked. While a command runs the input is disabled and cannot take the focus, so a request
    // that finds it disabled is kept, and done in the commit that enables the input again.
    const focusAskedRef = useRef(false);
    const refocusInput = useCallback(() => {
        focusAskedRef.current = true;
        window.requestAnimationFrame(() => {
            const input = inputRef.current;
            if (focusAskedRef.current && !input?.disabled) {
                focusAskedRef.current = false;
                input?.focus();
            }
        });
    }, []);
    useLayoutEffect(() => {
        if (!isExecuting && focusAskedRef.current) {
            focusAskedRef.current = false;
            inputRef.current?.focus();
        }
    }, [isExecuting]);
    const [idlePlaceholderIndex, setIdlePlaceholderIndex] = useState(() => Math.floor(Math.random() * IDLE_PLACEHOLDER_COUNT));
    const [isShowingAllCommands, setIsShowingAllCommands] = useState(false);
    const surface = activeCommand?.surface ?? null;
    const surfaceArgs = useMemo<CommandSurfaceRenderArgs>(() => ({
        context,
        query,
        setQuery: onQueryCommit,
        matches,
        activeIndex,
        setActiveIndex: onActiveIndexChange,
        isExecuting,
        isDaylight,
        theme,
        executeMatch: onExecuteMatch,
        executeCommand: onExecutePinnedCommand,
        close: onClose,
    }), [activeIndex, context, isDaylight, isExecuting, matches, onActiveIndexChange, onClose, onExecuteMatch, onExecutePinnedCommand, onQueryCommit, query, theme]);
    const surfaceBody = surface ? resolveSurfaceComponent(surface) : null;

    // Generic `--` completions for any command that declares flags. Built from the live query, not
    // the debounced one: a completion list that lags the caret by 120ms feels broken.
    const syntaxSuggestions = useMemo<SyntaxSuggestion[]>(() => {
        if (!activeCommand?.syntax) {
            return [];
        }
        // The filter's flags run the track grid's own buttons; the other filtering surfaces have
        // none. Withheld here rather than in the strip, so the keyboard does not silently complete
        // a flag that is not on screen.
        if (activeCommand.id === FILTER_VIEW_COMMAND_ID && !isGridFilterSyntaxAvailable(context)) {
            return [];
        }
        return buildFlagSuggestions(activeCommand.syntax, parseCommandQuery(activeCommand.syntax, query));
    }, [activeCommand, context, query]);
    const [syntaxIndex, setSyntaxIndex] = useState(0);
    // The list changes as the draft is typed, so the highlight has to come back into range.
    useEffect(() => {
        setSyntaxIndex(index => (index < syntaxSuggestions.length ? index : 0));
    }, [syntaxSuggestions]);

    // Arrow keys only move activeIndex; the body is a fixed-height scroller, so the highlighted
    // row has to be pulled back into view or it walks off the bottom edge.
    const activeMatchRowRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        activeMatchRowRef.current?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    // What `--play` / `--add` would do, for the inline box that has no preview row to say so.
    // Null whenever no flag is typed, which is also every command that is not the filter.
    const inlineAction = useMemo(() => (
        surface?.presentation === 'inline' ? resolveGridFilterAction(query, context) : null
    ), [context, query, surface]);

    const acceptSyntaxSuggestion = useCallback((suggestion: SyntaxSuggestion) => {
        onQueryCommit(suggestion.replacement);
        refocusInput();
    }, [onQueryCommit, refocusInput]);
    // An inline surface draws itself where the control it replaces used to sit, so it needs a host
    // element from the surface that registered. Without one there is nowhere to put it, and the
    // overlay is the honest fallback rather than a box floating at a guessed offset.
    const liveFilterAnchor = surface?.presentation === 'inline'
        ? context.scope.filter?.getAnchor() ?? null
        : null;
    // Closing drops isOpen and the active command in one commit, so reading the live anchor alone
    // would swap branches mid-close and the box would vanish instead of animating out. Remember the
    // host until the palette has finished leaving it.
    const lastFilterAnchorRef = useRef<HTMLElement | null>(null);
    if (liveFilterAnchor) {
        lastFilterAnchorRef.current = liveFilterAnchor;
    } else if (isOpen) {
        // A session with no filter box forgets the last one, or the next close of the overlay or
        // of the bar-grown palette would take the inline branch and vanish without its exit.
        lastFilterAnchorRef.current = null;
    }
    const filterAnchor = isOpen ? liveFilterAnchor : lastFilterAnchorRef.current;
    const isInlineFrame = Boolean(filterAnchor);
    // Opened while the player bar is on screen, the palette grows out of it instead of dropping in
    // from the top: the bar is measured once, on the render that opens the palette, and kept for the
    // whole session and its exit, so a bar that moves underneath does not drag the panel along.
    const wasOpenRef = useRef(false);
    const capsuleFrameRef = useRef<CapsuleFrame | null>(null);
    // Closing measures the bar again, on the render that closes: the panel folds back into the bar
    // as it is now. The bar keeps living, unseen, under the palette — it usually collapses once the
    // pointer is no longer on it — so the shape remembered from the open is the wrong one to land in.
    const capsuleExitFrameRef = useRef<CapsuleFrame | null>(null);
    if (isOpen && !wasOpenRef.current) {
        // A palette opened straight into a surface that edits what sits above the bar (the bottom
        // subtitle) stays in the top overlay. Decided here, once: a session that switched shells midway
        // would remount the input (losing focus) and could not animate out of the shell it left.
        capsuleFrameRef.current = liveFilterAnchor || surface?.keepsClearOfPlayerBar
            ? null
            : readCapsuleFrame(useCapsulePaletteStore.getState().anchor);
        capsuleExitFrameRef.current = null;
    } else if (!isOpen && wasOpenRef.current && capsuleFrameRef.current) {
        capsuleExitFrameRef.current = readCapsuleFrame(useCapsulePaletteStore.getState().anchor) ?? capsuleFrameRef.current;
    }
    wasOpenRef.current = isOpen;
    // A session that has turned into an inline filter box never falls back to the bar's shell: if the
    // grid hosting the box goes away first, the frame measured at the open would flash at a place the
    // screen has already left. The overlay branch is the invisible fallback there, as before.
    const capsuleFrame = filterAnchor || surface?.presentation === 'inline' ? null : capsuleFrameRef.current;
    const isCapsuleFrame = capsuleFrame !== null;
    // Only the plain match list turns upside down; a surface lays itself out and the all-commands
    // list reads top to bottom.
    const isReversedList = isCapsuleFrame && !surface && !isShowingAllCommands && matches.length > 0;
    // The bar hides the moment the panel takes its place, and comes back only near the end of the
    // fold, so the two cross over in one spot instead of both being on screen while one shrinks.
    useEffect(() => {
        const store = useCapsulePaletteStore.getState();
        if (isOpen && isCapsuleFrame) {
            store.setIsMorphed(true);
            return;
        }
        if (!store.isMorphed) {
            return;
        }
        if (isOpen) {
            store.setIsMorphed(false);
            return;
        }
        const timer = window.setTimeout(() => useCapsulePaletteStore.getState().setIsMorphed(false), CAPSULE_HANDBACK_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [isCapsuleFrame, isOpen]);
    useEffect(() => () => useCapsulePaletteStore.getState().setIsMorphed(false), []);
    // One input, two frames. The overlay's row and the inline pill differ only in dress: the
    // composition handling, the surface's own inputProps and the executing lock have to be
    // identical, so they are written once.
    const renderQueryInput = (className: string) => (
        <input
            ref={inputRef}
            type="text"
            {...(surface?.inputProps?.(surfaceArgs) ?? {})}
            value={query}
            onChange={(event) => {
                setIsShowingAllCommands(false);
                onQueryChange(event.target.value);
            }}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={(event) => onCompositionEnd(event.currentTarget.value)}
            placeholder={
                activeCommand
                    ? (activeCommand.placeholder?.(context) || getCommandDescription(activeCommand, t))
                    : t(`commandPalette.idlePlaceholders.${idlePlaceholderIndex}`, 'Type anything — there are plenty of commands to try')
            }
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            name="folia-command-palette-query"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={matches.length > 0}
            disabled={isExecuting}
            className={className}
            style={{ color: 'var(--text-primary)' }}
        />
    );

    /**
     * The short mono hint shown on a row, and the text a click on the all-commands list types
     * back into the box.
     *
     * This used to be `command.keywords[0]`, which only worked while every command carried a
     * hand-written English alias first in its array. Keywords are synonyms now — some commands
     * have none, and the first one is not guaranteed to be Latin — so the search index resolves
     * a primary term instead (first ASCII trigger, else the English title's first word, else id).
     */
    const primaryTermOf = useMemo(() => (
        (command: CommandPaletteCommand) => getCommandPrimaryTerm(availableCommands, command, i18n.language)
    ), [availableCommands, i18n.language]);
    // A row a surface built for this one moment (a past search under the search command) is no
    // registered command: there is nothing to type to reach it, so its row shows no term chip.
    const registeredCommandIds = useMemo(() => new Set(availableCommands.map(command => command.id)), [availableCommands]);

    // A live-preview surface asks for an unblurred backdrop so its own effect stays visible behind
    // the palette; the panel then has to carry its own legibility, hence the denser fill.
    const hasClearBackdrop = surface?.backdrop === 'clear';
    const panelBg = hasClearBackdrop
        ? (isDaylight ? 'bg-white/95 text-zinc-950' : 'bg-zinc-950/95 text-white')
        : (isDaylight ? 'bg-white/70 text-zinc-950' : 'bg-zinc-950/70 text-white');
    const panelBorderColor = isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.12)';
    const itemActiveBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const itemIdleBg = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5';

    useEffect(() => {
        if (!isOpen) {
            setIsShowingAllCommands(false);
            return;
        }
        // On a touch screen the overlay and the capsule stay unfocused (isTouchInput): taking the focus
        // here only to drop it when the entrance ends (blurInputOnTouch) made the keyboard flash up and
        // away. The inline filter box is opened to type into, so it still takes the focus.
        if (!isInlineFrame && isTouchInput()) {
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });

        return () => window.cancelAnimationFrame(frame);
        // Switching between the two frames remounts the input, so the focus has to be taken again:
        // picking `filter-view` out of the overlay's list leaves the caret nowhere otherwise. Every
        // other surface keeps the overlay's own input, so this is the one crossing that needs it.
    }, [isOpen, isInlineFrame]);

    // The grid that handed over its keyboard still has to know the box is up — it used to read its
    // own `showSearchPanel` to keep Enter from opening a card while the listener was typing.
    const isFilterOpen = isOpen && Boolean(liveFilterAnchor);
    useEffect(() => {
        setIsCommandFilterOpen(isFilterOpen);
        return () => setIsCommandFilterOpen(false);
    }, [isFilterOpen]);

    useEffect(() => {
        if (!isOpen || query !== '' || activeCommand) {
            return;
        }

        setIdlePlaceholderIndex(Math.floor(Math.random() * IDLE_PLACEHOLDER_COUNT));
        const interval = window.setInterval(() => {
            setIdlePlaceholderIndex(currentIndex => pickNextPlaceholderIndex(currentIndex));
        }, IDLE_PLACEHOLDER_INTERVAL_MS);

        return () => window.clearInterval(interval);
    }, [activeCommand, isOpen, query]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (isShowingAllCommands) {
                    setIsShowingAllCommands(false);
                    return;
                }
                if (surface?.onEscape?.(surfaceArgs)) {
                    return;
                }
                onClose();
                return;
            }

            if (isShowingAllCommands) {
                return;
            }

            if (isExecuting) {
                return;
            }

            if (event.isComposing || isComposing) {
                return;
            }

            if (event.key === 'Backspace' && query === '' && activeCommand && !isTextEntryTarget(event.target)) {
                event.preventDefault();
                const firstKw = primaryTermOf(activeCommand);
                onActiveCommandChange(null);
                onQueryChange(firstKw);
                onActiveIndexChange(0);
                return;
            }

            // The `--` completion list owns the keyboard while it is up, ahead of the surface. It
            // only exists for a half-typed flag, which is a moment the surface has nothing to do
            // with, and Enter there has to complete the flag rather than run a spent command.
            if (syntaxSuggestions.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    setSyntaxIndex(index => (
                        (index + step + syntaxSuggestions.length) % syntaxSuggestions.length
                    ));
                    return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    acceptSyntaxSuggestion(syntaxSuggestions[syntaxIndex] ?? syntaxSuggestions[0]);
                    return;
                }
            }

            // Surfaces get first refusal on keys: a grid needs different arrow semantics than
            // the default one-per-step list, and only the surface knows its own layout.
            if (surface?.onKeyDown?.(event, surfaceArgs)) {
                event.preventDefault();
                return;
            }

            // Grown out of the player bar the list stands upside down, best match against the input
            // at the bottom, so the up arrow walks away from it.
            const arrowStep = listArrowStep(event.key, isReversedList);
            if (arrowStep !== 0) {
                event.preventDefault();
                onActiveIndexChange(Math.min(matches.length - 1, Math.max(0, activeIndex + arrowStep)));
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                void onExecuteActive();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [acceptSyntaxSuggestion, activeIndex, activeCommand, isComposing, isExecuting, isOpen, isReversedList, isShowingAllCommands, matches.length, onActiveCommandChange, onActiveIndexChange, onClose, onExecuteActive, onQueryChange, query, surface, surfaceArgs, syntaxIndex, syntaxSuggestions]);

    if (filterAnchor) {
        return (
            <CommandPaletteInlineFrame
                anchor={filterAnchor}
                isOpen={isOpen}
                query={query}
                renderInput={renderQueryInput}
                onQueryCommit={onQueryCommit}
                onClose={onClose}
                focusInput={() => inputRef.current?.focus()}
                suggestions={syntaxSuggestions}
                syntaxIndex={syntaxIndex}
                onAcceptSuggestion={acceptSyntaxSuggestion}
                onHoverSuggestion={setSyntaxIndex}
                pendingAction={inlineAction}
                isDaylight={isDaylight}
                theme={theme}
                t={t}
            />
        );
    }

    const headerRow = (
        <div className={`flex items-center gap-3 px-4 py-3 ${capsuleFrame ? 'border-t' : 'border-b'}`} style={{ borderColor: isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)' }}>
            {isExecuting ? (
                <Loader2 size={18} className="animate-spin opacity-60 text-zinc-400" />
            ) : (
                <Search size={18} className="opacity-45" />
            )}
            {activeCommand && (
                <div
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-all ${isDaylight
                        ? 'bg-zinc-100 border-zinc-200 text-zinc-800'
                        : 'bg-zinc-800/80 border-zinc-700 text-zinc-200'
                        }`}
                    style={{ borderColor: isDaylight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)' }}
                >
                    <span>{activeCommand.activeTitle?.(context) || getCommandTitle(activeCommand, t)}</span>
                    <button
                        type="button"
                        disabled={isExecuting}
                        onClick={() => {
                            onActiveCommandChange(null);
                            onQueryChange('');
                            onActiveIndexChange(0);
                        }}
                        className="hover:opacity-100 opacity-60 transition-opacity disabled:opacity-30 disabled:pointer-events-none"
                        aria-label={t('ui.clearActiveCommand')}
                    >
                        <X size={12} />
                    </button>
                </div>
            )}
            {renderQueryInput('min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:opacity-45 disabled:opacity-50')}
            <button
                type="button"
                onClick={() => setIsShowingAllCommands(current => !current)}
                className={`rounded-full p-2 transition-colors ${isShowingAllCommands ? itemActiveBg : (isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10')}`}
                aria-label={t('commandPalette.showAllCommands') || 'Show all commands'}
                title={t('commandPalette.showAllCommands') || 'Show all commands'}
            >
                <CircleHelp size={17} />
            </button>
            <button
                type="button"
                onClick={onClose}
                className={`rounded-full p-2 transition-colors ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                aria-label={t('commandPalette.close') || 'Close command palette'}
            >
                <X size={16} />
            </button>
        </div>
    );

    const bodyBox = (
        <>
            {/* Removed activePreview top panel, it is now shown inline in the list items description */}

            {/* The palette doubles as a canvas for UI-bearing commands, so this box is the
                one fixed dimension every surface renders into. It must stay CSS-resolved:
                no measurement, no content-driven height. commandPaletteSizing.spec.ts guards it. */}
            <div
                data-testid="command-palette-body"
                className={`overflow-y-auto p-2 ${capsuleFrame ? '' : 'h-[min(496px,50vh)]'} ${isReversedList ? 'flex flex-col-reverse' : ''}`}
                // 胶囊模式另加「胶囊上方放得下」这一条上限，仍由 CSS 解出；匹配列表倒着排，第一名贴着底部的输入框。
                style={capsuleFrame ? { height: capsuleBodyHeight(capsuleFrame) } : undefined}
                onTouchStart={() => inputRef.current?.blur()}
            >
                <CommandPaletteSyntaxHints
                    suggestions={syntaxSuggestions}
                    activeIndex={syntaxIndex}
                    onAccept={acceptSyntaxSuggestion}
                    onHover={setSyntaxIndex}
                    isDaylight={isDaylight}
                    theme={theme}
                    t={t}
                />
                {isShowingAllCommands ? (
                    <CommandPaletteAllCommandsList
                        commands={availableCommands}
                        groupLabelKey={groupLabelKey}
                        isDaylight={isDaylight}
                        itemIdleBg={itemIdleBg}
                        theme={theme}
                        t={t}
                        onBack={() => setIsShowingAllCommands(false)}
                        onPick={(command) => {
                            onQueryChange(primaryTermOf(command));
                            onActiveIndexChange(0);
                            setIsShowingAllCommands(false);
                            refocusInput();
                        }}
                    />
                ) : surfaceBody ? (
                    <Suspense fallback={<div className="flex h-full items-center justify-center opacity-40"><Loader2 size={20} className="animate-spin" /></div>}>
                        {React.createElement(surfaceBody, {
                            ...surface?.mapProps?.(surfaceArgs),
                            refocusInput,
                        })}
                    </Suspense>
                ) : matches.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center opacity-50">
                        <Command size={26} />
                        <div className="text-sm">{t('commandPalette.empty') || 'No matching command'}</div>
                    </div>
                ) : (
                    matches.map((match, index) => {
                        const isActive = index === activeIndex;
                        const groupLabel = t(groupLabelKey[match.command.group] || 'commandPalette.groupOther') || match.command.group;
                        const title = getCommandTitle(match.command, t);
                        const displayDescription = match.previewText || getCommandDescription(match.command, t);
                        const commandHint = registeredCommandIds.has(match.command.id) ? primaryTermOf(match.command) : null;
                        const Icon = match.command.icon ?? Command;
                        return (
                            <button
                                key={match.command.id}
                                ref={isActive ? activeMatchRowRef : undefined}
                                type="button"
                                disabled={isExecuting}
                                onMouseEnter={() => {
                                    if (!isExecuting) {
                                        onActiveIndexChange(index);
                                    }
                                }}
                                onClick={() => {
                                    if (!isExecuting) {
                                        onActiveIndexChange(index);
                                        void onExecuteMatch(index);
                                    }
                                }}
                                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${isActive ? itemActiveBg : itemIdleBg} disabled:opacity-50 disabled:pointer-events-none`}
                            >
                                <div
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
                                    style={{
                                        borderColor: isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.12)',
                                        color: theme.accentColor,
                                    }}
                                >
                                    <Icon size={16} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium">{title}</span>
                                        {commandHint && (
                                            <span
                                                className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] ${isDaylight ? 'bg-black/8 text-zinc-700' : 'bg-white/10 text-zinc-200'
                                                    }`}
                                            >
                                                {commandHint}
                                            </span>
                                        )}
                                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] opacity-50">
                                            {groupLabel}
                                        </span>
                                    </div>
                                    <div className="mt-0.5 truncate text-xs opacity-50">
                                        {displayDescription}
                                    </div>
                                </div>
                                {isActive && (
                                    <div className="hidden items-center gap-1 text-xs opacity-45 sm:flex">
                                        <CornerDownLeft size={13} />
                                        {t('commandPalette.run') || 'Run'}
                                    </div>
                                )}
                            </button>
                        );
                    })
                )}
            </div>
        </>
    );

    const pinnedRow = (
        <PinnedCommandRow
            commands={pinnedCommands}
            isDaylight={isDaylight}
            isExecuting={isExecuting}
            theme={theme}
            placement={capsuleFrame ? 'above' : 'below'}
            surfaceClassName={panelBg}
            borderColor={panelBorderColor}
            onExecute={(command) => {
                void onExecutePinnedCommand(command).then(refocusInput);
            }}
        />
    );

    const overlayBackdrop = {
        backgroundColor: hasClearBackdrop
            ? (isDaylight ? 'rgba(250,250,249,0.12)' : 'rgba(0,0,0,0.16)')
            : (isDaylight ? 'rgba(250,250,249,0.46)' : 'rgba(0,0,0,0.48)'),
    };
    const panelBox = (
        <div
            className={`overflow-hidden rounded-3xl border shadow-2xl ${panelBg}`}
            data-testid="command-palette-panel"
            style={{
                borderColor: panelBorderColor,
                color: 'var(--text-primary)',
            }}
        >
            {capsuleFrame ? (
                // 输入行在底，正好落在胶囊原来的位置；内容在外框展开时稍晚一点淡入。
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.16, delay: 0.06 }}
                >
                    {bodyBox}
                    {headerRow}
                </motion.div>
            ) : (
                <>
                    {headerRow}
                    {bodyBox}
                </>
            )}
        </div>
    );
    const blurInputOnTouch = () => {
        // iOS Safari blocks overflow scrolling in sibling containers
        // when an input is focused inside a fixed + backdrop-blur panel.
        // Blur proactively so the first touch-scroll works immediately.
        if (isTouchInput()) {
            inputRef.current?.blur();
        }
    };

    if (capsuleFrame) {
        return (
            <CommandPaletteCapsuleFrame
                frame={capsuleFrame}
                exitFrame={capsuleExitFrameRef.current ?? capsuleFrame}
                isOpen={isOpen}
                hasClearBackdrop={hasClearBackdrop}
                backdropStyle={overlayBackdrop}
                onClose={onClose}
                pinnedRow={pinnedRow}
                panel={panelBox}
                onOpened={blurInputOnTouch}
            />
        );
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    data-folia-keyboard-window="true"
                    className={`fixed inset-0 z-[150] flex items-start justify-center px-4 pt-[18vh] ${hasClearBackdrop ? '' : 'backdrop-blur-md'}`}
                    style={overlayBackdrop}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    onMouseDown={onClose}
                >
                    <motion.div
                        className="w-full max-w-2xl"
                        initial={{ opacity: 0, y: 18, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 18, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        onAnimationComplete={blurInputOnTouch}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        {panelBox}
                        {pinnedRow}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default CommandPalette;
