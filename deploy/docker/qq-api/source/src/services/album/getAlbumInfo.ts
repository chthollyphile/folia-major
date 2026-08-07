import { BaseServiceParams, BaseServiceResponse } from '../../types/core/request';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

export interface GetAlbumInfoParams extends BaseServiceParams {}

const upstream = '/v8/fcg-bin/fcg_v8_album_info_cp.fcg';

export default ({
  method = 'get',
  params = {},
  options = {},
}: GetAlbumInfoParams): Promise<BaseServiceResponse> => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
  });
  const opts = Object.assign(options, {
    params: data,
  });
  logServiceRequest('getAlbumInfo', upstream, data);
  return y_common({
    url: upstream,
    method,
    options: opts,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getAlbumInfo', upstream, response);
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getAlbumInfo', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
