import services from '../services';

const { songLists } = services;

/**
 * @description: 2, 3
 * @param {page} 页数
 * @param {limit} 每页条数[20, 60]
 * @param {categoryId} 分类
 * @param {sortId} 分类
 * @return:
 */
import { Context } from 'koa';

export default async (ctx: Context) => {
  const {
    limit: ein = 19,
    page: sin = 0,
    sortId = 5,
    categoryIds = [10000000],
  } = (ctx.request as { body: Record<string, unknown> }).body;

  const params = {
    sortId,
    sin,
    ein,
  };

  const props = {
    method: 'get',
    option: {},
    params,
  };

  const data = await Promise.all(
    (categoryIds as string[]).map(
      async (categoryId: string) =>
        await songLists({
          ...props,
          params: {
            ...params,
            categoryId,
          },
        }).then(
          (res: {
            status?: number;
            body: {
              response?: { code?: number | string; data?: unknown; [key: string]: unknown };
              error?: unknown;
            };
          }) => {
            if (res.body?.response && +(res.body.response.code || 1) === 0) {
              return res.body.response.data;
            } else {
              return res.body?.response;
            }
          },
        ),
    ),
  );
  Object.assign(ctx, {
    body: {
      status: 200,
      data,
    },
  });
};
