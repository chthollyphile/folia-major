# Folia Sync Server

这是 Folia 的官方同步服务端实现。本服务以“多端同构”为目标设计，底层逻辑完全一致。

目前支持三种部署方案，你可以根据自己的需求任选其一：
- **Cloudflare D1 / Workers 部署 (推荐)**: 免费、免运维、高可用，依托 Cloudflare 全球边缘网络。
- **Docker 部署**: 适合有自己服务器或 VPS 的用户，一键启动，开箱即用。
- **自托管部署 (Node.js)**: 使用 SQLite，适合在本地或不方便使用 Docker 的环境运行。

## 🔐 Token 指南

无论你采用哪种部署方案，本服务都依赖以下两种 Token 进行安全验证。在开始前，请先了解它们的用途：

> [!IMPORTANT]  
> 强烈建议在部署完成后，将你生成的 Token **妥善保存在密码管理器中**。特别是对于 Cloudflare 部署，部署后的 Token 是加密状态，无法回读。

| Token | 用途 | 是否必填 | 推荐长度 | 忘记了怎么办 |
| --- | --- | --- | --- | --- |
| `SYNC_TOKEN` | 用于客户端鉴权。Folia 客户端必须拥有此 Token 才能读取和覆盖同步数据。 | **必填** | 8 ~ 32 位随机字符 | 重新生成并覆盖环境变量 |
| `DASHBOARD_TOKEN` | 用于在浏览器中查看服务状态和数据库统计（防扫描的隐藏看板）。 | 选填 | 16 位以上的随机字符 | 重新生成并覆盖环境变量 |

### 如何生成高强度 Token？

你可以使用以下任意一种快速生成的方式：

**方法 1：浏览器控制台 (最简单)**
按 `F12` 打开浏览器控制台 (Console)，输入并运行：
```javascript
crypto.randomUUID()
```

**方法 2：Node.js 终端**
在终端中运行：
```bash
node -e "console.log(crypto.randomBytes(16).toString('hex'))"
```

**方法 3：OpenSSL (Linux/macOS 终端)**
在终端中运行：
```bash
openssl rand -hex 16
```

> [!WARNING]  
> 为防止被扫描器字典爆破，服务端**强制要求 `SYNC_TOKEN` 的长度必须大于等于 8 位**，否则服务将拒绝启动（或持续报错）。
> 对于暴露在公网的服务，强烈建议在边缘层（如 Cloudflare WAF 或 Nginx）配置 **Rate Limiting (频率限制)** 防范高频猜测攻击。

---

## 方案一：Cloudflare Workers 部署 (推荐)

零成本、免服务器的 Serverless 部署。当前仓库已经提供安装脚本，可以自动完成 D1 创建、`wrangler.local.toml` 生成、Secret 注入和最终部署，推荐优先使用脚本。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)

> [!WARNING]
> 一键部署按钮可能无法自动完成 D1 数据库的绑定与 Token 注入。如果使用一键部署按钮，你需要**在部署后**前往 Cloudflare 控制台手动创建 D1 数据库、重新配置绑定变量，并设置 `SYNC_TOKEN` 环境变量。因此，**更推荐使用下方的安装脚本**。

### 前置要求
- 注册 Cloudflare 账号
- 本机可用 Node.js 24 或更高版本以及 `npm`

### 1. 运行安装脚本

进入 `sync-server` 目录后，根据你的系统执行：

```bash
cd sync-server
```

Linux / macOS / WSL / Git Bash:

```bash
bash ./install.sh
```

Windows PowerShell / PowerShell 7:

```powershell
.\install.ps1
```

如果遇到执行策略拦截，可以改用：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本启动后都会显示部署菜单：

```text
1) Node (PM2)
2) Docker
3) Cloudflare Workers
```

输入 `3`，进入 Workers 部署流程。

### 2. 按提示完成 Cloudflare 部署

脚本会自动执行以下步骤：

- 安装项目依赖
- 调用 `npx wrangler d1 create folia-sync -c wrangler.toml` 创建 D1 数据库
- 如果数据库已存在，则自动查询已有数据库 ID
- 基于 `wrangler.toml` 生成 `wrangler.local.toml`
- 将真实的 `database_id` 写入 `wrangler.local.toml`
- 提示你输入 `SYNC_TOKEN`
- 自动生成 `DASHBOARD_TOKEN`
- 通过 `wrangler secret put` 将两个 Token 注入 Cloudflare
- 执行 `npm run deploy:cf -- --config wrangler.local.toml` 完成发布

> [!NOTE]
> 首次运行时，Wrangler 可能会要求你在浏览器中登录 Cloudflare 并授权，这是正常现象。

### 3. 保存部署结果

脚本部署完成后会输出：

- Worker 的访问域名
- 自动生成的 `DASHBOARD_TOKEN`
- 看板访问链接格式 `https://<你的Worker域名>/?token=<DASHBOARD_TOKEN>`

其中 `DASHBOARD_TOKEN` 只会在部署时明文显示一次，务必立即保存。

### 4. 脚本生成的本地文件

脚本会在当前目录生成 `wrangler.local.toml`，用于保存当前环境对应的 D1 配置。

- 这个文件已经被 `.gitignore` 忽略
- 不要把它提交到仓库
- 如果你后续需要重新部署，可以继续复用这个文件

### 手动部署说明

如果你不想使用安装脚本，也可以按下面的步骤手动部署。

#### 1. 安装依赖并登录 Cloudflare

```bash
cd sync-server
npm install
npx wrangler login
```

首次登录时，Wrangler 会拉起浏览器完成授权。

#### 2. 创建 D1 数据库

