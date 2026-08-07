import services from '../services';

const { getSingerDesc } = services;

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
    const { status, body } = await getSingerDesc(props);
    Object.assign(ctx, {
      status,
      body,
    });
  } else {
    ctx.status = 400;
    ctx.body = {
      status: 400,
      response: 'no singermid',
    };
  }
};
