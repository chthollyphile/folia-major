/*
 * @Author: Rainy [https://github.com/rain120]
 * @Date: 2021-01-23 16:19:21
 * @LastEditors: Rainy
 * @LastEditTime: 2021-06-19 22:20:01
 */

import { Context, Next } from 'koa';
import { userInfo } from '../config';

export default () => async (ctx: Context, next: Next) => {
  if (userInfo.cookie) {
    (ctx.request as unknown as { cookie: string }).cookie = userInfo.cookie;
  }

  const cookieHeader = ctx.request.headers;

  if (cookieHeader && userInfo.cookieList) {
    userInfo.cookieList.forEach((cookie: string) => {
      const [key, value = ''] = cookie.split('=');

      if (value) {
        ctx.cookies.set(key, value.trim(), {
          maxAge: 24 * 60 * 60 * 1000,
          // overwirte: true,
        });
      }
    });
  }

  await next();
};
