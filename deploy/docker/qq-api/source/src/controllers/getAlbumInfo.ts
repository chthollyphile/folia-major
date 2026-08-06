import services from '../services';

const { getAlbumInfo } = services;

// albummid=0016l2F430zMux
import { Context } from 'koa';

export default async (ctx: Context) => {
  const { albummid } = ctx.query;
  const props = {
    method: 'get',
    params: {
      albummid,
    },
    option: {},
  };
  if (albummid) {
    const { status, body } = await getAlbumInfo(props);
    Object.assign(ctx, {
      status,
      body,
    });
  } else {
    ctx.status = 400;
    ctx.body = {
      data: {
        message: 'no albummid',
      },
    };
  }
};
