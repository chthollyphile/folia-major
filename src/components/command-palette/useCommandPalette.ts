import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAvailableCommandPaletteCommands, getCommandPaletteMatches, isCommandPaletteCommandEnabled, COMMAND_PALETTE_COMMANDS } from './commandRegistry';
import { isRecordableRecentCommand, readRecentCommandIds, recordRecentCommandId, resolveRecentCommandToRecord } from './recentCommands';
import type { CommandPaletteContext, CommandPaletteCommand, CommandPaletteMatch } from './types';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { resolvePinnedCommandSlots } from './pinnedCommandPreferences';

// src/components/command-palette/useCommandPalette.ts
// Manages palette state, keyboard opening, and selected autocomplete item.

export const isTextEntryTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === 'input'
        || tagName === 'textarea'
        || tagName === 'select'
        || target.isContentEditable;
};

type UseCommandPaletteParams = {
    currentView: 'home' | 'player';
    isBlocked: boolean;
    context: CommandPaletteContext;
};

export const useCommandPalette = ({
    currentView,
    isBlocked,
    context,
}: UseCommandPaletteParams) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [matchQuery, setMatchQuery] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [activeCommand, setActiveCommand] = useState<CommandPaletteCommand | null>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [recentCommandIds, setRecentCommandIds] = useState<string[]>(() => readRecentCommandIds());
    const close = useCallback(() => {
        setIsOpen(false);
        setQuery('');
        setMatchQuery('');
        setIsComposing(false);
        setActiveIndex(0);
        setActiveCommand(null);
        setIsExecuting(false);
    }, []);
    const pinnedCommandIds = useSettingsUiStore(state => state.pinnedCommandIds);
    const availableCommands = useMemo(() => getAvailableCommandPaletteCommands(context), [context]);
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

    const matches = useMemo(() => {
        const activeInput = surface?.useLiveQuery ? query : matchQuery;
        let list: CommandPaletteMatch[];
        if (!activeCommand) {
            list = getCommandPaletteMatches(matchQuery, context, recentCommandIds);
        } else if (surface?.buildMatches) {
            list = surface.buildMatches({ context, query });
        } else {
            const inputCommands = COMMAND_PALETTE_COMMANDS.filter(cmd => cmd.requiresInput);
            const activeMatch: CommandPaletteMatch = {
                command: activeCommand,
                score: 100,
                input: activeInput,
            };
            const otherMatches: CommandPaletteMatch[] = inputCommands
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
            list = [activeMatch, ...otherMatches];
        }

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
    }, [activeCommand, matchQuery, query, context, recentCommandIds, surface]);

    const activePreview = useMemo(() => {
        const match = matches[activeIndex];
        return match?.previewText || null;
    }, [activeIndex, matches]);

    const open = useCallback(() => {
        if (currentView !== 'player' || isBlocked) {
            return;
        }
        setIsOpen(true);
        setActiveIndex(0);
    }, [currentView, isBlocked]);

    const recordRecentCommand = useCallback((command: CommandPaletteCommand) => {
        if (isRecordableRecentCommand(command, COMMAND_PALETTE_COMMANDS)) {
            setRecentCommandIds(currentCommandIds => recordRecentCommandId(command.id, currentCommandIds));
        }
    }, []);

    const activateInputCommand = useCallback((command: CommandPaletteCommand) => {
        const initialInput = command.getInitialInput?.(context) ?? '';
        recordRecentCommand(command);
        setActiveCommand(command);
        setQuery(initialInput);
        setMatchQuery(initialInput);
        setActiveIndex(0);
    }, [context, recordRecentCommand]);

    // Opens the palette straight into one command, used by the per-command openHotkey entries.
    const openCommand = useCallback((command: CommandPaletteCommand) => {
        if (currentView !== 'player' || isBlocked || isExecuting) {
            return;
        }

        setIsOpen(true);
        setIsComposing(false);
        activateInputCommand(command);
    }, [activateInputCommand, currentView, isBlocked, isExecuting]);

    // Lets a UI surface outside the palette jump straight into one command, without having to
    // import the registry or know how a command is activated.
    const openCommandById = useCallback((commandId: string) => {
        const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === commandId);
        if (command) {
            openCommand(command);
        }
    }, [openCommand]);

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
                close();
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
                close();
            }
            return didExecute;
        } finally {
            setIsExecuting(false);
        }
    }, [activateInputCommand, close, context, isExecuting, recordRecentCommand]);

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



    useEffect(() => {
        setActiveIndex(0);
    }, [matchQuery]);

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
                const matchedCmd = COMMAND_PALETTE_COMMANDS.find(cmd =>
                    cmd.requiresInput &&
                    cmd.keywords.some(kw => kw.toLowerCase() === trimmed.toLowerCase()) &&
                    isCommandPaletteCommandEnabled(cmd, context)
                );
                if (matchedCmd) {
                    activateInputCommand(matchedCmd);
                }
            }
        }
    }, [activateInputCommand, context, query, isComposing, isOpen, activeCommand]);

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
            setActiveIndex(Math.max(0, matches.length - 1));
        }
    }, [activeIndex, matches.length]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Commands declare their own entry shortcut; the palette just dispatches them.
            // Availability is honoured here too, or a hotkey would still reach a command the
            // current state has withdrawn — the queue's ctrl+p during Personal FM, say.
            const hotkeyCommand = COMMAND_PALETTE_COMMANDS.find(command => (
                command.openHotkey
                && command.openHotkey.key.toLowerCase() === event.key.toLowerCase()
                && Boolean(command.openHotkey.ctrl) === event.ctrlKey
                && !event.altKey
                && !event.metaKey
                && isCommandPaletteCommandEnabled(command, context)
            ));
            if (hotkeyCommand) {
                const needsIdleFocus = !hotkeyCommand.openHotkey?.ctrl;
                if (currentView !== 'player' || isBlocked || (needsIdleFocus && isTextEntryTarget(event.target))) {
                    return;
                }

                event.preventDefault();
                openCommand(hotkeyCommand);
                return;
            }

            if (event.code !== 'KeyS') {
                return;
            }
            if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
                return;
            }
            if (isTextEntryTarget(event.target)) {
                return;
            }
            if (currentView !== 'player' || isBlocked) {
                return;
            }

            event.preventDefault();
            open();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [context, currentView, isBlocked, open, openCommand]);

    return {
        activeIndex,
        activePreview,
        activeCommand,
        openCommandById,
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
