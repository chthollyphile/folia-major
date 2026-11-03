# Folia 歌词接口

<!-- docs/lyric-api.md -->

歌词接口是 Folia Electron 桌面端提供的本机只读 HTTP API。外部程序可以通过它获取 Folia 当前加载的歌词数据，无需鉴权。

## 基本信息

| 项目 | 值 |
| --- | --- |
| 可用平台 | Folia Electron 桌面端 |
| 协议 | HTTP |
| 监听地址 | `127.0.0.1` |
| 固定端口 | `32109` |
| API 版本 | `v1` |
| 鉴权 | 无 |
| 数据格式 | JSON，UTF-8 |
| 基础地址 | `http://127.0.0.1:32109` |

服务只监听 IPv4 回环地址，不能从局域网或互联网访问。建议客户端使用文档中的完整 `127.0.0.1` 地址，不要依赖 `localhost` 的 IPv4/IPv6 解析结果。

## 启用接口

在 Folia 桌面端打开：

```text
设置 → 连接与集成 → 歌词接口 → 启用歌词接口
```

也可以从命令面板执行“歌词接口”命令进行切换。设置会被持久化；启用后，Folia 下次启动时会自动尝试监听固定端口。

如果 `32109` 已被其他程序占用，设置页会显示接口不可用及对应错误。此时客户端连接会失败，需要释放端口后关闭并重新启用歌词接口。

## 获取当前歌词

```http
GET /v1/lyric HTTP/1.1
Host: 127.0.0.1:32109
```

完整地址：

```text
http://127.0.0.1:32109/v1/lyric
```

### 请求参数

无查询参数，无请求体。

### 成功响应

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Access-Control-Allow-Origin: *
```

有歌词时，响应体是精简后的歌词对象；没有加载歌词时，响应体是 JSON `null`。

## 响应结构

以下 TypeScript 类型描述了完整的公开数据结构：

```ts
type LyricResponse = LyricData | null;

interface LyricData {
  offset: number;
  clipStartMs: number;
  lines: LyricLine[];
  wordByWord: boolean;
  title?: string;
  artist?: string;
}

interface LyricLine {
  text: string;
  startTime: number;
  endTime: number;
  words: LyricWord[];
  translation?: string;
  romanization?: string;
  backgroundVocals?: BackgroundVocal[];
}

interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

