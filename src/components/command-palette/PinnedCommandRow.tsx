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
    /** The panel's own fill and edge, so the three buttons read as pieces of the same glass. */
    surfaceClassName: string;
    borderColor: string;
};

const PinnedCommandRow: React.FC<PinnedCommandRowProps> = ({
    commands,
    isDaylight,
    isExecuting,
    theme,
    onExecute,
    placement = 'below',
    surfaceClassName,
    borderColor,
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
                        className={`flex min-w-0 items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-2xl transition-[filter] disabled:pointer-events-none disabled:opacity-45 ${surfaceClassName} ${
                            isDaylight ? 'hover:brightness-95' : 'hover:brightness-125'
                        }`}
                        style={{
                            borderColor,
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
