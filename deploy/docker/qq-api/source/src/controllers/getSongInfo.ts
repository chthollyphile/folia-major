import services from '../services';

const { UCommon } = services;

// songmid=001CLC7W2Gpz4J
import { Context } from 'koa';
import { commonParams } from '../config';
import { getTypedParams, getTypedQuery } from '../types/core/request';

interface SongInfoParams {
  songmid?: string;
  songid?: string;
}

export default async (ctx: Context) => {
  const path = getTypedParams<SongInfoParams>(ctx);
  const query = getTypedQuery<SongInfoParams>(ctx);
  const song_mid = path.songmid ?? query.songmid;
  const song_id = path.songid ?? query.songid ?? '';

  const params = Object.assign({}, commonParams, {
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
    data: JSON.stringify({
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
    }),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };

  await UCommon(props)
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      ctx.status = 200;
      ctx.body = {
        response,
      };
    })
    .catch((error: unknown) => {
      throw error;
    });
};
