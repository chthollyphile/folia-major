import services from '../services';

const { getTopLists } = services;

import { Context } from 'koa';
import { commonParams } from '../config';

export default async (ctx: Context) => {
  const props = {
    method: 'get',
    params: commonParams,
    option: {},
  };
  const { status, body } = await getTopLists(props);
  Object.assign(ctx, {
    status,
    body,
  });
};
