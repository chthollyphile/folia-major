import services from '../services';

const { getDigitalAlbumLists } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const props = {
    method: 'get',
    params: {},
    option: {},
  };
  const { status, body } = await getDigitalAlbumLists(props);
  Object.assign(ctx, {
    status,
    body,
  });
};
