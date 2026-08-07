import services from '../services';

const { UCommon } = services;

// area_id=15&version_id=7
import { Context } from 'koa';

export default async (ctx: Context) => {
  // BUGFIX: https://github.com/Rain120/qq-music-api/issues/16#issuecomment-638230301
  const { area_id = 15, version_id = 7, limit = 20, page = 0 } = ctx.query;
  const start = (+page ? +page - 1 : 0) * +limit;
  const data = {
    comm: {
      ct: 24,
    },
    mv_tag: {
      module: 'MvService.MvInfoProServer',
      method: 'GetAllocTag',
      param: {},
    },
    mv_list: {
      module: 'MvService.MvInfoProServer',
      method: 'GetAllocMvInfo',
      param: {
        start,
        limit: +limit,
        version_id,
        area_id,
        order: 1,
      },
    },
  };
  const params = Object.assign({
    format: 'json',
    data: JSON.stringify(data),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };
  if (version_id && area_id) {
    await UCommon(props)
      .then((res: import('axios').AxiosResponse<any>) => {
        const response = res.data;
        ctx.status = 200;
        ctx.body = {
          response,
        };
      })
      .catch((error: unknown) => {
        throw error;
      });
  } else {
    ctx.status = 400;
    ctx.body = {
      response: 'version_id or area_id is null',
    };
  }
};
