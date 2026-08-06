import services from '../services';

const { downloadQQMusic } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const props = {
    method: 'get',
    params: {},
    option: {},
  };
  const { status, body } = await downloadQQMusic(props);
  Object.assign(ctx, {
    status,
    body,
  });
};
