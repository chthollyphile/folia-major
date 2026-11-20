# 本 Fork 的改动说明

这个分支基于 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 的 main 分支，为 **Web/Docker 版本**添加了**汽水音乐**平台支持。

## 背景

原项目的汽水音乐仅在 Electron 桌面端可用，因为它依赖 Electron 主进程的 IPC 接口（`window.electron.qishuiRequest`）。Web 版没有 Electron 环境，所以无法使用汽水音乐。

## 改动内容

### 新增的文件

| 文件 | 作用 |
|------|------|
| `deploy/docker/qishui-api/server.js` | 独立的汽水音乐 API 服务，把 `qishui-music-api` 包包装成 HTTP 服务，会话以 JSON 文件持久化到 Docker 卷 |
| `deploy/docker/qishui-api/package.json` | qishui-api 服务的依赖声明 |
| `deploy/docker/images/qishui-api.Dockerfile` | qishui-api 服务的 Docker 镜像构建文件 |

### 修改的文件

| 文件 | 改动 | 作用 |
|------|------|------|
| `src/services/onlineMusic/qishui/qishuiTransport.ts` | 新增 Web HTTP API 传输通道 | 前端在没有 Electron 时，通过 HTTP 调用汽水音乐接口（参考酷狗、QQ音乐的 Web 模式） |
| `deploy/docker/images/gateway.Dockerfile` | 添加 `VITE_QISHUI_API_BASE=/qishui` | 构建时注入汽水音乐 API 的相对路径 |
| `deploy/docker/gateway/nginx.conf.template` | 添加 `/qishui/` 反向代理 | gateway 把前端的 `/qishui/` 请求转发到 qishui-api 容器 |
| `deploy/docker/compose.yaml` | 添加 `qishui-api` 服务、gateway 改为本地构建 | Docker 编排中加入汽水音乐服务 |
| `deploy/docker/compose.build.yaml` | 添加 qishui-api 构建配置 | 本地构建镜像时包含 qishui-api |

## 效果

- Docker/Web 版用户现在可以登录和使用汽水音乐，包括搜索、播放、歌词、歌单、红心等功能
- 桌面端功能不受影响，仍走 Electron IPC 通道
- 登录会话自动持久化到 Docker 卷，容器重启后保留

## 架构

```
浏览器前端 --(/qishui/request)--> gateway(nginx) ----> qishui-api容器 ----> 汽水音乐服务器
                            (Electron 桌面端走 IPC，不走这条路径)
```

## 向原项目提的 PR

https://github.com/chthollyphile/folia-major/pull/849
