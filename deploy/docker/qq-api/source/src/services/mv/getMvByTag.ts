import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetMvByTagParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/mv/fcgi-bin/getmv_by_tag';

export default ({ method = 'get', params = {}, option = {} }: GetMvByTagParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'GB2312',
    cmd: 'shoubo',
    lan: 'all',
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getMvByTag', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getMvByTag', upstream, response, {
        cmd: data.cmd,
        lan: data.lan,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getMvByTag', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
