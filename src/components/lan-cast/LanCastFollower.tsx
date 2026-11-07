import React, { useEffect, useState } from 'react';
import { usePlaybackStore, selectDisplaySong, selectDisplayCoverUrl } from '../../stores/usePlaybackStore';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import {
  castTrackToSpeaker,
  getCastingSpeaker,
  markPushedCast,
  readPushedCast,
  subscribeCasting,
} from '../../services/lanCast';

// src/components/lan-cast/LanCastFollower.tsx
// 全局的「投送跟随」：投送成功后歌变了就推给同一台音响。
//
// 这件事原来写在 LanCastControl 里，而那个组件只在播放页挂载 —— 投送后去歌单页、设置页听歌，
// 音响就不跟着换了。挪到 App 根部常驻，跨页面都生效。

const LanCastFollower: React.FC = () => {
  const song = usePlaybackStore(selectDisplaySong);
  const audioSrc = usePlaybackStore(state => state.audioSrc);
  const coverUrl = usePlaybackStore(selectDisplayCoverUrl);
  const [casting, setCasting] = useState(() => getCastingSpeaker());

  useEffect(() => subscribeCasting(() => setCasting(getCastingSpeaker())), []);

  useEffect(() => {
    if (!casting || !song || !audioSrc) return;
    const key = `${song.id}::${song.name}`;
    const pushed = readPushedCast();
    if (pushed.key === key && pushed.src === audioSrc) return;
    // 推送前先记账：失败也不该在每次渲染里重试，交回给用户手动重投。
    markPushedCast(key, audioSrc);
    void castTrackToSpeaker(casting, {
      url: audioSrc,
      title: song.name,
      artist: getSongArtistLabel(song),
      album: song.album?.name,
      // 音响只认公网可达的封面地址；协议地址（folia-*）与本地文件它拉不到。
      coverUrl: /^https:\/\//i.test(coverUrl || '') ? coverUrl ?? undefined : undefined,
      durationMs: song.durationMs,
    }).catch(() => {
      // 静默：投送面板会把错误显出来，后台不再重复打扰。
    });
  }, [audioSrc, casting, coverUrl, song]);

  return null;
};

export default LanCastFollower;
