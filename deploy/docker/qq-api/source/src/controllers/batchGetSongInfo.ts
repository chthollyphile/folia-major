import services from '../services';

const { UCommon } = services;

/**
 * @description: 2, 3
 * @param songs 歌曲信息 [[songmid, songid]]
 * @return:
 */
import { Context } from 'koa';
import { commonParams } from '../config';
import { logger } from '../util/logger';

export default async (ctx: Context) => {
  const { songs } = (ctx.request as { body: Record<string, unknown> }).body;

  const params = Object.assign(commonParams, {
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  });

  const props = {
    method: 'get',
    option: {},
    params,
  };

  const data = await Promise.all(
    ((songs as string[][]) || []).map(async (song: string[]) => {
      const [song_mid, song_id = ''] = song;
      logger.debug('batchGetSongInfo item', { song_mid, song_id });
      return await UCommon({
        ...props,
        params: {
          ...params,
          data: {
            comm: {
              ct: 24,
              cv: 0,
            },
            songinfo: {
              method: 'get_song_detail_yqq',
              param: {
                song_type: 0,
                song_mid,
                song_id,
              },
              module: 'music.pf_song_detail_svr',
            },
          },
        },
      }).then((res: { data: unknown }) => res.data);
    }),
  );
  Object.assign(ctx, {
    body: {
      status: 200,
      data,
    },
  });
};
