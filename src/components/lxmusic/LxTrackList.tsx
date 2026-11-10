import React from 'react';
import { Button } from '../ui';
import { BookmarkPlus, Play, Plus, X } from 'lucide-react';
import type { UnifiedSong } from '../../types';
import { formatDuration, platformBadge, platformOfSong } from './lxUi';

// src/components/lxmusic/LxTrackList.tsx
// 洛雪工作台里的曲目行：序号、歌名、歌手·专辑、平台徽标、时长、播放 / 加入队列。
// 「收进列表」只在给了 onSave 的页面出现（工作台里收进本机收藏列表）；
// 「移出」只在列表自己的详情页出现。

type LxTrackListProps = {
    songs: UnifiedSong[];
    onPlay: (song: UnifiedSong) => void;
    onQueue: (song: UnifiedSong) => void;
    /** 给了就在每一行多一个「收进列表」按钮。 */
    onSave?: (song: UnifiedSong) => void;
    /** 给了就在每一行多一个「移出」按钮（收藏列表详情用）。 */
    onRemove?: (song: UnifiedSong) => void;
};

const artistLabel = (song: UnifiedSong): string => {
    const names = song.artists.map((artist) => artist.name).filter(Boolean);
    return names.length > 0 ? names.join(' / ') : '未知歌手';
};

export const LxTrackList: React.FC<LxTrackListProps> = ({ songs, onPlay, onQueue, onSave, onRemove }) => (
    <div className="lx-tracks">
        {songs.map((song, index) => {
            const badge = platformBadge(platformOfSong(song));
            const album = song.album?.name;
            return (
                <div key={`${String(song.id)}-${index}`} className="lx-track">
                    <span className="lx-track-index">{index + 1}</span>
                    <div className="lx-track-main">
                        <div className="lx-track-name">{song.name}</div>
                        <div className="lx-track-sub">
                            {artistLabel(song)}
                            {album ? ` · ${album}` : ''}
                        </div>
                    </div>
                    <span className="lx-badge" style={{ color: badge.color }}>{badge.label}</span>
                    <span className="lx-track-dur">{formatDuration(song.durationMs)}</span>
                    <div className="lx-track-actions">
                        <Button type="button" className="lx-act" data-primary="true"
                            onClick={() => onPlay(song)} aria-label={`播放 ${song.name}`} title="播放">
                            <Play size={15} />
                        </Button>
                        <Button type="button" className="lx-act"
                            onClick={() => onQueue(song)} aria-label={`把 ${song.name} 加入队列`} title="加入队列">
                            <Plus size={15} />
                        </Button>
                        {onSave ? (
                            <Button type="button" className="lx-act"
                                onClick={() => onSave(song)}
                                aria-label={`把 ${song.name} 收进收藏列表`}
                                title="收进列表">
                                <BookmarkPlus size={15} />
                            </Button>
                        ) : null}
                        {onRemove ? (
                            <Button type="button" className="lx-act"
                                onClick={() => onRemove(song)}
                                aria-label={`把 ${song.name} 移出列表`}
                                title="移出列表">
                                <X size={15} />
                            </Button>
                        ) : null}
                    </div>
                </div>
            );
        })}
    </div>
);

export default LxTrackList;
