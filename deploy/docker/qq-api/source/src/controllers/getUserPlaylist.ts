import type { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';
import { getAuthToken } from './login';

interface UserPlaylistQuery {
  uid?: string;
}

export default async (ctx: Context): Promise<void> => {
  const { uid } = getTypedQuery<UserPlaylistQuery>(ctx);
  const data = await services.getUserPlaylist({ token: getAuthToken(ctx), uin: uid });
  if (!data) {
    ctx.status = 401;
    ctx.body = { code: 401, message: 'Login required' };
    return;
  }
  const playlist = Array.isArray(data.v_playlist) ? data.v_playlist : [];
  ctx.status = 200;
  ctx.body = {
    code: 200,
    playlist,
    total: typeof data.total === 'number' ? data.total : playlist.length,
    more: data.bFinish === false,
  };
};
