import services from '../services';

const { getSimilarSinger } = services;

// singermid=0025NhlN2yWrP4
import { Context } from 'koa';

export default async (ctx: Context) => {
  const { singermid: singer_mid } = ctx.query;
  const props = {
    method: 'get',
    params: {
      singer_mid,
    },
    option: {},
  };
  if (singer_mid) {
    const { status, body } = await getSimilarSinger(props);
    Object.assign(ctx, {
      status,
      body,
    });
  } else {
    ctx.status = 400;
    ctx.body = {
      response: 'no singermid',
    };
  }
};
