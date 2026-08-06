import services from '../services';

const { getMvByTag } = services;

// songmid=001CLC7W2Gpz4J
import { Context } from 'koa';

export default async (ctx: Context) => {
  const props = {
    method: 'get',
    params: {},
    option: {},
  };
  const { status, body } = await getMvByTag(props);
  Object.assign(ctx, {
    status,
    body,
  });
};
