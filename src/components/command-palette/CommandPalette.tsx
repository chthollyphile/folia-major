import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CircleHelp, Command, CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import type { CommandPaletteContext, CommandPaletteMatch, CommandPaletteCommand } from './types';
import type { CommandPaletteSurface, CommandSurfaceRenderArgs } from './surfaces/types';
import { getCommandDescription, getCommandTitle } from './commandText';
import { isTextEntryTarget } from './useCommandPalette';
import PinnedCommandRow from './PinnedCommandRow';

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

const resolveSurfaceComponent = (surface: CommandPaletteSurface) => {
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
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement | null>(null);
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
    const panelBg = isDaylight ? 'bg-white/70 text-zinc-950' : 'bg-zinc-950/70 text-white';
    const itemActiveBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const itemIdleBg = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5';

    useEffect(() => {
        if (!isOpen) {
            setIsShowingAllCommands(false);
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });

        return () => window.cancelAnimationFrame(frame);
    }, [isOpen]);

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
                const firstKw = activeCommand.keywords[0] || '';
                onActiveCommandChange(null);
                onQueryChange(firstKw);
                onActiveIndexChange(0);
                return;
            }

            // Surfaces get first refusal on keys: a grid needs different arrow semantics than
            // the default one-per-step list, and only the surface knows its own layout.
            if (surface?.onKeyDown?.(event, surfaceArgs)) {
                event.preventDefault();
                return;
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                onActiveIndexChange(Math.min(matches.length - 1, activeIndex + 1));
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                onActiveIndexChange(Math.max(0, activeIndex - 1));
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                void onExecuteActive();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeIndex, activeCommand, isComposing, isExecuting, isOpen, isShowingAllCommands, matches.length, onActiveCommandChange, onActiveIndexChange, onClose, onExecuteActive, onQueryChange, query, surface, surfaceArgs]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    data-folia-keyboard-window="true"
                    className="fixed inset-0 z-[150] flex items-start justify-center px-4 pt-[18vh] backdrop-blur-md"
                    style={{ backgroundColor: isDaylight ? 'rgba(250,250,249,0.46)' : 'rgba(0,0,0,0.48)' }}
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
                        onAnimationComplete={() => {
                            // iOS Safari blocks overflow scrolling in sibling containers
                            // when an input is focused inside a fixed + backdrop-blur panel.
                            // Blur proactively so the first touch-scroll works immediately.
                            if ('ontouchstart' in window) {
                                inputRef.current?.blur();
                            }
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <div
                            className={`overflow-hidden rounded-3xl border shadow-2xl ${panelBg}`}
                            data-testid="command-palette-panel"
                            style={{
                                borderColor: isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.12)',
                                color: 'var(--text-primary)',
                            }}
                        >
                        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)' }}>
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
                                    <span>{getCommandTitle(activeCommand, t)}</span>
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
                                className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:opacity-45 disabled:opacity-50"
                                style={{ color: 'var(--text-primary)' }}
                            />
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

                        {/* Removed activePreview top panel, it is now shown inline in the list items description */}

                        <div
                            className="h-[min(496px,50vh)] overflow-y-auto p-2"
                            onTouchStart={() => inputRef.current?.blur()}
                        >
                            {isShowingAllCommands ? (
                                <div>
                                    <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium opacity-60">
                                        <button
                                            type="button"
                                            onClick={() => setIsShowingAllCommands(false)}
                                            className={`rounded-full p-1 transition-colors ${isDaylight ? 'hover:bg-black/10' : 'hover:bg-white/10'}`}
                                            aria-label={t('commandPalette.backToSearch') || 'Back to search'}
                                        >
                                            <ArrowLeft size={14} />
                                        </button>
                                        <span>{t('commandPalette.allCommands') || 'All commands'}</span>
                                        <span className="ml-auto tabular-nums opacity-60">{availableCommands.length}</span>
                                    </div>
                                    {availableCommands.map(command => {
                                        const groupLabel = t(groupLabelKey[command.group] || 'commandPalette.groupOther') || command.group;
                                        const title = getCommandTitle(command, t);
                                        const description = getCommandDescription(command, t);
                                        const Icon = command.icon ?? Command;
                                        return (
                                            <button
                                                key={command.id}
                                                type="button"
                                                onClick={() => {
                                                    onQueryChange(command.keywords[0] ?? command.title);
                                                    onActiveIndexChange(0);
                                                    setIsShowingAllCommands(false);
                                                    window.requestAnimationFrame(() => inputRef.current?.focus());
                                                }}
                                                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${itemIdleBg}`}
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
                                                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] opacity-50">{groupLabel}</span>
                                                    </div>
                                                    <div className="mt-0.5 truncate text-xs opacity-50">{description}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : surface ? (
                                <Suspense fallback={<div className="flex h-full items-center justify-center opacity-40"><Loader2 size={20} className="animate-spin" /></div>}>
                                    {React.createElement(resolveSurfaceComponent(surface), {
                                        ...surface.mapProps(surfaceArgs),
                                        refocusInput: () => window.requestAnimationFrame(() => inputRef.current?.focus()),
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
                                    const commandHint = match.command.keywords[0] ?? match.command.id;
                                    const Icon = match.command.icon ?? Command;
                                    return (
                                        <button
                                            key={match.command.id}
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
                                                    <span
                                                        className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] ${isDaylight ? 'bg-black/8 text-zinc-700' : 'bg-white/10 text-zinc-200'
                                                            }`}
                                                    >
                                                        {commandHint}
                                                    </span>
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
                        </div>
                        <PinnedCommandRow
                            commands={pinnedCommands}
                            isDaylight={isDaylight}
                            isExecuting={isExecuting}
                            theme={theme}
                            onExecute={(command) => {
                                void onExecutePinnedCommand(command).then(() => {
                                    window.requestAnimationFrame(() => inputRef.current?.focus());
                                });
                            }}
                        />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default CommandPalette;
