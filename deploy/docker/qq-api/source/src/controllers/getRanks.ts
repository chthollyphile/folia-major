import services from '../services';

const { UCommon } = services;

import { Context } from 'koa';
import moment from 'moment';
import { commonParams } from '../config';
import { getTypedQuery } from '../types/core/request';

interface RanksQuery {
  topId?: string | number;
  limit?: string | number;
  page?: string | number;
  period?: string;
}

export default async (ctx: Context) => {
  // Desc: https://github.com/Rain120/qq-music-api/issues/14
  // 1. topId is useless
  // 2. qq api period is change not YYYY-MM-DD
  const query = getTypedQuery<RanksQuery>(ctx);
  const topId = +(query.topId || 4);
  const num = +(query.limit || 20);
  const offset = +(query.page || 0);
  const date = query.period || moment().format('YYYY-MM-DD');
  const week = moment(date).isoWeek();
  const year = moment(date).year();
  const period = `${year}_${week}`;

  const data = {
    comm: {
      ...(commonParams || {}),
      cv: 4747474,
      ct: 24,
      format: 'json',
      inCharset: 'utf-8',
      needNewCode: 1,
      uin: 0,
    },
    req_1: {
      module: 'musicToplist.ToplistInfoServer',
      method: 'GetDetail',
      param: {
        topId,
        offset,
        num,
        period,
      },
    },
    // TODO: 新评论，之后迭代更新再说
    // req_2: {
    // 	module: 'music.globalComment.CommentReadServer',
    // 	method: 'GetNewCommentList',
    // 	param: {
    // 		BizType: 4,
    // 		BizId: '59',
    // 		LastCommentSeqNo: '',
    // 		PageSize: 25,
    // 		PageNum: 0,
    // 		FromCommentId: '',
    // 		WithHot: 1,
    // 	},
    // },
    // TODO: 热门评论，之后迭代更新再说
    // req_3: {
    // 	module: 'music.globalComment.CommentReadServer',
    // 	method: 'GetHotCommentList',
    // 	param: {
    // 		BizType: 4,
    // 		BizId: '59',
    // 		LastCommentSeqNo: '',
    // 		PageSize: 15,
    // 		PageNum: 0,
    // 		HotType: 2,
    // 		WithAirborne: 1,
    // 	},
    // },
  };
  const params = Object.assign({
    format: 'json',
    data: JSON.stringify(data),
  });
  const props = {
    method: 'get',
    params,
    option: {},
  };
  await UCommon(props)
    .then((res: import('axios').AxiosResponse<any>) => {
      const response = res.data;
      ctx.status = 200;
      ctx.body = {
        response,
      };
    })
    .catch((error: unknown) => {
      throw error;
    });
};
