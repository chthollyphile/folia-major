import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetSearchByKeyParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/soso/fcgi-bin/client_search_cp';

export default ({ method = 'get', params = {}, option = {} }: GetSearchByKeyParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    ct: 24,
    qqmusic_ver: 1298,
    new_json: 1,
    remoteplace: 'txt.yqq.song',
    // searchid: 58932895599763136,
    t: 0,
    aggr: 1,
    cr: 1,
    lossless: 0,
    flag_qc: 0,
    platform: 'yqq.json',
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getSearchByKey', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getSearchByKey', upstream, response, {
        keyword: typeof data.w === 'string' ? data.w : undefined,
      });
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('getSearchByKey', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
