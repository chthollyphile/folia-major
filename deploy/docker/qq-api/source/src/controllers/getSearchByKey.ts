import { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';

const { getSearchByKey } = services;

interface SearchByKeyQuery {
  key: string;
  limit?: string | number;
  page?: string | number;
  catZhida?: string | number;
  remoteplace?: string;
}

export default async (ctx: Context) => {
  const query = getTypedQuery<SearchByKeyQuery>(ctx);
  const { key: w, limit: n, page: p, catZhida, remoteplace = 'song' } = query;
  const props = {
    method: 'get',
    params: {
      // w：搜索关键字
      // p：当前页
      // n：每页歌曲数量
      // catZhida: 0表示歌曲, 2表示歌手, 3表示专辑, 4, 5
      w,
      n: Number(n) || 10,
      p: Number(p) || 1,
      catZhida: Number(catZhida) || 1,
      remoteplace: `txt.yqq.${remoteplace}`,
    },
    option: {},
  };
  if (w) {
    const { status, body } = await getSearchByKey(props);
    Object.assign(ctx, {
      status,
      body,
    });
  } else {
    ctx.status = 400;
    ctx.body = {
      response: 'search key is null',
    };
  }
};
