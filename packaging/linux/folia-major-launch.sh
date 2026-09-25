#!/bin/sh
# packaging/linux/folia-major-launch.sh
#
# 把 renderer 的 fd 天花板抬到 hard limit，然后 exec 真正的 Electron 二进制。
#
# 为什么需要这一层：renderer 的 soft RLIMIT_NOFILE 是**从启动进程继承**来的，Chromium 从不为
# renderer 抬高它（浏览器进程把自己抬到 hard，GPU 进程抬到 16384，renderer 原样继承）。
# 桌面环境经 systemd 用户服务启动应用时，systemd 默认 `DefaultLimitNOFILE=1024:524288`，
# 于是 renderer 只有 1024 个 fd。
#
# 这为什么会致命：播放期间 Chromium 的栅格化路径会泄漏 4 KiB 共享内存（transfer buffer 只注册
# 不销毁，实测 ~0.4-0.9 个/秒，renderer 与 GPU 进程各占一个 fd）。renderer 撞上 1024 之后，
# 新的共享内存分配开始失败（`CommandBufferHelper::AllocateRingBuffer() failed`），合成器不再
# 出帧——**画面定格，进程还活着，音频照走**。抬到 524288 后同样的泄漏要连续播放约 12 天才触顶。
# 实测：包装前后泄漏速率不变（0.49 fd/s），renderer 的 soft 从 1024 变成 524288。
#
# 只动 soft：`ulimit -n` 最多只能抬到 hard，所以在任何正常系统上这行要么成功、要么无害失败。
set -u

# /usr/bin/folia-major 是指向本脚本的符号链接（deb/rpm/AUR 都这么装），
# 必须解析出真实目录才能找到同目录下的 Electron 二进制。
resolve_self_dir() {
  target=$0
  if command -v readlink >/dev/null 2>&1; then
    resolved=$(readlink -f -- "$target" 2>/dev/null) && [ -n "$resolved" ] && target=$resolved
  fi
  CDPATH= cd -- "$(dirname -- "$target")" && pwd -P
}

app_dir=$(resolve_self_dir) || exit 1

hard_limit=$(ulimit -Hn 2>/dev/null || echo '')
case "$hard_limit" in
  # hard 是 unlimited 时给一个明确的有限值：unlimited 会让泄漏无上限地吃 fd。
  ''|unlimited) hard_limit=524288 ;;
esac
ulimit -n "$hard_limit" 2>/dev/null || true

exec "$app_dir/folia-major-app" "$@"
