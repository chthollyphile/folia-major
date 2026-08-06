import { AxiosRequestConfig } from 'axios';
import moment from 'moment';
import { logServiceFailure, logServiceRequest, logServiceSuccess } from '../../util/observability';
import y_common from '../y_common';

interface GetSingerStarNumParams {
  method?: string;
  params?: Record<string, unknown>;
  option?: AxiosRequestConfig;
}

const upstream = '/rsc/fcgi-bin/fcg_order_singer_getnum.fcg';

export default ({ method = 'get', params = {}, option = {} }: GetSingerStarNumParams) => {
  const data = Object.assign(params, {
    format: 'json',
    outCharset: 'utf-8',
    utf8: 1,
    rnd: moment().valueOf(),
  });
  const options = Object.assign(option, {
    params: data,
  });
  logServiceRequest('getSingerStarNum', upstream, data);
  return y_common({
    url: upstream,
    method,
    options,
  })
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      logServiceSuccess('getSingerStarNum', upstream, response, {
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
      logServiceFailure('getSingerStarNum', upstream, error, data);
      return {
        status: 500,
        body: {
          error,
        },
      };
    });
};
