# qq-api 镜像源码（vendored）

`source/` 是 `qq-music-api` 仓库可构建部分的**副本**，由 `deploy/docker/scripts/sync-qq-api-source.mjs` 生成。
`folia-qq-api` 镜像用它构建，因此 folia-major 的 CI 不需要访问任何外部仓库。

`source/VENDOR.json` 记录来源分支与 commit。

## 来源与许可

| 项 | 内容 |
| --- | --- |
| 原始上游 | [Rain120/qq-music-api](https://github.com/Rain120/qq-music-api) |
| 作者 | Rain120 |
| 许可证 | MIT，全文见同级目录的 [`LICENSE`](./LICENSE) |
| 版本 | `source/package.json` 的 `qq-music-api@2.0.0` |
| 集成基线 | `feature/qq-music-provider` 分支；固定提交见 `source/VENDOR.json` |

`source/` 是**经过修改**的副本，不是上游原始码的逐字复制：为接入 folia-major 增加了原生扫码登录、
微信扫码通道、账号歌单与「我喜欢」等改动。修改同样以 MIT 释出。

`source/VENDOR.json` 里的 `commit` 用于标识精确的同步基线；要重跑同步脚本，
先把对应的 `qq-music-api` 工作树放到 folia-major 的同级目录（或用 `QQ_MUSIC_API_DIR` 指定路径）。

`LICENSE` 刻意放在 `source/` **之外**：同步脚本会先删除整个 `source/` 再重新复制，
放在里面会被下一次同步清掉，也会被 `--check` 当成漂移。

### 许可证如何进入发行产物

MIT 要求分发二进制时一并附上版权声明与许可证全文，因此两种产物都自带一份：

| 产物 | 位置 |
| --- | --- |
| `folia-qq-api` 镜像 | `/app/LICENSE.qq-music-api`（[`images/qq-api.Dockerfile`](../images/qq-api.Dockerfile) 从构建上下文复制） |
| Electron 安装包 | `electron/vendor/qqMusicApi.LICENSE`，另有一份写在 `qqMusicApi.cjs` 顶部的 banner 注释里 |

Electron 那两份由 [`packaging/build-qq-api-bundle.mjs`](../../../packaging/build-qq-api-bundle.mjs)
在打 bundle 时生成；许可证文件缺失时脚本直接报错，不会产出没有声明的 bundle。
两者都落在 `electron/` 下，被 `package.json` 的 `build.files` 里 `electron/**/*` 覆盖。

## 不要直接改 `source/`

上游是 `qq-music-api` 仓库。任何后端改动都先在那边完成（controller / service / route / Explorer / tests / docs 六步流程），
再同步回来：

```bash
# 默认从 ../qq-music-api 读取；也可传路径或设 QQ_MUSIC_API_DIR
node deploy/docker/scripts/sync-qq-api-source.mjs
node deploy/docker/scripts/sync-qq-api-source.mjs /path/to/qq-music-api
```

提交前检查副本是否落后于上游：

```bash
node deploy/docker/scripts/sync-qq-api-source.mjs --check
```

找不到源码目录时 `--check` 会跳过并返回 0（CI 上没有 sibling 仓库），本机则会在漂移时列出差异并返回 1。

## 同步范围

| 类型 | 内容 |
| --- | --- |
| 文件 | `package.json`、`package-lock.json`、`tsconfig.json`、`tsconfig.build.json`、`scripts/prepare-runtime-assets.js` |
| 目录 | `src/`、`public/` |

`tests/`、`docs/`、`jest.config.js`、`biome.json` 不进副本；镜像构建用不到，留在上游仓库。

## 镜像如何构建

[`images/qq-api.Dockerfile`](../images/qq-api.Dockerfile) 是两阶段构建：

1. builder：`npm ci` → `npm run build:js`（`tsc -p tsconfig.build.json --outDir dist` + `prepare-runtime-assets.js`），产出 `dist/src/app.js`、`dist/package.json` 与 `dist/public/`。
2. runner：`npm ci --omit=dev` 只装运行时依赖，复制 `dist/`，以 `node` 用户运行 `node dist/src/app.js`。

`chalk` 与 `colors` 是 `src/` 真正 import 的运行时依赖，已在上游移入 `dependencies`；
`qq-music-api` 的 `tests/runtime.dependencies.test.ts` 守住这条约束，否则 `--omit=dev` 的镜像会在启动时缺包。

## 运行时约定

- 端口固定 `3000`（镜像内），只经 gateway 的 `/qq/` 暴露，不发布宿主机端口。
- `QQ_AUTH_STATE_PATH=/app/.auth-state/qq-device.json`，挂在具名卷 `qq-api-state` 上。
  该文件**只存 Android device 识别值，不存 `musickey`、MQTT token 或任何用户凭证**；
  写入失败时上游代码会降级成进程内状态而不阻断登录。
- 需要更换装置身份：`docker compose down` 后 `docker volume rm folia_qq-api-state`，再启动即可重新注册。
- 多实例部署不要共用同一份装置状态，各自使用独立卷。
