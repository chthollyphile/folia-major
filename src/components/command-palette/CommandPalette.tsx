import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CircleHelp, Command, CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import type { CommandPaletteContext, CommandPaletteMatch, CommandPaletteCommand } from './types';
import type { CommandPaletteSurface, CommandSurfaceRenderArgs } from './surfaces/types';
import CommandPaletteSyntaxHints from './CommandPaletteSyntaxHints';
import { parseCommandQuery } from './syntax/parse';
import { buildFlagSuggestions, type SyntaxSuggestion } from './syntax/suggest';
import { getCommandDescription, getCommandTitle } from './commandText';
import { getCommandPrimaryTerm } from './search/commandSearchIndex';
import { isTextEntryTarget } from './useCommandPalette';
import PinnedCommandRow from './PinnedCommandRow';
import CommandPaletteAllCommandsList from './CommandPaletteAllCommandsList';
import { setIsCommandFilterOpen } from '../../stores/useAppViewStore';
import { gridSearchPanelMotion } from '../shared/gridSearchPanelMotion';
import { useLiquidGlassFilter } from '../shared/LiquidGlassFilter';
import { buildGlassTintStyle, resolveLiquidGlassTintMultiplier, resolveSurfaceDispersion, useLiquidGlassTuningStore } from '../../stores/useLiquidGlassTuningStore';

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
    const syntaxSuggestions = useMemo<SyntaxSuggestion[]>(() => (
        activeCommand?.syntax
            ? buildFlagSuggestions(activeCommand.syntax, parseCommandQuery(activeCommand.syntax, query))
            : []
    ), [activeCommand, query]);
    const [syntaxIndex, setSyntaxIndex] = useState(0);
    // The list changes as the draft is typed, so the highlight has to come back into range.
    useEffect(() => {
        setSyntaxIndex(index => (index < syntaxSuggestions.length ? index : 0));
    }, [syntaxSuggestions]);

    const acceptSyntaxSuggestion = useCallback((suggestion: SyntaxSuggestion) => {
        onQueryCommit(suggestion.replacement);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, [onQueryCommit]);
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
    }
    const filterAnchor = isOpen ? liveFilterAnchor : lastFilterAnchorRef.current;
    const isInlineFrame = Boolean(filterAnchor);
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

    const panelText = isDaylight ? 'text-zinc-950' : 'text-white';
    // 遮罩压暗色（rgba 三元组 + alpha 拆开供 framer 动画 backgroundColor 用）
    const paletteDimRgb = isDaylight ? '250,250,249' : '0,0,0';
    const paletteDimAlpha = isDaylight ? 0.46 : 0.48;
    // 液态玻璃：主面板折射身后的应用内容。遮罩层的 backdrop-blur-md 必须保持移除——
    // 祖先上的 backdrop-filter 会形成 backdrop root，面板玻璃就只能采样到遮罩自己的
    // 纯色底，折射不可见。面板底色换成调参 tint，压暗由遮罩的 rgba 承担。
    const liquidGlassTuning = useLiquidGlassTuningStore(state => state.liquidGlassTuning);
    const glassTint = buildGlassTintStyle(liquidGlassTuning, isDaylight, resolveLiquidGlassTintMultiplier('commandPalette', isDaylight));
    const panelRef = React.useRef<HTMLDivElement>(null);
    // glassActive 滞后 isOpen 一个退场动画：enabled 立刻翻 false 会让面板在退场前半段
    // 突变成普通毛玻璃（rim/折射瞬间消失），保持到 onExitComplete 再卸。
    // filterAnchor 走 portal 分支（网格搜索框），主面板此时不在 DOM 里——该分支是
    // 即时卸载（无退场动画），趁势翻 false，回到主面板时 RO 才会重新挂到新元素上。
    const [paletteGlassActive, setPaletteGlassActive] = React.useState(isOpen);
    React.useEffect(() => {
        if (isOpen && !filterAnchor) {
            setPaletteGlassActive(true);
        } else if (filterAnchor) {
            setPaletteGlassActive(false);
        }
    }, [isOpen, filterAnchor]);
    const { defs: glassFilterDefs, backdropFilter: glassBackdropFilter } = useLiquidGlassFilter(panelRef, {
        blur: liquidGlassTuning.blur,
        saturation: liquidGlassTuning.saturation,
        edgeDisplacement: liquidGlassTuning.edgeDisplacement,
        dispersion: resolveSurfaceDispersion('commandPalette', liquidGlassTuning.dispersion),
        shape: 'rounded',
        cornerRadius: 24,
        enabled: paletteGlassActive,
    });
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
    }, [acceptSyntaxSuggestion, activeIndex, activeCommand, isComposing, isExecuting, isOpen, isShowingAllCommands, matches.length, onActiveCommandChange, onActiveIndexChange, onClose, onExecuteActive, onQueryChange, query, surface, surfaceArgs, syntaxIndex, syntaxSuggestions]);

    if (filterAnchor) {
        // Portalled into the host's own element, so the box keeps the position that host gave it
        // rather than a viewport offset guessed here. Same entrance the grids animated with, too.
        return createPortal(
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        {...gridSearchPanelMotion}
                        data-folia-keyboard-window="true"
                        data-testid="command-palette-filter"
                        className="absolute top-24 left-1/2 z-[85] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 pointer-events-auto"
                    >
                        <div className="relative rounded-full border shadow-2xl backdrop-blur-2xl theme-glass-panel">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4" />
                            {renderQueryInput('w-full rounded-full bg-transparent py-3 pl-11 pr-11 text-sm font-medium outline-none placeholder:text-current placeholder:opacity-40')}
                            <button
                                type="button"
                                onClick={() => {
                                    // Clear first, close second — the grids' own button did the
                                    // same, and it is the only way to undo a filter with the mouse.
                                    if (query) {
                                        onQueryCommit('');
                                        window.requestAnimationFrame(() => inputRef.current?.focus());
                                        return;
                                    }
                                    onClose();
                                }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 opacity-45 transition-opacity hover:opacity-90 cursor-pointer"
                                aria-label={query ? t('ui.clear') : t('ui.close')}
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>,
            filterAnchor,
        );
    }

    return (
        <AnimatePresence onExitComplete={() => setPaletteGlassActive(false)}>
            {isOpen && (
                <motion.div
                    data-folia-keyboard-window="true"
                    className="fixed inset-0 z-[150] flex items-start justify-center px-4 pt-[18vh]"
                    // 压暗用 backgroundColor 动画而不是 opacity：opacity<1 的祖先会形成
                    // backdrop root，进退场期间面板玻璃采样不到遮罩下的应用内容。
                    initial={{ backgroundColor: `rgba(${paletteDimRgb}, 0)` }}
                    animate={{ backgroundColor: `rgba(${paletteDimRgb}, ${paletteDimAlpha})` }}
                    exit={{ backgroundColor: `rgba(${paletteDimRgb}, 0)` }}
                    transition={{ duration: 0.16 }}
                    onMouseDown={onClose}
                >
                    <motion.div
                        className="w-full max-w-2xl"
                        // 位移/缩放留在 wrapper，opacity 下放到面板自身（玻璃元素）：
                        // opacity<1 的祖先会形成 backdrop root，进退场期间面板玻璃
                        // 采样不到遮罩下的应用内容、动画结束才跳回真实折射。
                        initial={{ y: 18, scale: 0.98 }}
                        animate={{ y: 0, scale: 1 }}
                        exit={{ y: 18, scale: 0.98 }}
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
                        {glassFilterDefs}
                        <motion.div
                            ref={panelRef}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className={`overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-xl ${panelText}`}
                            data-testid="command-palette-panel"
                            style={{
                                borderColor: isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.12)',
                                color: 'var(--text-primary)',
                                backdropFilter: glassBackdropFilter ?? undefined,
                                ...glassTint,
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

                        {/* Removed activePreview top panel, it is now shown inline in the list items description */}

                        {/* The palette doubles as a canvas for UI-bearing commands, so this box is the
                            one fixed dimension every surface renders into. It must stay CSS-resolved:
                            no measurement, no content-driven height. commandPaletteSizing.spec.ts guards it. */}
                        <div
                            data-testid="command-palette-body"
                            className="h-[min(496px,50vh)] overflow-y-auto p-2"
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
                                        window.requestAnimationFrame(() => inputRef.current?.focus());
                                    }}
                                />
                            ) : surfaceBody ? (
                                <Suspense fallback={<div className="flex h-full items-center justify-center opacity-40"><Loader2 size={20} className="animate-spin" /></div>}>
                                    {React.createElement(surfaceBody, {
                                        ...surface?.mapProps?.(surfaceArgs),
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
                                    const commandHint = primaryTermOf(match.command);
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
                        </motion.div>
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
