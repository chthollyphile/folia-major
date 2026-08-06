import type { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

// src/controllers/getUserLikedSongs.ts

interface UserLikedSongsQuery {
  offset?: string;
  limit?: string;
}

export default async (ctx: Context): Promise<void> => {
  const query = getTypedQuery<UserLikedSongsQuery>(ctx);
  const offset = Math.max(0, Number.parseInt(query.offset ?? '0', 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? '100', 10) || 100));
  const data = await services.getUserLikedSongs({ token: getAuthToken(ctx), offset, limit });
  if (!data) {
    ctx.status = 401;
    ctx.body = { code: 401, message: 'Login required' };
    return;
  }
  const songs = Array.isArray(data.songlist) ? data.songlist : [];
  const total = typeof data.total_song_num === 'number' ? data.total_song_num : songs.length;
  ctx.status = 200;
  ctx.body = {
    code: 200,
    songs,
    total,
    more: data.hasmore === true || Number(data.hasmore) === 1 || offset + songs.length < total,
  };
};
