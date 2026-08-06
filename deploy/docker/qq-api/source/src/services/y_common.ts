import { AxiosRequestConfig } from 'axios';
import { apiConfig, requestConfig } from '../config';
import { BaseYCommonParams } from '../types/core/request';
import { logger } from '../util/logger';
import request from '../util/request';

export default ({
  url,
  method = 'get',
  options = {},
  hasCommonParams = true,
}: BaseYCommonParams) => {
  const commonParams = hasCommonParams ? apiConfig.commonParams : {};
  const opts: AxiosRequestConfig = Object.assign({}, options, commonParams, {
    headers: {
      referer: requestConfig.referer.c,
      host: 'c.y.qq.com',
      ...options.headers,
    },
  });
  logger.debug(url, { opts });
  return request(url, method, opts);
};
