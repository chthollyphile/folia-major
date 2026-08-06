import services from '../services';

const { songListDetail } = services;

/**
 * @description: 2, 3
 * @param {page} 页数
 * @param {limit} 每页条数[20, 60]
 * @param {categoryId} 分类
 * @param {sortId} 分类
 * @return:
 */
import { Context } from 'koa';
import { getTypedParams, getTypedQuery } from '../types/core/request';

interface SongListDetailParams {
  disstid?: string;
}

export default async (ctx: Context) => {
  const path = getTypedParams<SongListDetailParams>(ctx);
  const query = getTypedQuery<SongListDetailParams>(ctx);
  const disstid = path.disstid ?? query.disstid;
  const props = {
    method: 'get',
    params: {
      disstid,
    },
    option: {},
  };
  const { status, body } = await songListDetail(props);
  Object.assign(ctx, {
    status,
    body,
  });
};
