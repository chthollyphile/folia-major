# 飞牛音乐服务器协议

> 状态：**接口路径、登录流程、核心字段依据飞牛音乐服务端接口实测整理**。
> 说明：接口以飞牛音乐服务实际响应为准。
> 少量字段（歌词项）为合理推断，代码中以「待实机确认」标注。

## 基础信息

- 服务：飞牛音乐服务器（fnOS NAS 上的飞牛音乐 Web 服务，`/music` 路径）。
- **API 基础路径：`{origin}/music/api/v1/`**（v2 通道为 `/music/api/v2`；国际版 `/music/api/intl/v1`）。
  - 之前误用 `/music/api/`（缺 `/v1`），服务器对未注册路径回退 SPA index.html。
- 端口：跟随 fnOS Web 端口（HTTP 5666 / HTTPS 5667）。
- 响应信封：`{ code, msg, data }`；`code ∈ {0, 200}` 为成功，其余为业务错误（`msg` 为错误信息）。

## 请求签名

飞牛音乐网页端对 API 请求附加 `authx` 头；**2026-10-28 服务端实测，`password-login` 与 `track/stream` 不带 `authx` 同样返回成功（登录 code 0、播放 200 audio/x-flac）**，因此本实现不签名、不保留任何客户端密钥（符合 UPSTREAMS.md「不保留客户端标识、签名或协议实现」）。桥里不再内嵌 `API_SECRET` / `API_KEY`。

## 认证（登录 + 会话）

- 登录：`POST /music/api/v1/user/password-login`
  - 请求体：`{ "username": 账号, "password": sha256(明文密码), "deviceId": 32位hex }`
  - deviceId：随机 32 位小写 hex，同一台机器登录同一 NAS 持久复用（不产生新设备）。
  - 响应：`data: { userToken, user }`。
- 会话认证：后续请求带 `Cookie: music-token={userToken}`（网页端 `credentials:'include'` 自动携带）。
  - 渲染进程无法设置 Cookie 受限头 → 桌面端由主进程桥写入。
- 登出：`POST /music/api/v1/user/logout`。
- 当前用户：`GET /music/api/v1/user/me`。

## 凭据与播放/封面（桌面端）

- 服务器地址与 token 用 `safeStorage` 加密存进主进程 store（`fnmusic-config`），渲染进程只发操作、不持有明文。
- 系统加密不可用（`isEncryptionAvailable()` 为假或 Linux `basic_text`）时退回只在本次运行内保存（照 `electron/qishui/session.cjs`）。
- **播放与封面走自定义协议 `folia-fnmusic://`**（`protocol.handle('folia-fnmusic')`，参照 `electron/ytm/audio.cjs`）：
  - 播放：`folia-fnmusic://stream?guid={trackGUID}&quality={可选}` → 主进程转发 `GET /music/api/v1/track/stream`
  - 封面：`folia-fnmusic://cover?coverId={coverId}&size={可选}` → 主进程转发 `GET /music/api/v1/static/cover`
  - 转发时带 `Cookie: music-token=…` 与 Range；自签名 HTTPS 只对私网地址放行证书校验（`rejectUnauthorized: false`），公网 FN Connect 中继等仍严格校验。
  - 协议地址稳定，重启不变（歌曲对象只存 `coverId`，显示时再生成地址）。

## 核心接口（方法来自接口注册表）

| 模块 | 路径 | 方法 | 参数 | 响应要点 |
| --- | --- | --- | --- | --- |
| 搜索歌曲 | `/music/api/v1/search/track` | GET | `q`（关键词）、`page`、`size` | `{ total, list }` |
| 搜索专辑/歌手/歌单 | `/music/api/v1/search/album` `/search/artist` `/search/playlist` | GET | `q,page,size` | `{ total, list }` |
| 搜索建议 | `/music/api/v1/search/suggest` | GET | `q` | - |
| 歌曲元数据 | `/music/api/v1/track/metadata` | GET | `trackGUID` | 歌曲对象 |
| 歌曲列表 | `/music/api/v1/track/list` | GET | `page,size` | `{ total, list }` |
| 播放源 | `/music/api/v1/track/stream` | GET | `guid`（即 trackGUID） | 音频流（实测 200 audio/x-flac） |
| 转码 | `/music/api/v1/track/transcode` | POST | - | - |
| 歌词 | `/music/api/v1/lyric/list` | GET | `trackGUID` | `{ list, preferred }` |
| 专辑列表/详情 | `/music/api/v1/album/list` `/album/detail` | GET | 分页 / id | `{ total, list }` / 专辑 |
| 歌手列表/详情 | `/music/api/v1/artist/list` `/artist/detail` | GET | - | - |
| 歌单列表/详情 | `/music/api/v1/playlist/list` `/playlist/detail` | GET | - | - |
| 收藏 | `/music/api/v1/favorite-track/create` `/delete` `/list` | POST/GET | `trackGUID` | - |
| 播放历史 | `/music/api/v1/play-history/list` | GET | - | - |
| 封面 | `/music/api/v1/static/cover` | GET | `coverId`、可加 `size` | 图片 |

## 歌曲对象字段（网页端映射器确认）

```
guid          歌曲 id（接口参数统一用 trackGUID=guid）
title         标题
artists       [{ guid, name }]
album         { guid, name, coverId, artists, ... }
duration      毫秒
coverId       封面 id（→ /music/api/v1/static/cover?coverId=）
trackNo / discNo
audioSpec     { path, format, bitDepth, bitrate(bps), channel, codec, sampleRate, size }
isFavorite / isCue
createdAt / updatedAt     Unix 秒
```

专辑：`{ guid, name, artists, coverId, trackCount, originalReleaseYear|originalReleaseDate }`；
歌手：`{ guid, name, coverId, albumCount, trackCount }`。

## 已验证/未验证清单

- [x] 基础路径 `/music/api/v1`（含 `/v1`）
- [x] 信封 `{code,msg,data}`，成功码 0/200
- [x] 登录不带 authx 即可成功（2026-10-28 实测）
- [x] 登录接口路径、参数（username/sha256 密码/deviceId）、响应 `{userToken,user}`
- [x] 搜索参数 `q/page/size`、响应 `{total,list}`
- [x] `track/stream` 参数 `guid`，实测返回 200 音频流
- [x] 封面路径 `/music/api/v1/static/cover?coverId=`（实测生效）
- [x] 歌词参数 `trackGUID`、响应 `{list,preferred}`
- [x] 歌曲字段映射（Sj 映射器）
- [ ] 歌词单项字段名（lyric/lyrics/content？）——代码已做多候选兜底

## 实机验证命令（更新版）

在 Windows PowerShell（纯 ASCII 注意编码）或任意终端，对 `http://192.168.x.x:5666` 运行：

```bash
# 1. 登录（密码先做 sha256，无需 authx）
curl -s -X POST "http://192.168.x.x:5666/music/api/v1/user/password-login" \
  -H "Content-Type: application/json" \
  -d '{"username":"你的账号","password":"<sha256hex>","deviceId":"<32hex>"}'
# 2. 带 Cookie 搜索
curl -s "http://192.168.x.x:5666/music/api/v1/search/track?q=%E5%91%A8%E6%9D%B0%E4%BC%A6&page=1&size=5" \
  -H "Cookie: music-token=<userToken>"
# 3. 歌词
curl -s "http://192.168.x.x:5666/music/api/v1/lyric/list?trackGUID=<guid>" -H "Cookie: music-token=<userToken>"
```
