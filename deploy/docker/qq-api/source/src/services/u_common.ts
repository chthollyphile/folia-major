import { AxiosRequestConfig } from 'axios';
import { apiConfig, requestConfig } from '../config';
import { BaseUCommonParams } from '../types/core/request';
import { logger } from '../util/logger';
import request from '../util/request';

export default ({ options = {}, method = 'get' }: BaseUCommonParams) => {
  const opts: AxiosRequestConfig = Object.assign({}, options, apiConfig.commonParams, {
    headers: {
      referer: requestConfig.referer.u,
      host: 'u.y.qq.com',
      'content-type': 'application/x-www-form-urlencoded',
      ...options.headers,
    },
  });
  logger.debug(requestConfig.baseURL.u, { opts });
  return request(requestConfig.baseURL.u, method, opts, 'u');
};
