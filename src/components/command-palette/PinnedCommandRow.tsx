import React from 'react';
import { Command } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import type { CommandPaletteCommand } from './types';
import { getCommandTitle } from './commandText';

// src/components/command-palette/PinnedCommandRow.tsx
// Renders the three positional shortcuts below the command palette panel.

type PinnedCommandRowProps = {
    commands: Array<CommandPaletteCommand | null>;
    isDaylight: boolean;
    isExecuting: boolean;
    theme: Theme;
    onExecute: (command: CommandPaletteCommand) => void;
    /** Under the panel in the overlay; above it when the panel grows up out of the player bar. */
    placement?: 'below' | 'above';
};

const PinnedCommandRow: React.FC<PinnedCommandRowProps> = ({
    commands,
    isDaylight,
    isExecuting,
    theme,
    onExecute,
    placement = 'below',
}) => {
    const { t } = useTranslation();

    if (!commands.some(Boolean)) {
        return null;
    }

    return (
        <div
            className={`${placement === 'above' ? 'mb-3' : 'mt-4'} grid grid-cols-3 gap-3 px-2 sm:px-5`}
            data-testid="command-palette-pinned-row"
        >
            {commands.slice(0, 3).map((command, index) => {
                if (!command) {
                    return <div key={`empty-${index}`} aria-hidden="true" />;
                }

                const Icon = command.icon ?? Command;
                const title = getCommandTitle(command, t);
                return (
                    <button
                        key={`${index}-${command.id}`}
                        type="button"
                        disabled={isExecuting}
                        onClick={() => onExecute(command)}
                        className={`flex min-w-0 items-center justify-center gap-2 rounded-full border bg-transparent px-3 py-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 ${
                            isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/8'
                        }`}
                        style={{
                            borderColor: theme.accentColor,
                            color: 'var(--text-primary)',
                        }}
                        aria-label={t('commandPalette.runPinnedCommand', { command: title })}
                        title={title}
                    >
                        <Icon size={15} className="shrink-0" style={{ color: theme.accentColor }} />
                        <span className="min-w-0 truncate">{title}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default PinnedCommandRow;
