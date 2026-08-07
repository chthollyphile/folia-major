import services from '../services';

const { UCommon } = services;

// -100 默认值 all
// area [1 - 6]
// sex 0 男 1 女 2 组合
// genre [1 - 20]
// index a-z # 1-27
import { Context } from 'koa';
import { commonParams } from '../config';

export default async (ctx: Context) => {
  const { area = -100, sex = -100, genre = -100, index = -100, page = 1 } = ctx.query;
  const data = {
    comm: {
      ct: 24,
      cv: 0,
    },
    singerList: {
      module: 'Music.SingerListServer',
      method: 'get_singer_list',
      param: {
        area: +area,
        sex: +sex,
        genre: +genre,
        index: +index,
        sin: (Number(page) - 1) * 80,
        cur_page: +page,
      },
    },
  };
  const params = Object.assign(commonParams, {
    format: 'json',
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
        status: 200,
        response,
      };
    })
    .catch((error: unknown) => {
      throw error;
    });
};
