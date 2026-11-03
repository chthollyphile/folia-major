import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isCommandPaletteCommandEnabled, rankCommands, COMMAND_PALETTE_COMMANDS } from './commandRegistry';
import { OPEN_HOTKEY_INDEX, openHotkeyStroke } from './commands';
import { findCommandsByTrigger } from './search/commandSearchIndex';
import { useTranslation } from 'react-i18next';
import { isRecordableRecentCommand, readRecentCommandIds, recordRecentCommandId, resolveRecentCommandToRecord } from './recentCommands';
import { readCommandFrequencyState, recordCommandUse, type CommandFrequencyState } from './commandFrequency';
import type { CommandPaletteContext, CommandPaletteCommand, CommandPaletteMatch } from './types';
import { resolvePinnedCommandSlots } from './pinnedCommandPreferences';
import { FILTER_VIEW_COMMAND_ID } from './commands/filterViewCommand';
import { isPrimaryModifierPressed, isSecondaryModifierPressed } from '../../utils/platform';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';
import { useAppViewStore } from '../../stores/useAppViewStore';
import { useInteractionSettingsStore } from '../../stores/useInteractionSettingsStore';
import { resolveCustomShortcutCommand } from './customShortcut';
import { useGlobalShortcuts } from './globalShortcuts/useGlobalShortcuts';
import { runGlobalShortcutCommand } from './globalShortcuts/runGlobalShortcutCommand';
import { usePlayerControlSlotSuggestionStore } from '../floating-player/playerControlSlotSuggestionStore';
import { createSlotSuggestionCandidateTracker, type PaletteSessionSource } from '../floating-player/slotSuggestionCandidateTracker';

// src/components/command-palette/useCommandPalette.ts
import { effectiveKeyCode, hasOpenSheet, isCommandPaletteShortcut, isTextEntryTarget } from '../../utils/keyboardTargets';

// Manages palette state, keyboard opening, and selected autocomplete item.

// 实现已移到 src/utils/keyboardTargets.ts（hooks 层也要用，不能让它依赖命令面板模块）。
// 这里保留再导出，原有的 import 点不必改。
export { isTextEntryTarget };

type UseCommandPaletteParams = {
    isBlocked: boolean;
    context: CommandPaletteContext;
};

