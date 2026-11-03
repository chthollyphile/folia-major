import React, { memo, useState } from 'react';
import { ListPlus, Music2, Play, Star, X } from 'lucide-react';
import type { ScratchpadEntry } from '../../../stores/useScratchpadStore';
import { getSongArtistLabel, getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';

// src/components/app/scratchpad/ScratchpadRow.tsx
// 速记簿列表的一行：封面、标题、歌手 · 从哪收来的（来源写在组头上）；悬停 / 聚焦时出现四个动作（播放、加入队列、加入歌单、移除）。
// 点标题播放：插进当前队列播放，不换队列（宿主的 playNow）。

export type ScratchpadRowActions = {
    play: (entry: ScratchpadEntry) => void;
    enqueue: (entry: ScratchpadEntry) => void;
    addToPlaylist: (entry: ScratchpadEntry) => void;
    remove: (entry: ScratchpadEntry) => void;
};

export type ScratchpadRowLabels = {
    play: string;
    enqueue: string;
    addToPlaylist: string;
    remove: string;
};

type ScratchpadRowProps = {
    entry: ScratchpadEntry;
    canAddToPlaylist: boolean;
    isFresh: boolean;
    actions: ScratchpadRowActions;
    labels: ScratchpadRowLabels;
};

const ScratchpadRow: React.FC<ScratchpadRowProps> = ({ entry, canAddToPlaylist, isFresh, actions, labels }) => {
    const { song } = entry;
    const coverUrl = getSongCoverUrl(song);
    // 本地歌的封面是上次启动的 blob 地址，重启后就读不到了：读不到时换成占位图标。
    const [coverFailed, setCoverFailed] = useState(false);
    const artist = getSongArtistLabel(song);
    const rowActions = [
        { id: 'enqueue', label: labels.enqueue, icon: ListPlus, run: actions.enqueue },
        ...(canAddToPlaylist ? [{ id: 'add-to-playlist', label: labels.addToPlaylist, icon: Star, run: actions.addToPlaylist }] : []),
        { id: 'remove', label: labels.remove, icon: X, run: actions.remove },
    ];

    return (
        <li className={`scratchpad-row${isFresh ? ' is-fresh' : ''}`} data-scratchpad-key={entry.key}>
            <span className="scratchpad-cover" aria-hidden="true">
                {coverUrl && !coverFailed
                    ? <img src={coverUrl} alt="" loading="lazy" decoding="async" onError={() => setCoverFailed(true)} />
                    : <span className="grid h-full w-full place-items-center opacity-50"><Music2 size={16} /></span>}
            </span>
            <button
                type="button"
                className="scratchpad-song"
                title={labels.play}
                onClick={() => actions.play(entry)}
            >
                <span className="scratchpad-name">{song.name}</span>
                <span className="scratchpad-meta">{[artist, entry.origin?.label].filter(Boolean).join(' · ')}</span>
            </button>
            <span className="scratchpad-row-actions">
                <button
                    type="button"
                    className="scratchpad-icon-button"
                    data-scratchpad-action="play"
                    title={labels.play}
                    aria-label={labels.play}
                    onClick={() => actions.play(entry)}
                >
                    <Play aria-hidden="true" />
                </button>
                {rowActions.map(({ id, label, icon: Icon, run }) => (
                    <button
                        key={id}
                        type="button"
                        className="scratchpad-icon-button"
                        data-scratchpad-action={id}
                        title={label}
                        aria-label={label}
                        onClick={event => {
                            // 鼠标点的：这一行可能马上消失（移除），焦点别留在按钮上露出聚焦框。
                            if (event.detail > 0) event.currentTarget.blur();
                            run(entry);
                        }}
                    >
                        <Icon aria-hidden="true" />
                    </button>
                ))}
            </span>
        </li>
    );
};

export default memo(ScratchpadRow);
