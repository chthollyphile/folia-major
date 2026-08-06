import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetHotKeyParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/splcloud/fcgi-bin/gethotkey.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetHotKeyParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    hostUin: 0,
    needNewCode: 0,
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getHotKey', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getHotKey', upstream, response);
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getHotKey', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
