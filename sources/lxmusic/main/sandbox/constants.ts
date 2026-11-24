// sources/lxmusic/main/sandbox/constants.ts
// 沙箱页面和 main 入口两边都要认的两个地址。单独一个文件，main 入口引它时不把页面里的运行环境也打进去。

/** 页面的地址；分区的 http(s) 全由 main 入口本地应答，这个主机名不会被解析。 */
export const SANDBOX_ORIGIN = 'https://lx-sandbox.invalid';
/** `lx.request` 发往的地址：main 入口接住，交给受控出口。 */
export const REQUEST_PATH = '/__lx/request';