export const useCommandPalette = ({
    isBlocked,
    context,
}: UseCommandPaletteParams) => {
    // The palette used to refuse to open anywhere but the player. That gate is gone: a command
    // decides for itself whether it applies, through `isAvailable` and `context.scope`.
    //
    // Modifier-free keys are the one thing still contended, and the contender is not the view —
    // it is whether something on screen reads typed characters as input. Nothing does on the
    // player, and nothing does on the home shelf either, so bare `s` opens the palette on both.
    // Inside a grid the filter owns them, or one press would fire two things at once.
    const ownsBareKeys = !context.scope.filter;

    // The search index carries the active locale's title and description alongside English
    // and the generated pinyin, so it is bucketed per language. Only the language tag is read
    // here — displayed text still goes through getCommandTitle / getCommandDescription.
    const { i18n } = useTranslation();
    const locale = i18n.language;
    // Memoized because this hook lives in App: without it the registry was scanned on every
    // single App render, not just when a filter appeared or went away.
    const filterCommand = useMemo(() => (
        context.scope.filter
            ? COMMAND_PALETTE_COMMANDS.find(command => command.id === FILTER_VIEW_COMMAND_ID) ?? null
            : null
    ), [context.scope.filter]);
    // Opt-in: `s` normally goes to the filter like any other letter, and the listener who wants it
    // back for the command list has to say so.
    const paletteHotkeyOnFilteringSurface = useInteractionSettingsStore(state => state.gridCommandPaletteHotkey);
    const customShortcutLetter = useInteractionSettingsStore(state => state.customShortcutLetter);
    const customShortcutCommandId = useInteractionSettingsStore(state => state.customShortcutCommandId);
    const customShortcutCommand = useMemo(() => resolveCustomShortcutCommand(
        customShortcutLetter,
        customShortcutCommandId,
        COMMAND_PALETTE_COMMANDS,
    ), [customShortcutLetter, customShortcutCommandId]);
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [matchQuery, setMatchQuery] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [activeCommand, setActiveCommand] = useState<CommandPaletteCommand | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [recentCommandIds, setRecentCommandIds] = useState<string[]>(() => readRecentCommandIds());
    // 使用频次，独立于上面那份 MRU 列表。只在命令执行成功后写一次，读取只发生在挂载时。
    const [frequencyState, setFrequencyState] = useState<CommandFrequencyState>(() => readCommandFrequencyState());
    // 哪一次使用算「在面板里常用」，好拿去问要不要放上进度条；规则见 slotSuggestionCandidateTracker。
    const [slotSuggestionTracker] = useState(createSlotSuggestionCandidateTracker);
    const close = useCallback(() => {
        slotSuggestionTracker.closeSession();
        setIsOpen(false);
        setQuery('');
        setMatchQuery('');
        setIsComposing(false);
        setActiveIndex(0);
        setActiveCommand(null);
        setIsExecuting(false);
    }, [slotSuggestionTracker]);
    const pinnedCommandIds = useSettingsModalStore(state => state.pinnedCommandIds);
    /**
     * The available set, with a stable identity.
     *
     * The filter itself is re-run on every context change and on every open — the latter because
     * some `isAvailable` predicates are getters whose answer moves without anything re-rendering
     * (a finished model download, say), and the registry's contract is that opening the palette
     * asks them again. But the *result* is usually identical across those runs, and returning a
     * fresh array each time was enough to re-rank all 125 commands on every playback tick.
     *
     * So: recompute eagerly, hand back the previous array when nothing actually changed. That is
     * what lets `defaultMatches` below leave `context` out of its dependencies.
     *
     * The stable set keeps hidden commands, because `canInvokeCommandById` gates on it and has
     * always let a UI surface reach a hidden command; the palette's own list drops them.
     */
    const enabledCommandsRef = useRef<CommandPaletteCommand[]>([]);
    const enabledCommands = useMemo(() => {
        const next = COMMAND_PALETTE_COMMANDS.filter(command => isCommandPaletteCommandEnabled(command, context));
        const previous = enabledCommandsRef.current;
        if (next.length === previous.length && next.every((command, index) => command === previous[index])) {
            return previous;
        }
        enabledCommandsRef.current = next;
        return next;
    }, [context, isOpen]);
    const availableCommands = useMemo(
        () => enabledCommands.filter(command => !command.hidden),
        [enabledCommands],
    );
    // Event handlers read the live context from here, so their identities do not follow every
    // context tick. `invokeCommandById` and `canInvokeCommandById` reach App's overlay model, and
    // a volume write re-rendering every overlay is what renderCounts.probe.ts guards against.
    const contextRef = useRef(context);
    contextRef.current = context;
    const pinnedCommands = useMemo(
        () => resolvePinnedCommandSlots(pinnedCommandIds, availableCommands),
        [availableCommands, pinnedCommandIds],
    );
    const surface = activeCommand?.surface ?? null;
    // Surfaces drive the input themselves, so they may need the raw value and a way to write
    // both the visible query and the match query at once.
    const commitQuery = useCallback((next: string) => {
        setQuery(next);
        setMatchQuery(next);
        setActiveIndex(0);
    }, []);

    // The three ways a match list gets produced, split apart so that only the one that genuinely
    // needs the live context depends on it.
    //
    // They used to be one memo with `context` in its dependency array, which meant a volume tick
    // or a track change re-ranked all 125 commands even though the query had not moved. Two of
    // the three branches never read `context` at all; the third (a surface building its own list)
    // does, and keeps it. `availableCommands` is identity-stable across ticks that do not change
    // availability, which is what makes dropping `context` here sound rather than stale.
    const defaultMatches = useMemo(() => (
        activeCommand
            ? null
            : rankCommands(matchQuery, availableCommands, recentCommandIds, locale, frequencyState.counts)
    ), [activeCommand, matchQuery, availableCommands, recentCommandIds, locale, frequencyState]);

    const surfaceMatches = useMemo(() => (
        activeCommand && surface?.buildMatches ? surface.buildMatches({ context, query }) : null
    ), [activeCommand, surface, context, query]);

    const inputModeMatches = useMemo(() => {
        if (!activeCommand || surface?.buildMatches) {
            return null;
        }
        const activeInput = surface?.useLiveQuery ? query : matchQuery;
        const activeMatch: CommandPaletteMatch = {
            command: activeCommand,
            score: 100,
            input: activeInput,
        };
        const otherMatches: CommandPaletteMatch[] = COMMAND_PALETTE_COMMANDS
            .filter(cmd => cmd.requiresInput)
            .filter(cmd => cmd.id !== activeCommand.id)
            .filter(cmd => {
                if (cmd.id === 'search-current') return true;
                return false;
            })
            .map((cmd, idx) => ({
                command: cmd,
                score: 90 - idx,
                input: activeInput,
            }));
        return [activeMatch, ...otherMatches];
    }, [activeCommand, surface, query, matchQuery]);

    // The preview pass is the only part that has to see the live context, and it is bounded by
    // MAX_COMMAND_MATCHES — so a context tick now costs a map over at most ten entries.
    const matches = useMemo(() => {
        const list = defaultMatches ?? surfaceMatches ?? inputModeMatches ?? [];
        return list.map(match => {
            let previewText: string | null = null;
            if (match.command.getPreview && (!match.command.requiresInput || match.input)) {
                previewText = match.command.getPreview(match.input, context);
            }
            return {
                ...match,
                previewText,
            };
        });
    }, [defaultMatches, surfaceMatches, inputModeMatches, context]);

    const activePreview = useMemo(() => {
        const match = matches[activeIndex];
        return match?.previewText || null;
    }, [activeIndex, matches]);

    const open = useCallback(() => {
        if (isBlocked) {
            return;
        }
        slotSuggestionTracker.openSession('user');
        setIsOpen(true);
        setActiveIndex(0);
    }, [isBlocked, slotSuggestionTracker]);

    const recordRecentCommand = useCallback((command: CommandPaletteCommand) => {
        if (isRecordableRecentCommand(command, COMMAND_PALETTE_COMMANDS)) {
            setRecentCommandIds(currentCommandIds => recordRecentCommandId(command.id, currentCommandIds));
            setFrequencyState(currentState => recordCommandUse(command.id, currentState));
            slotSuggestionTracker.recordUse(command.id);
        }
    }, [slotSuggestionTracker]);

    useEffect(() => {
        const commandId = slotSuggestionTracker.takeCandidate(isOpen);
        if (commandId) {
            usePlayerControlSlotSuggestionStore.getState().noteCommandUse(commandId, frequencyState.counts[commandId] ?? 0);
        }
    }, [frequencyState, isOpen, slotSuggestionTracker]);

    const activateInputCommand = useCallback((command: CommandPaletteCommand) => {
        const initialInput = command.getInitialInput?.(contextRef.current) ?? '';
        recordRecentCommand(command);
        setActiveCommand(command);
        setQuery(initialInput);
        setMatchQuery(initialInput);
        setActiveIndex(0);
    }, [recordRecentCommand]);

    // Opens the palette straight into one command, used by the per-command openHotkey entries.
    // `source` says who asked: a button outside the palette opening its surface is 'external'.
    const openCommand = useCallback((command: CommandPaletteCommand, source: PaletteSessionSource = 'user') => {
        if (isBlocked || isExecuting) {
            return;
        }

        slotSuggestionTracker.openSession(source);
        setIsOpen(true);
        setIsComposing(false);
        activateInputCommand(command);
    }, [activateInputCommand, isBlocked, isExecuting, slotSuggestionTracker]);

    // Lets a UI surface outside the palette jump straight into one command, without having to
    // import the registry or know how a command is activated.
    const openCommandById = useCallback((commandId: string) => {
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === commandId);
        if (command) {
            openCommand(command, 'external');
        }
    }, [openCommand]);

    /** Uses the palette's platform, scope and availability gates for buttons outside the palette. */
    const canInvokeCommandById = useCallback((commandId: string) => {
        const command = enabledCommands.find(entry => entry.id === commandId);
        if (!command) {
            return false;
        }
        return command.surface ? !isBlocked && !isExecuting : true;
    }, [enabledCommands, isBlocked, isExecuting]);

    /** Opens surface commands in the palette and directly executes commands without a surface. */
    // Re-asks availability against the live context at click time; `openCommand` applies the
    // blocked / executing gate for surface commands.
    const invokeCommandById = useCallback((commandId: string) => {
        const liveContext = contextRef.current;
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === commandId);
        if (!command || !isCommandPaletteCommandEnabled(command, liveContext)) {
            return;
        }

        if (command.surface) {
            openCommand(command, 'external');
            return;
        }

        recordRecentCommand(command);
        void command.execute('', liveContext);
    }, [openCommand, recordRecentCommand]);

    // The desktop app's system-wide playback shortcuts. Asked against the live context like a pinned
    // command, but not recorded: volume and next track pressed dozens of times a day would push
    // everything else out of the palette's recent list and its ranking.
    // Mod commands bound there run through their palette entry like the host's (runGlobalShortcutCommand).
    const runGlobalShortcut = useCallback((commandId: string) => {
        runGlobalShortcutCommand(commandId, contextRef.current);
    }, []);
    useGlobalShortcuts(runGlobalShortcut);

    const executeMatch = useCallback(async (index: number) => {
        if (isExecuting) {
            return false;
        }

        const match = matches[index];
        if (!match) {
            return false;
        }

        const input = match.input;
        if (match.command.requiresInput && !activeCommand) {
            if (!input) {
                activateInputCommand(match.command);
                return false;
            }
        }

        if (match.command.requiresInput && !input) {
            return false;
        }

        setIsExecuting(true);
        try {
            const didExecute = await match.command.execute(input, context);
            if (didExecute) {
                recordRecentCommand(resolveRecentCommandToRecord(match.command, activeCommand));
                if (match.command.closeAfterExecute !== false) {
                    close();
                }
            }
            return didExecute;
        } finally {
            setIsExecuting(false);
        }
    }, [activateInputCommand, close, context, activeCommand, matches, isExecuting, recordRecentCommand]);

    const executeCommand = useCallback(async (command: CommandPaletteCommand) => {
        if (isExecuting) {
            return false;
        }
        if (command.requiresInput) {
            activateInputCommand(command);
            return false;
        }

        setIsExecuting(true);
        try {
            const didExecute = await command.execute('', context);
            if (didExecute) {
                recordRecentCommand(command);
                if (command.closeAfterExecute !== false) {
                    close();
                }
            }
            return didExecute;
        } finally {
            setIsExecuting(false);
        }
    }, [activateInputCommand, close, context, isExecuting, recordRecentCommand]);

    /**
     * Runs one command from outside the palette. A command that takes input or draws its own panel
     * needs the palette on screen to do either; everything else should just happen, without an
     * overlay opening and closing around it.
     */
    const invokeCommand = useCallback((command: CommandPaletteCommand) => {
        if (command.requiresInput || command.surface) {
            openCommand(command);
            return;
        }
        void executeCommand(command);
    }, [executeCommand, openCommand]);

    const executeActive = useCallback(async () => {
        const handled = await surface?.onSubmit?.({
            context,
            query,
            setQuery: commitQuery,
            matches,
            activeIndex,
            setActiveIndex,
            isExecuting,
            executeMatch,
            executeCommand,
            close,
        });
        if (handled !== null && handled !== undefined) {
            return handled;
        }
        return executeMatch(activeIndex);
    }, [activeIndex, close, commitQuery, context, executeCommand, executeMatch, isExecuting, matches, query, surface]);
    // Surface match lists use live input, so their selection must reset with that same query.
    const selectionQuery = surface?.buildMatches || surface?.useLiveQuery ? query : matchQuery;
    useEffect(() => {
        setActiveIndex(0);
    }, [selectionQuery]);

    // A surface can ask the palette for something without knowing anything about it — a grid
    // restoring a view it had filtered, a click that used to dismiss the box, a button pointed at
    // the command list. Keyed on the request object alone: everything else is read when it fires,
    // and re-running on their identity would reopen the box every time a grid re-registered.
    const paletteRequest = useAppViewStore(state => state.commandPaletteRequest);
    useEffect(() => {
        if (!paletteRequest.seq) {
            return;
        }
        if (paletteRequest.kind === 'root') {
            open();
            return;
        }
        if (paletteRequest.kind === 'command') {
            openCommandById(paletteRequest.commandId);
            return;
        }
        if (paletteRequest.kind === 'filter') {
            // A surface with its own input (the bravais seam) puts that up instead of the palette's inline box.
            const ownInput = context.scope.filter?.ownInput;
            if (ownInput) {
                ownInput.open();
                return;
            }
            if (filterCommand) {
                openCommand(filterCommand);
            }
            return;
        }
        // Only ever takes down the filter box. A request must not close a palette the listener
        // opened for something else.
        if (activeCommand?.surface?.presentation === 'inline') {
            close();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paletteRequest]);

    // An inline surface is a stand-in for a control that belongs to something else on screen. When
    // that something goes away — a card played from a grid takes the app to the player, and the grid
    // unmounts under the box — there is nothing left to filter, and the palette would otherwise fall
    // back to the full overlay carrying a filter pill that now points at nothing.
    useEffect(() => {
        if (!isOpen || context.scope.filter) {
            return;
        }
        if (activeCommand?.surface?.presentation !== 'inline') {
            return;
        }
        close();
    }, [activeCommand, close, context.scope.filter, isOpen]);

    // Execute mode fires as soon as the buffer is unambiguous, so the surface gets a chance to
    // act on every keystroke. The ref keeps one buffer from being judged twice.
    const handledQueryRef = useRef<string | null>(null);
    useEffect(() => {
        if (!surface?.onQueryChange) {
            handledQueryRef.current = null;
            return;
        }
        if (handledQueryRef.current === query) {
            return;
        }
        handledQueryRef.current = query;
        void surface.onQueryChange({
            context,
            query,
            setQuery: commitQuery,
            matches,
            activeIndex,
            setActiveIndex,
            isExecuting,
            executeMatch,
            executeCommand,
            close,
        });
    }, [activeIndex, close, commitQuery, context, executeCommand, executeMatch, isExecuting, matches, query, surface]);

    // Space-to-pill conversion for commands requiring input
    useEffect(() => {
        if (!isOpen || isComposing || activeCommand) {
            return;
        }

        if (query.endsWith(' ')) {
            const trimmed = query.trim();
            if (trimmed) {
                // This effect is not behind the 120ms match debounce — it fires on every raw
                // keystroke — so it must not scan the registry. Going through the search index
                // means the terms that turn into a pill are exactly the terms the `input` tier
                // matches on; the old keyword scan and the ranker could disagree.
                const matchedCmd = findCommandsByTrigger(availableCommands, trimmed, locale)
                    .find(cmd => cmd.requiresInput && isCommandPaletteCommandEnabled(cmd, context));
                if (matchedCmd) {
                    activateInputCommand(matchedCmd);
                }
            }
        }
    }, [activateInputCommand, availableCommands, context, locale, query, isComposing, isOpen, activeCommand]);

    useEffect(() => {
        if (!isOpen || isComposing) {
            return undefined;
        }

        const timer = window.setTimeout(() => {
            setMatchQuery(query);
        }, 120);

        return () => window.clearTimeout(timer);
    }, [isComposing, isOpen, query]);

    useEffect(() => {
        if (activeIndex >= matches.length) {
            // Preserve a query reset already queued by the effect above before clamping the index.
            setActiveIndex(current => Math.min(current, Math.max(0, matches.length - 1)));
        }
    }, [activeIndex, matches.length]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // A dialog is drawn over the palette and has the keyboard: under it no key opens the
            // palette or runs a command.
            if (hasOpenSheet()) {
                return;
            }

            // Ordered by who has the stronger claim on the keystroke, not by how the palette is
            // built. A modifier shortcut can never be mistaken for input, so it goes first; a
            // surface that reads bare characters outranks every modifier-free palette key, or the
            // same press would do two things at once.

            // The listener's own shortcut. First, like the other modifier entries, and resolved
            // through the same function the settings picker uses — a binding the picker would
            // refuse cannot fire from a value left in storage.
            if (customShortcutCommand
                && event.altKey
                && !isPrimaryModifierPressed(event)
                && !isSecondaryModifierPressed(event)
                && !event.shiftKey
                && event.key.toLowerCase() === customShortcutLetter
                && isCommandPaletteCommandEnabled(customShortcutCommand, context)
            ) {
                if (isBlocked) {
                    return;
                }

                event.preventDefault();
                invokeCommand(customShortcutCommand);
                return;
            }

            // Works everywhere, because it carries a modifier.
            // Software-injected shortcuts may provide the key without a physical key code.
            if (isCommandPaletteShortcut(event)) {
                if (isBlocked) {
                    return;
                }

                event.preventDefault();
                open();
                return;
            }

            // A surface that reads typed characters gets them, whatever they are. This is the home
            // grids' type-to-filter, except that the palette now holds the input — which is what
            // lets one command, one box and one keyword list serve all three of them.
            if (filterCommand && !isOpen && !event.ctrlKey && !event.altKey && !event.metaKey && !isTextEntryTarget(event.target)) {
                // A surface that draws its own input (the bravais seam) takes the typing itself; the palette only
                // keeps the keys it owns outright (`:` and the opt-in `s`, below).
                const ownInput = context.scope.filter?.ownInput;
                // An IME announces itself with 'Process' before it has any text; open and let the
                // composition land in the box.
                if (event.key === 'Process' || event.key === 'Unidentified') {
                    if (ownInput) {
                        ownInput.takeKey(event);
                        return;
                    }
                    openCommand(filterCommand);
                    return;
                }
                if (event.key.length === 1) {
                    // A key a command declares as its bare entry — `:` for execute mode — is that
                    // command, not a filter character. Without this the grids swallowed the colon
                    // and execute mode could not be reached from them at all. Checked here rather
                    // than left to the dispatch below, which refuses bare keys wherever a filter
                    // owns them.
                    const bareHotkeyCommand = OPEN_HOTKEY_INDEX.get(openHotkeyStroke({ key: event.key }));
                    if (bareHotkeyCommand && isCommandPaletteCommandEnabled(bareHotkeyCommand, context)) {
                        event.preventDefault();
                        invokeCommand(bareHotkeyCommand);
                        return;
                    }
                    if (ownInput) {
                        if (paletteHotkeyOnFilteringSurface && effectiveKeyCode(event) === 'KeyS' && !event.shiftKey) {
                            event.preventDefault();
                            open();
                            return;
                        }
                        // The surface decides whether the keystroke lands in its input or is dropped; a key it
                        // refuses (Space, a reserved key) is left for whoever else listens.
                        ownInput.takeKey(event);
                        return;
                    }
                    // The opening keystroke is deliberately dropped rather than seeded into the
                    // box. Replaying it would put a stray latin character in front of an IME
                    // composition that the same press is already starting — the grids swallowed it
                    // for exactly this reason, and the palette has to keep doing so.
                    event.preventDefault();
                    if (paletteHotkeyOnFilteringSurface && effectiveKeyCode(event) === 'KeyS' && !event.shiftKey) {
                        open();
                        return;
                    }
                    openCommand(filterCommand);
                    return;
                }
            }

            // Commands declare their own entry shortcut; the palette just dispatches them.
            // `ctrl` in a declaration means the platform's primary modifier, so the same entry is
            // Ctrl+P on Windows/Linux and Cmd+P on macOS. Availability is honoured here too, or a
            // hotkey would still reach a command the current state has withdrawn — the queue's
            // ctrl+p during Personal FM, say.
            //
            // This handler is attached to `window`, so it saw every keystroke in the entire app
            // and used to answer them by scanning all 125 commands and calling
            // isCommandPaletteCommandEnabled on each. The declared strokes are fixed at module
            // load; only availability is dynamic, so look the stroke up and check that one.
            const stroke = openHotkeyStroke({
                key: event.key,
                ctrl: isPrimaryModifierPressed(event),
                alt: event.altKey,
            });
            const strokeCommand = isSecondaryModifierPressed(event) ? undefined : OPEN_HOTKEY_INDEX.get(stroke);
            const hotkeyCommand = strokeCommand && isCommandPaletteCommandEnabled(strokeCommand, context)
                ? strokeCommand
                : undefined;
            if (hotkeyCommand) {
                const needsIdleFocus = !hotkeyCommand.openHotkey?.ctrl;
                if (isBlocked || (needsIdleFocus && !ownsBareKeys) || (needsIdleFocus && isTextEntryTarget(event.target))) {
                    return;
                }

                event.preventDefault();
                invokeCommand(hotkeyCommand);
                return;
            }

            if (effectiveKeyCode(event) !== 'KeyS') {
                return;
            }
            if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
                return;
            }
            if (isTextEntryTarget(event.target)) {
                return;
            }
            if (!ownsBareKeys || isBlocked) {
                return;
            }

            event.preventDefault();
            open();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [context, customShortcutCommand, customShortcutLetter, filterCommand, invokeCommand, isBlocked, isOpen, open, openCommand, ownsBareKeys, paletteHotkeyOnFilteringSurface]);

    return {
        activeIndex,
        activePreview,
        activeCommand,
        openCommandById,
        canInvokeCommandById,
        invokeCommandById,
        availableCommands,
        setActiveCommand,
        isExecuting,
        close,
        executeActive,
        executeMatch,
        isOpen,
        isComposing,
        matches,
        open,
        pinnedCommands,
        query,
        commitQuery,
        setActiveIndex,
        setIsComposing,
        setMatchQuery,
        setQuery,
        executeCommand,
        executePinnedCommand: executeCommand,
    };
};
