import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { ScratchpadEntry, ScratchpadGroup } from '../../../stores/useScratchpadStore';
import ScratchpadGroupHeader from './ScratchpadGroupHeader';
import ScratchpadRow, { type ScratchpadRowActions, type ScratchpadRowLabels } from './ScratchpadRow';

// src/components/app/scratchpad/ScratchpadList.tsx
// 速记簿收起状态（抽屉）里的分组列表：每个来源一组，组头带整组动作，组内一行一首。

/** 抽屉交给列表与画布的动作（ScratchpadHost 组装）。 */
export type ScratchpadPanelActions = {
    play: (entry: ScratchpadEntry) => void;
    enqueue: (entries: ScratchpadEntry[]) => void;
    /** 打开歌单选择器；entries 必须同一来源（同一组）。 */
    addToPlaylist: (entries: ScratchpadEntry[]) => void;
    remove: (keys: string[]) => void;
    move: (groupKey: string, keys: string[], targetIndex: number) => void;
    sourceLabel: (song: SongResult) => string;
    canAddToPlaylist: (song: SongResult) => boolean;
};

type ScratchpadListProps = {
    groups: ScratchpadGroup[];
    freshKeys: ReadonlySet<string>;
    actions: ScratchpadPanelActions;
    listRef: React.Ref<HTMLDivElement>;
};

const ScratchpadList: React.FC<ScratchpadListProps> = ({ groups, freshKeys, actions, listRef }) => {
    const { t } = useTranslation();
    // 身份稳定，行不因为它重渲染（actions 本身由宿主保持稳定）。
    const rowActions = useMemo<ScratchpadRowActions>(() => ({
        play: entry => actions.play(entry),
        enqueue: entry => actions.enqueue([entry]),
        addToPlaylist: entry => actions.addToPlaylist([entry]),
        remove: entry => actions.remove([entry.key]),
    }), [actions]);
    const rowLabels = useMemo<ScratchpadRowLabels>(() => ({
        play: t('scratchpad.play'),
        enqueue: t('scratchpad.enqueue'),
        addToPlaylist: t('scratchpad.addToPlaylist'),
        remove: t('scratchpad.remove'),
    }), [t]);

    return (
        <div ref={listRef} className="scratchpad-list">
            {groups.map(group => {
                const sample = group.entries[0].song;
                const sourceLabel = actions.sourceLabel(sample);
                const canAdd = actions.canAddToPlaylist(sample);
                return (
                    <section key={group.key} className="scratchpad-list-group" data-scratchpad-group={group.key}>
                        <ScratchpadGroupHeader
                            label={sourceLabel}
                            count={group.entries.length}
                            canAddToPlaylist={canAdd}
                            onEnqueue={() => actions.enqueue(group.entries)}
                            onAddToPlaylist={() => actions.addToPlaylist(group.entries)}
                        />
                        <ul>
                            {group.entries.map(entry => (
                                <ScratchpadRow
                                    key={entry.key}
                                    entry={entry}
                                    canAddToPlaylist={canAdd}
                                    isFresh={freshKeys.has(entry.key)}
                                    actions={rowActions}
                                    labels={rowLabels}
                                />
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
};

export default ScratchpadList;
