import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { ScratchpadEntry, ScratchpadGroup } from '../../../stores/useScratchpadStore';
import { ListPlus, Star } from 'lucide-react';
import type { TFunction } from 'i18next';
import ScratchpadGroupHeader from './ScratchpadGroupHeader';
import type { ScratchpadAction } from './scratchpadModel';
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

/** 一个来源组的组头按钮（列表与画布同一份）：整组入队、整组加入歌单（这一组的来源允许时）。 */
export const sourceGroupButtons = (
    t: TFunction,
    canAddToPlaylist: boolean,
    onEnqueue: () => void,
    onAddToPlaylist: () => void,
): ScratchpadAction[] => [
    { id: 'enqueue-group', label: t('scratchpad.enqueueGroup'), icon: ListPlus, run: onEnqueue },
    ...(canAddToPlaylist ? [{ id: 'add-group-to-playlist', label: t('scratchpad.addGroupToPlaylist'), icon: Star, run: onAddToPlaylist }] : []),
];

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
                            mark="circle"
                            label={sourceLabel}
                            count={group.entries.length}
                            buttons={sourceGroupButtons(t, canAdd, () => actions.enqueue(group.entries), () => actions.addToPlaylist(group.entries))}
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
