import services from '../services';

const { UCommon } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const data = {
    comm: {
      ct: 24,
      cv: 0,
    },
    getFirstData: {
      module: 'mall.ticket_index_page_svr',
      method: 'GetTicketIndexPage',
      param: {
        city_id: -1,
      },
    },
    getTag: {
      module: 'mall.ticket_index_page_svr',
      method: 'GetShowTypeList',
      param: {},
    },
  };
  const params = Object.assign({
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'GB2312',
    platform: 'yqq.json',
    data: JSON.stringify(data),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };
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
};
