'use strict';

// sources/netease/main/networkErrorText.cjs
// 宿主 shared/networkErrorText.cjs 的一份拷贝（音源模组不 import 宿主的代码），两边照样。
// 网络错误文字的识别，Electron 主进程用；渲染进程用 shared/networkErrorText.mjs，两份内容须保持一致
// （test/unit/shared/networkErrorText.test.ts 对照两份的输出）。
// 网易上游 request 把 axios 的网络错误 reject 成 { status: 502, body: { code: 502, msg: err.message } }，丢了 err.code，
// 只能按 Node 的错误文字认。

// Node 里 code 为 ECONNRESET 的几种 message：读时被重置、对端直接挂断、TLS 握手前被断开。
const CONNECTION_RESET_PATTERN = /ECONNRESET|socket hang up|socket disconnected before secure TLS connection/i;

// 请求没拿到任何 HTTP 响应的几类网络层失败：被重置、超时、拒绝连接、DNS 失败、路由不可达、写到已关闭的连接。
const NETWORK_FAILURE_PATTERN = /ECONNRESET|socket hang up|socket disconnected before secure TLS connection|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|timeout of \d+ms exceeded/i;

/** 错误文字是否表示连接被对端重置。 */
const isConnectionResetMessage = (text) => CONNECTION_RESET_PATTERN.test(String(text ?? ''));

/** 错误文字是否表示网络层失败（没有拿到 HTTP 响应）；这类失败换个时刻重发往往就能成功。 */
const isNetworkFailureMessage = (text) => NETWORK_FAILURE_PATTERN.test(String(text ?? ''));

module.exports = {
    isConnectionResetMessage,
    isNetworkFailureMessage,
};
