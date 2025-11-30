import React from 'react';
import { SongResult } from '../types';

/**
 * 格式化歌曲名称显示，包含 alia 和 tns 信息
 * @param song 歌曲对象
 * @returns React 元素，包含歌曲名称和别名/翻译名
 */
export const formatSongName = (song: SongResult): React.ReactNode => {
  const hasAlia = song.alia && song.alia.length > 0;
  const hasTns = song.tns && song.tns.length > 0;
  const aliaText = hasAlia ? song.alia[0] : null;
  const tnsText = hasTns ? song.tns[0] : null;

  // 如果都没有，只返回歌曲名
  if (!hasAlia && !hasTns) {
    return <span>{song.name}</span>;
  }

  // 如果只有 alia，在名字后面用括号显示
  if (hasAlia && !hasTns) {
    return (
      <span>
        {song.name}
        <span className="opacity-60 font-normal"> ({aliaText})</span>
      </span>
    );
  }

  // 如果只有 tns，在名字后面用括号显示
  if (!hasAlia && hasTns) {
    return (
      <span>
        {song.name}
        <span className="opacity-60 font-normal"> ({tnsText})</span>
      </span>
    );
  }

  // 如果都有，alia 在名字后面用括号显示，tns 显示在下一行
  return (
    <span className="block">
      <span>
        {song.name}
        <span className="opacity-60 font-normal"> ({aliaText})</span>
      </span>
      <span className="block text-xs opacity-50 font-normal mt-0.5">{tnsText}</span>
    </span>
  );
};

