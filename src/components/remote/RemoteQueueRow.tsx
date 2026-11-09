import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { RowComponentProps } from 'react-window';
import { ListEnd, ListPlus, Trash2 } from 'lucide-react';
import type { RemoteQueueCommandType, RemoteQueueItem } from '../../types/remoteControl';

// src/components/remote/RemoteQueueRow.tsx
// One row of the remote window's queue (36 px): the song (title, tag, artist; the audible one is
// marked; a press plays it) and, under the pointer or the focus, the three queue actions of the
// wall tools' queue island: play next, move to end, remove. The audible song and the one the
// player holds only get "move to end"; an external stage playing leaves no actions at all.
// Kept outside the list (as WallToolsQueueRow is) so a new snapshot only changes rowProps and a
// row under the pointer is not remounted.

export type RemoteQueueRowProps = {
    items: readonly RemoteQueueItem[];
    /** The queue positions shown, in order (all of them, or those matching the search). */
    matches: readonly number[];
    currentKey: string | null;
    playingKey: string | null;
    readOnly: boolean;
    /** No song, or the main window has the controls locked. */
    disabled: boolean;
    labels: { playNext: string; moveToEnd: string; remove: string };
    run: (type: RemoteQueueCommandType, queueIndex: number) => void;
    /** Keys on a row's song button, handled by the list (↑↓ move the focus). */
    keyDown: (rowIndex: number, event: ReactKeyboardEvent<HTMLButtonElement>) => void;
};

export function RemoteQueueRow({
    index,
    style,
    ariaAttributes,
    items,
    matches,
    currentKey,
    playingKey,
    readOnly,
    disabled,
    labels,
    run,
    keyDown,
}: RowComponentProps<RemoteQueueRowProps>): ReactElement | null {
    const queueIndex = matches[index];
    const item = queueIndex === undefined ? undefined : items[queueIndex];
    if (!item) return null;
    const isCurrent = item.key === currentKey;
    const isPlaying = isCurrent || item.key === playingKey;
    const actions = readOnly || disabled ? [] : [
        ...(isPlaying ? [] : [{ type: 'queue-play-next' as const, label: labels.playNext, icon: ListPlus }]),
        { type: 'queue-move-to-end' as const, label: labels.moveToEnd, icon: ListEnd },
        ...(isPlaying ? [] : [{ type: 'queue-remove' as const, label: labels.remove, icon: Trash2 }]),
    ];

    return (
        <div {...ariaAttributes} style={style} className="remote-queue-row" data-current={isCurrent} data-queue-row={index}>
            <button
                type="button"
                className="remote-queue-song"
                aria-current={isCurrent ? 'true' : undefined}
                disabled={disabled}
                onClick={() => run('queue-play', queueIndex)}
                onKeyDown={event => keyDown(index, event)}
            >
                <span className="remote-queue-song__position">{queueIndex + 1}</span>
                <span className="remote-queue-song__text">
                    <span className="remote-queue-song__title">
                        <span className="remote-queue-song__name">{item.title}</span>
                        {item.tag && <span className="remote-queue-song__tag">{item.tag}</span>}
                    </span>
                    <span className="remote-queue-song__artist">{item.artist}</span>
                </span>
            </button>
            {actions.length > 0 && (
                <span className="remote-queue-actions">
                    {actions.map(({ type, label, icon: Icon }) => (
                        <button
                            key={type}
                            type="button"
                            className="remote-queue-action"
                            title={label}
                            aria-label={label}
                            onClick={event => {
                                // Pressed with the mouse: the row is about to change, leave no focus ring on it.
                                if (event.detail > 0) event.currentTarget.blur();
                                run(type, queueIndex);
                            }}
                        >
                            <Icon size={14} aria-hidden="true" />
                        </button>
                    ))}
                </span>
            )}
        </div>
    );
}
