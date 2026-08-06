import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetSingerMvParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/mv/fcgi-bin/fcg_singer_mv.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetSingerMvParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    cid: 205360581,
    begin: 0,
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getSingerMv', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getSingerMv', upstream, response, {
        singermid: data.singermid,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getSingerMv', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
