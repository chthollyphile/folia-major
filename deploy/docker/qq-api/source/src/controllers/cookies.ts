import { Context, Next } from 'koa';
/*
 * @Author: Rainy [https://github.com/rain120]
 * @Date: 2021-01-23 15:41:41
 * @LastEditors: Rainy
 * @LastEditTime: 2021-06-19 22:22:31
 */
import { configManager } from '../config';

export default {
  get: async (ctx: Context, next: Next) => {
    const safeConfig = configManager.getSafeConfig();
    ctx.status = 200;
    const user = safeConfig.user as {
      cookie?: string;
      cookieList?: string[];
      cookieObject?: Record<string, string>;
    };
    ctx.body = {
      data: {
        code: 200,
        cookie: user.cookie,
        cookieList: user.cookieList,
        cookieObject: user.cookieObject,
      },
    };

    await next();
  },
  set: async (ctx: Context, next: Next) => {
    ctx.status = 403;
    ctx.body = {
      data: {
        code: 403,
        message: 'Setting cookie dynamically is disabled for security reasons.',
      },
    };
    await next();
  },
};