interface BackgroundVocal {
  text: string;
  startTime: number;
  endTime: number;
  words: LyricWord[];
  translation?: string;
  romanization?: string;
}
```

歌词行、逐字和背景人声的 `startTime` / `endTime` 单位均为秒；顶层 `offset` 和 `clipStartMs` 单位为毫秒。

### 顶层字段

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `offset` | `number` | 是 | 用户在歌词面板中为当前歌曲设置的歌词时间偏移，单位为毫秒。正值表示歌词延后，负值表示歌词提前，未调整时为 `0`。 |
| `clipStartMs` | `number` | 是 | 正在播放的试听片段在整首歌里的起点，单位为毫秒。歌词按整首计时，而播放器给出的进度和时长是片段自己的；整首播放、片段从歌头开始或平台没有给出起点时为 `0`。v1 后来新增的字段，见“版本兼容性”。 |
| `lines` | `LyricLine[]` | 是 | 按时间顺序排列的歌词行。 |
| `wordByWord` | `boolean` | 是 | 表示时间轴来源：`true` 为数据源提供的原生逐字时间，`false` 为 Folia 根据逐行时间合成的逐字时间。两种情况下歌词行都会提供 `words`。 |
| `title` | `string` | 否 | 歌词数据附带的歌曲标题；为空时不会返回。 |
| `artist` | `string` | 否 | 歌词数据附带的艺术家；为空时不会返回。 |

### 歌词行字段

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `text` | `string` | 是 | 当前行的完整歌词文本。 |
| `startTime` | `number` | 是 | 当前行开始时间，单位为秒。 |
| `endTime` | `number` | 是 | 当前行结束时间，单位为秒。 |
| `words` | `LyricWord[]` | 是 | 当前行的逐字时间轴。原始数据只有逐行时间时，由 Folia 歌词流水线自动拆分文本并合成逐字时间，因此正常歌词行不会因为源格式是 LRC/VTT 等逐行格式而返回空数组。 |
| `translation` | `string` | 否 | 当前行翻译。 |
| `romanization` | `string` | 否 | 当前行罗马音或音译。 |
| `backgroundVocals` | `BackgroundVocal[]` | 否 | 当前行包含的背景人声。 |

### 逐字字段

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `text` | `string` | 是 | 单词、字符或歌词片段。 |
| `startTime` | `number` | 是 | 片段开始时间，单位为秒。 |
| `endTime` | `number` | 是 | 片段结束时间，单位为秒。 |

### 背景人声字段

背景人声与普通歌词行使用相同的时间单位，并拥有自己的逐字数组。`translation` 和 `romanization` 仅在数据源提供对应内容时出现。

## 响应示例

### 逐字歌词

```json
{
  "offset": -250,
  "clipStartMs": 0,
  "lines": [
    {
      "text": "Hello world",
      "startTime": 12.4,
      "endTime": 15.1,
      "words": [
        {
          "text": "Hello",
          "startTime": 12.4,
          "endTime": 13.5
        },
        {
          "text": " world",
          "startTime": 13.5,
          "endTime": 15.1
        }
      ],
      "translation": "你好，世界",
      "romanization": "Hello world"
    }
  ],
  "wordByWord": true,
  "title": "Example Song",
  "artist": "Example Artist"
}
```

### 逐行来源歌词（已合成逐字时间轴）

即使原始歌词只提供行开始时间，Folia 也会在进入统一歌词流水线时生成逐字时间。此时 `wordByWord` 为 `false`，用于说明这些逐字时间是估算值，而不是数据源提供的精确逐字时间。

```json
{
  "offset": 0,
  "clipStartMs": 0,
  "lines": [
    {
      "text": "这是一行歌词",
      "startTime": 3.2,
      "endTime": 7.8,
      "words": [
        {
          "text": "这",
          "startTime": 3.2,
          "endTime": 3.89
        },
        {
          "text": "是",
          "startTime": 3.89,
          "endTime": 4.58
        },
        {
          "text": "一",
          "startTime": 4.58,
          "endTime": 5.27
        },
        {
          "text": "行",
          "startTime": 5.27,
          "endTime": 5.96
        },
        {
          "text": "歌",
          "startTime": 5.96,
          "endTime": 6.65
        },
        {
          "text": "词",
          "startTime": 6.65,
          "endTime": 7.34
        }
      ]
    }
  ],
  "wordByWord": false
}
```

### 当前没有歌词

```json
null
```

`null` 是正常的 `200 OK` 响应，不表示接口故障。它可能表示当前没有播放歌曲、歌词仍在加载，或当前歌曲没有可用歌词。

## 数据精简规则

接口不会直接暴露 Folia 内部的完整渲染对象。当前 `v1` 使用以下转换规则：

| Folia 内部字段 | 公开字段或处理方式 |
| --- | --- |
| 当前歌曲的手动歌词时间偏移 | 输出为顶层 `offset`，单位为毫秒 |
| 当前播放地址是试听片段时，片段在整首歌里的起点 | 输出为顶层 `clipStartMs`，单位为毫秒；不是试听片段时为 `0` |
| `fullText` | 改名为 `text` |
| `isWordByWord` | 改名为 `wordByWord`；表示原生或合成逐字时间，不表示 `words` 是否存在 |
| 行和逐字的 `startTime` / `endTime` | 保留，单位为秒 |
| `translation` / `romanization` | 有内容时保留 |
| `backgroundVocal` / `backgroundVocals` | 统一输出为 `backgroundVocals` 数组 |
| `renderHints`、`ttml`、agent、内部 ID、分块与视觉效果字段 | 移除 |
| syllable、ruby 等内部细粒度数据 | 移除 |

客户端不应依赖 JSON 字段的排列顺序，也不应假设未来版本会公开 Folia 的内部字段。

## 状态码

| 状态码 | 场景 | 响应 |
| --- | --- | --- |
| `200` | 成功获取当前歌词快照 | 歌词对象或 `null` |
| `204` | CORS 预检请求成功 | 无响应体 |
| `404` | 请求路径不存在 | `{ "error": "Not found." }` |
| `405` | `/v1/lyric` 使用了不支持的方法 | `{ "error": "Method not allowed." }` |

当接口未启用、Folia 未运行或端口被占用时，客户端会遇到连接失败，不会收到 HTTP 状态码。

## CORS

接口允许本机浏览器页面跨域读取：

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
```

