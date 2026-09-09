# 临时 QQ 音乐 CDN 补丁

这里的补丁在安装 `@yakult-green-tea/qq-music-api@3.1.0` 后自动应用，为 QQ 音乐无损播放增加 CDN 选择和 `sjy6` 快速路径。

上游发布包含相同修复的新版本后，应同时完成以下清理：

1. 升级根项目和 `deploy/docker/qq-api` 中的包版本及 lockfile。
2. 删除对应 `.patch` 文件和本说明。
3. 删除根 `package.json` 中的 `postinstall`，以及两份 `package.json` 中的 `patch-package` 依赖。
4. 删除 QQ API Dockerfile 中复制、应用补丁的步骤，并恢复 `npm ci --omit=dev`。
