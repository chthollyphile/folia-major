import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAvailableCommandPaletteCommands, getCommandPaletteMatches, getQueueSongMatches, COMMAND_PALETTE_COMMANDS } from './commandRegistry';
import { isRecordableRecentCommand, readRecentCommandIds, recordRecentCommandId } from './recentCommands';
import type { CommandPaletteContext, CommandPaletteCommand, CommandPaletteMatch } from './types';

// src/components/command-palette/useCommandPalette.ts
// Manages palette state, keyboard opening, and selected autocomplete item.

const isTextEntryTarget = (target: EventTarget | null) => {
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
    const availableCommands = useMemo(() => getAvailableCommandPaletteCommands(context), [context]);

    const matches = useMemo(() => {
        let list: CommandPaletteMatch[];
        if (!activeCommand) {
            list = getCommandPaletteMatches(matchQuery, context, recentCommandIds);
        } else if (activeCommand.id === 'queue') {
            list = getQueueSongMatches(matchQuery, context);
        } else {
            const inputCommands = COMMAND_PALETTE_COMMANDS.filter(cmd => cmd.requiresInput);
            const activeMatch: CommandPaletteMatch = {
                command: activeCommand,
                score: 100,
                input: matchQuery,
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
                    input: matchQuery,
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
    }, [activeCommand, matchQuery, context, recentCommandIds]);

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

    const close = useCallback(() => {
        setIsOpen(false);
        setQuery('');
        setMatchQuery('');
        setIsComposing(false);
        setActiveIndex(0);
        setActiveCommand(null);
        setIsExecuting(false);
    }, []);

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
                setActiveCommand(match.command);
                setQuery('');
                setMatchQuery('');
                setActiveIndex(0);
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
                if (isRecordableRecentCommand(match.command, COMMAND_PALETTE_COMMANDS)) {
                    setRecentCommandIds(currentCommandIds => recordRecentCommandId(match.command.id, currentCommandIds));
                }
                close();
            }
            return didExecute;
        } finally {
            setIsExecuting(false);
        }
    }, [close, context, activeCommand, matches, isExecuting]);

    const executeActive = useCallback(() => executeMatch(activeIndex), [activeIndex, executeMatch]);

    useEffect(() => {
        setActiveIndex(0);
    }, [matchQuery]);

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
                    cmd.keywords.some(kw => kw.toLowerCase() === trimmed.toLowerCase())
                );
                if (matchedCmd) {
                    setActiveCommand(matchedCmd);
                    setQuery('');
                    setMatchQuery('');
                    setActiveIndex(0);
                }
            }
        }
    }, [query, isComposing, isOpen, activeCommand]);

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
    }, [currentView, isBlocked, open]);

    return {
        activeIndex,
        activePreview,
        activeCommand,
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
        query,
        setActiveIndex,
        setIsComposing,
        setMatchQuery,
        setQuery,
    };
};