接口不使用 Cookie、Bearer Token 或其他鉴权信息。

## 调用示例

### curl

```bash
curl http://127.0.0.1:32109/v1/lyric
```

### JavaScript

```js
const response = await fetch('http://127.0.0.1:32109/v1/lyric', {
  cache: 'no-store',
});

if (!response.ok) {
  throw new Error(`Lyrics API failed: ${response.status}`);
}

const lyrics = await response.json();
if (lyrics === null) {
  console.log('当前没有歌词');
} else {
  console.log(`歌词偏移：${lyrics.offset} ms`);
  console.log(`试听片段起点：${lyrics.clipStartMs ?? 0} ms`);
  console.log(lyrics.lines);
}
```

### Python

```python
import requests

response = requests.get(
    "http://127.0.0.1:32109/v1/lyric",
    timeout=2,
)
response.raise_for_status()

lyrics = response.json()
if lyrics is None:
    print("当前没有歌词")
else:
    print(f"歌词偏移：{lyrics['offset']} ms")
    print(f"试听片段起点：{lyrics.get('clipStartMs', 0)} ms")
    print(lyrics["lines"])
```

## 使用注意事项

- 接口返回的是歌词数据快照，不包含当前播放时间、当前歌词行索引、播放状态或播放控制能力。
- `offset` 是用户为当前歌曲手动设置的歌词时间偏移，单位为毫秒；客户端若自行按播放时间匹配歌词，应使用 `播放时间（秒） + clipStartMs / 1000 - offset / 1000` 作为歌词时间。
- `clipStartMs` 只在播放从整首中间开始的试听片段时不为 `0`。例如片段从整首的 64.3 秒处开始（`clipStartMs` 为 `64300`），播放器显示片段的第 9 秒时，对应的是整首第 73.3 秒的歌词。播放进度和时长仍是片段自己的，不要用 `clipStartMs` 去改它们。
- Folia 会把逐行歌词归一化为逐字时间轴；`wordByWord: false` 表示逐字时间由行时间估算生成，外部程序不应把它当作原生精确逐字时间。
- 歌词对象通常只会在切歌、歌词加载完成、歌词来源发生变化、播放地址变化（例如同一首歌从试听片段换成整首）或用户调整歌词时间偏移时更新，不会随播放进度持续变化。
- 需要感知切歌的客户端可以低频轮询，例如每 `500–1000 ms` 请求一次，并比较响应内容。
- 客户端必须正确处理 `200 OK` 加 JSON `null` 的情况。
- 这是无鉴权本地接口。不要通过端口转发、反向代理或防火墙规则将它暴露到不可信网络。

## 版本兼容性

`v1` 路径表示当前公开数据合同。兼容性更新会尽量保持现有字段语义；如果未来需要不兼容的结构调整，应通过新的版本路径提供，而不是直接改变 `v1`。

`clipStartMs` 是 `v1` 后来新增的字段，现有字段的含义没有改变。不认识它的旧客户端仍按 `播放时间 - offset / 1000` 计算，只有在播放从整首中间开始的试听片段时会和歌词错开。
