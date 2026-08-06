import services from '../services';

const { getRadioLists } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const props = {
    method: 'get',
    params: {},
    option: {},
  };
  const { status, body } = await getRadioLists(props);
  Object.assign(ctx, {
    status,
    body,
  });
};