```bash
npx wrangler d1 create folia-sync -c wrangler.toml
```

命令成功后，记下输出中的 `database_id`。

如果你已经创建过同名数据库，可以改用下面的命令查看列表：

```bash
npx wrangler d1 list
```

#### 3. 生成本地部署配置

复制模板文件：

```bash
cp wrangler.toml wrangler.local.toml
```

然后打开 `wrangler.local.toml`，把下面这一项：

```toml
database_id = "replace-with-your-d1-database-id"
```

替换成你刚才拿到的真实 `database_id`。

#### 4. 注入 Cloudflare Secrets

先准备两个 Token：

- `SYNC_TOKEN`：必填，至少 8 位
- `DASHBOARD_TOKEN`：建议自行生成一个 16 位以上随机字符串

然后执行：

```bash
npx wrangler secret put SYNC_TOKEN --config wrangler.local.toml
npx wrangler secret put DASHBOARD_TOKEN --config wrangler.local.toml
```

命令执行后，终端会提示你分别输入对应的 Token 值。

#### 5. 部署到 Workers

```bash
npm run deploy:cf -- --config wrangler.local.toml
```

部署成功后，Wrangler 会输出你的 Worker 域名。此时可以使用下面的格式访问隐藏看板：

```text
https://<你的Worker域名>/?token=<DASHBOARD_TOKEN>
```

#### 6. 后续更新部署

如果只是更新代码，通常不需要重新创建 D1，也不需要重新设置 Secret，直接重新执行：

```bash
npm run deploy:cf -- --config wrangler.local.toml
```

---

## 方案二：Docker 部署

仓库已提供 `Dockerfile` 和 `docker-compose.yml`，当前推荐从仓库内的 `sync-server` 目录直接构建镜像；数据库会持久化到 `./data`。

### 1. 准备配置

进入仓库目录并创建 `.env`：

```bash
cd sync-server
touch .env
```

在同级目录下新建 `.env` 文件，配置 Token：

```env
# 必填：客户端鉴权 Token (至少 8 位)
SYNC_TOKEN="你的_SYNC_TOKEN"

# 选填：网页看板访问 Token (至少 16 位)
DASHBOARD_TOKEN="你的_DASHBOARD_TOKEN"
```

### 2. 启动服务

```bash
docker compose up -d --build
```
启动后，服务监听容器内的 `3000` 端口，并映射到宿主机的 `13000` 端口；数据库文件会持久化保存在 `sync-server/data/folia-sync.db`。

---

## 方案三：Node.js 自托管部署

使用 Node.js 运行，底层使用 `better-sqlite3`。

### 前置要求
- Node.js >= 18
- npm / pnpm

### 1. 配置环境变量

在 `sync-server` 目录下创建一个 `.env` 文件，填入你的 Token 和配置：

```env
# 必填：客户端同步密钥（最少 8 位）
SYNC_TOKEN="你的_SYNC_TOKEN"

# 选填：网页看板的访问密钥
DASHBOARD_TOKEN="你的_DASHBOARD_TOKEN"

# 选填：服务运行端口（默认 3000）
PORT=3000

# 选填：SQLite 数据库保存路径（默认在当前目录生成 folia-sync.db）
DB_PATH="./folia-sync.db"
```

### 2. 安装并启动

```bash
cd sync-server
npm install
npm run start:node
```

你可以使用 PM2 或 Docker 来进行持久化管理。

---

## 客户端接入与 API

Folia 客户端的“存储设置”使用 `workerBaseUrl` 和 `SYNC_TOKEN` 连接服务端。地址填写服务根地址，例如：

```text
https://folia-sync.example.workers.dev
http://127.0.0.1:13000
```

`SYNC_TOKEN` 通过 `Authorization: Bearer <SYNC_TOKEN>` 发送。除 `GET /health` 外，API 均需要鉴权；根路径 `/?token=<DASHBOARD_TOKEN>` 是只读网页看板，不是客户端 API。

当前 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 连通性和 schema 版本检查 |
| `GET` | `/state` | 读取设置/主题更新时间和主题数量 |
| `GET` / `PUT` | `/settings` | 读取或按时间戳更新视觉设置快照 |
| `GET` | `/themes/manifest` | 读取 256 个主题 bucket 摘要 |
| `POST` | `/themes/get` | 按稳定 fingerprint 读取主题 |
| `POST` | `/themes/put` | 批量写入主题，旧时间戳不会覆盖新记录 |
| `POST` | `/themes/bucket` | 按 bucket 拉取主题，用于增量同步 |
| `POST` | `/themes/list` | 分页读取完整主题库，用于导出 |

客户端是本地优先的：AI 主题和主题同步 registry 保存在本机 IndexedDB，启动时会自动做主题同步；视觉设置的拉取/推送、完整 sync library 的 zip 导入导出由存储设置页面或命令面板触发。主题 registry 从旧 localStorage 迁移到 IndexedDB 时会执行一次性兼容迁移。

服务端实现位于 `src/app.ts`，Node 入口位于 `src/node.ts`，Cloudflare 入口位于 `src/cloudflare.ts`；三种部署方式共用同一套路由和 D1/SQLite 兼容的数据访问模型。

---

## 🖥 网页看板与跨端配置

如果你在部署时配置了 `DASHBOARD_TOKEN`，你可以通过浏览器访问隐藏看板：

**访问地址**: `http://你的服务域名/?token=你的_DASHBOARD_TOKEN`

如果 Token 正确，你将看到一个极简的状态看板，展示当前数据库中存储的主题数量和最近更新时间。此页面仅作信息展示，无任何敏感交互。
