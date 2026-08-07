import services from '../services';

const { getSingerStarNum } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const { singermid } = ctx.query;
  const props = {
    method: 'get',
    params: {
      singermid,
    },
    option: {},
  };
  if (singermid) {
    const { status, body } = await getSingerStarNum(props);
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
