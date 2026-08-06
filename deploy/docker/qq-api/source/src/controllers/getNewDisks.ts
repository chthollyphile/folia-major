import services from '../services';

const { UCommon } = services;

import { Context } from 'koa';

export default async (ctx: Context) => {
  const page = +(ctx.query as Record<string, string>).page || 1;
  const num = +(ctx.query as Record<string, string>).limit || 20;
  const start = (page - 1) * num;
  const data = {
    new_album: {
      module: 'newalbum.NewAlbumServer',
      method: 'get_new_album_info',
      param: {
        area: 1,
        start,
        num,
      },
    },
    comm: {
      ct: 24,
      cv: 0,
    },
  };
  if (!start) {
    data.new_album = {
      module: 'newalbum.NewAlbumServer',
      method: 'get_new_album_area',
      param: { area: 1, start: 0, num: 0 },
    };
  }
  const params = Object.assign({
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
