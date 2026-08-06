import { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';

const { getLyric } = services;

interface LyricQuery {
  songmid: string;
  isFormat?: string;
}

export default async (ctx: Context) => {
  // songmid=003rJSwm3TechU
  const { songmid, isFormat } = getTypedQuery<LyricQuery>(ctx);
  const props = {
    method: 'get',
    params: {
      songmid,
    },
    option: {},
    isFormat: isFormat === 'true' || isFormat === '1',
  };
  if (songmid) {
    const { status, body } = await getLyric(props);
    Object.assign(ctx, {
      status,
      body,
    });
  } else {
    ctx.status = 400;
    ctx.body = {
      response: 'no songmid',
    };
  }
};
