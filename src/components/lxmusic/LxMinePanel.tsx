import React, { useState, useSyncExternalStore } from 'react';
import { Button, TextField } from '../ui';
import { ArrowLeft, ListPlus, Play, Plus, Trash2, X } from 'lucide-react';
import type { UnifiedSong } from '../../types';
import { LxTrackList } from './LxTrackList';
import {
    createLxSavedPlaylist,
    deleteLxSavedPlaylist,
    fromSavedSong,
    getLxSavedPlaylists,
    removeSongFromLxPlaylist,
    subscribeLxSavedPlaylists,
    type LxSavedPlaylist,
} from '../../services/onlineMusic/lxmusic/lxSavedPlaylists';
import './lxWorkspace.css';

// src/components/lxmusic/LxMinePanel.tsx
// 工作台的「我的」页：自建的收藏列表（本机保存，重启照旧在）。
//   列表页：新建一个列表、点开列表、删掉列表；点开之后是曲目表，可以播、加队列、移出列表。
//   曲目只是「够重建一首歌」的最小字段，打开列表不再回平台查一遍，断网也能看见自己收过什么。

type LxMinePanelProps = {
    onPlay: (song: UnifiedSong) => void;
    onQueue: (song: UnifiedSong) => void;
    onNotice: (message: string) => void;
};

const countLabel = (playlist: LxSavedPlaylist): string => `${playlist.songs.length} 首`;

export const LxMinePanel: React.FC<LxMinePanelProps> = ({ onPlay, onQueue, onNotice }) => {
    const playlists = useSyncExternalStore(subscribeLxSavedPlaylists, getLxSavedPlaylists, getLxSavedPlaylists);
    const [name, setName] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    const opened = openId ? playlists.find((playlist) => playlist.id === openId) ?? null : null;

    const handleCreate = () => {
        const created = createLxSavedPlaylist(name);
        if (!created) {
            onNotice(name.trim() ? '列表数量到上限了，先删掉一个再建。' : '先给列表起个名字。');
            return;
        }
        setName('');
        setOpenId(created.id);
        onNotice(`已新建列表「${created.name}」，之后在任意曲目行点「收进列表」就能往里加歌。`);
    };

    if (opened) {
        const songs: UnifiedSong[] = opened.songs.map(fromSavedSong);
        return (
            <>
                <div className="lx-detail-head">
                    <Button type="button" className="lx-icon-btn" onClick={() => setOpenId(null)} aria-label="返回列表" title="返回列表">
                        <ArrowLeft size={16} />
                    </Button>
                    <div className="lx-detail-text">
                        <div className="lx-detail-kind">收藏列表 · 本机保存</div>
                        <div className="lx-detail-title">{opened.name}</div>
                        <div className="lx-detail-sub">{countLabel(opened)}，下次打开还在。</div>
                    </div>
                </div>
                {songs.length === 0 ? (
                    <p className="lx-empty">这个列表还是空的。在歌单 / 搜索 / 榜单的曲目行点「收进列表」，选这个列表就行。</p>
                ) : (
                    <LxTrackList
                        songs={songs}
                        onPlay={onPlay}
                        onQueue={onQueue}
                        onRemove={(song) => {
                            removeSongFromLxPlaylist(opened.id, String(song.id));
                            onNotice(`已从「${opened.name}」移出 ${song.name}`);
                        }}
                    />
                )}
            </>
        );
    }

    return (
        <>
            <div className="lx-search-row">
                <TextField
                    className="lx-input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') handleCreate(); }}
                    placeholder="给新收藏列表起个名字，建好就能往里收歌"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
                <Button type="button" className="lx-btn" onClick={handleCreate} disabled={!name.trim()}>
                    <ListPlus size={15} />
                    新建列表
                </Button>
            </div>
            {playlists.length === 0 ? (
                <p className="lx-empty">
                    还没有收藏列表。建一个之后，把想下次接着听的歌收进去——
                    存在本机，重启、断网都能打开，不跟账号走。
                </p>
            ) : (
                <div className="lx-grid">
                    {playlists.map((playlist) => {
                        const confirming = pendingDelete === playlist.id;
                        return (
                            <div key={playlist.id} className="lx-card">
                                <button
                                    type="button"
                                    className="lx-cover lx-cover-plain"
                                    onClick={() => setOpenId(playlist.id)}
                                    title={`打开「${playlist.name}」`}
                                >
                                    <ListPlus size={28} />
                                    <span className="lx-cover-count">{playlist.songs.length}</span>
                                </button>
                                <div className="lx-card-title">{playlist.name}</div>
                                <div className="lx-card-meta">{countLabel(playlist)} · 本机</div>
                                <div className="lx-track-actions" style={{ marginTop: 6 }}>
                                    <Button type="button" className="lx-act" data-primary="true"
                                        onClick={() => setOpenId(playlist.id)}
                                        disabled={playlist.songs.length === 0}
                                        title={playlist.songs.length === 0 ? '空列表，先进歌再播' : `播放「${playlist.name}」`}
                                        aria-label={`播放 ${playlist.name}`}
                                    >
                                        <Play size={15} />
                                    </Button>
                                    <Button type="button" className="lx-act"
                                        onClick={() => { setOpenId(playlist.id); onNotice('在列表里点曲目右侧的 × 可以移出。'); }}
                                        title="打开列表"
                                        aria-label={`打开 ${playlist.name}`}
                                    >
                                        <Plus size={15} />
                                    </Button>
                                    <Button
                                        type="button"
                                        className="lx-act"
                                        onClick={() => {
                                            if (!confirming) {
                                                setPendingDelete(playlist.id);
                                                onNotice(`再点一次「确认删除」就会删掉「${playlist.name}」`);
                                                return;
                                            }
                                            deleteLxSavedPlaylist(playlist.id);
                                            setPendingDelete(null);
                                            onNotice(`已删除列表「${playlist.name}」`);
                                        }}
                                        title={confirming ? '确认删除' : '删除列表'}
                                        aria-label={`删除 ${playlist.name}`}
                                    >
                                        {confirming ? <X size={15} /> : <Trash2 size={15} />}
                                    </Button>
                                </div>
                                {confirming ? <div className="lx-card-meta" data-kind="warn">再点一次右侧按钮即删除</div> : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
};

export default LxMinePanel;
