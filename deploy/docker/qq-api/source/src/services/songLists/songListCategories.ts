import { AxiosRequestConfig } from 'axios';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface SongListCategoriesParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/splcloud/fcgi-bin/fcg_get_diss_tag_conf.fcg';

export default ({ method = 'get', params = {}, option = {} }: SongListCategoriesParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('songListCategories', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('songListCategories', upstream, response);
      return {
        status: 200,
        body: {
          response,
        },
      };
    })
    .catch((error: unknown) => {
      logServiceFailure('songListCategories', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
