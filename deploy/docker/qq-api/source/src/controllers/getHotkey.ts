import services from '../services';

const { getHotKey } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const props = {
    method: 'get',
    params: {},
    option: {},
  };
  const { status, body } = await getHotKey(props);
  Object.assign(ctx, {
    status,
    body,
  });
};
