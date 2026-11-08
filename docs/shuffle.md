# 洗牌策略语义与 seed 复现

## 四策略
- **fisher-yates（默认）**：均匀随机（标准 Fisher–Yates 倒序），当前歌钉首，不读不写历史，与旧版行为一致。
- **round**：一轮内不重复（按歌曲 key 计）；未播先随机、已播沉底；整轮播完自动重置并重洗、不打断播放；队列身份用顺序无关指纹，增删/替换/换来源重置、纯换序不重置。
- **fewer-repeats**：最近 W 条历史里出现的歌（deferred）放后面、最久未听在前；其余（fresh）先随机。W = min(历史长度, max(2, 队列长-2))。fresh<2 时 deferred 走加权随机（B2 修复）。
- **weighted**：按「距上次播放时间」加权（ln(u)/w 降序），从未播过 = 极大权重 1e6，并列按原下标稳定排序。

## 随机源
- **mt19937（默认）**：MT19937 + 拒绝采样，无偏；提供 seedHex 可复现。**非密码学安全。**
- **math（兼容档）**：`Math.floor(Math.random()*n)`，每次恰消耗 1 次 Math.random；与旧版同源，不可 seed 重放。

## seed 复现（mt19937）
状态面板（设置 → 播放 → 洗牌 → 上次洗牌）显示最近一次 seed，可复制。用同 seed 重建：
```ts
import { Mt19937 } from '@/utils/shuffle/rng';
const rng = Mt19937.fromHex(seedHex);
```
注意：完整重放还需要当时的队列身份与顺序、策略、history 快照与 now（P2 已列，P1 仅展示/复制 seed）。
