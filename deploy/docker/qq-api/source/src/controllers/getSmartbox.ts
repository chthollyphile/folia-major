import services from '../services';

const { getSmartbox } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const { key } = ctx.query;
  const props = {
    method: 'get',
    params: {
      key,
    },
    option: {},
  };
  if (key) {
    const { status, body } = await getSmartbox(props);
    Object.assign(ctx, {
      status,
      body,
    });
  } else {
    ctx.status = 200;
    ctx.body = {
      response: null,
    };
  }
};
