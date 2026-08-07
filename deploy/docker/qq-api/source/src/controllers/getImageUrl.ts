/*
 * @Author: Rainy
 * @Date: 2020-05-24 12:12:03
 * @LastEditors: Rainy
 * @LastEditTime: 2020-05-24 12:51:23
 */

/**
 * @description 获取图片地址
 * @param {歌曲 mid / pmid, 专辑 albumMID} id
 * @param {string} size 图片大小 default 300x300
 * @param {number} maxAge default 2592000
 */
import { Context } from 'koa';

export default (ctx: Context) => {
  const { id, size = '300x300', maxAge = 2592000 } = ctx.query;
  if (!id) {
    ctx.status = 400;
    ctx.body = {
      response: 'no id~~',
    };
    return;
  }
  const body = {
    response: {
      code: 0,
      data: {
        imageUrl: `https://y.gtimg.cn/music/photo_new/T002R${size}M000${id}.jpg?max_age=${maxAge}`,
      },
    },
  };
  Object.assign(ctx, {
    status: 200,
    body,
  });
};
