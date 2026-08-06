import { Context } from 'koa';
import services from '../services';
import { getTypedQuery } from '../types/core/request';

const { UCommon } = services;

// singermid=0025NhlN2yWrP4

interface SingerHotsongQuery {
  singermid: string;
  limit?: string | number;
  page?: string | number;
}

export default async (ctx: Context) => {
  const query = getTypedQuery<SingerHotsongQuery>(ctx);
  const singermid = query.singermid;
  const num = +(query.limit || 5);
  const page = +(query.page || 0);
  const data = {
    comm: {
      ct: 24,
      cv: 0,
    },
    singer: {
      method: 'get_singer_detail_info',
      param: {
        sort: 5,
        singermid,
        sin: (page - 1) * num,
        num,
      },
      module: 'music.web_singer_info_svr',
    },
  };
  const params = Object.assign({
    format: 'json',
    singermid,
    data: JSON.stringify(data),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };
  if (singermid) {
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
      response: 'no singermid',
    };
  }
};
