---
name: file-modularization
description: Use when adding or refactoring frontend features in this repository and you need to prevent large single-file changes, oversized entry files, mixed responsibilities, or giant App.tsx/Home.tsx style implementations. Apply it when a task risks stuffing UI, state, effects, data access, and helper logic into one file instead of splitting work into focused components, hooks, services, utils, and types.
---

# File Modularization

## Overview

这个 skill 用于约束代码拆分方式，避免把一个需求直接堆进单文件，尤其避免继续把 `App.tsx`、页面入口、容器组件写成“巨型总控文件”。

目标：

- 保持文件职责单一
- 优先模块化、组件化、hook 化
- 控制单文件长度和单次变更规模
- 让主入口文件只做装配，不承载大段业务实现

## Core Rule

在开始写代码前，先判断“这次新增内容属于哪一层职责”，不要默认往当前文件继续追加。

优先按下面的归属拆分：

- 视图结构：`components/*`
- 页面装配或容器协调：页面级组件或容器组件
- 可复用交互状态：`hooks/*`
- 跨组件共享状态：`stores/*`
- 数据访问、接口、播放流程、缓存：`services/*`
- 纯计算、格式化、映射、常量：`utils/*`
- 类型定义：`types*`

如果一个文件同时新增了 UI 结构、异步请求、副作用、状态派生、事件处理和类型定义，说明拆分已经不够。

## File Size Guardrail

以下不是机械死规则，但默认按这个阈值控制：

- `App.tsx`、`main.tsx`、页面根组件、全局 provider 装配文件：尽量控制在 180 行内
- 普通容器组件、页面组件、复杂 hook：尽量控制在 220 行内
- 展示型组件、工具函数、适配器：尽量控制在 160 行内
- 单次需求如果需要往一个现有文件追加超过 80 行，先判断是否应该新建模块

如果文件已经明显偏大，不要因为“就近修改方便”继续往里塞；新功能默认拆到相邻新文件。

## Entry File Rule

像 `App.tsx` 这样的主入口文件，只保留这些内容：

- 顶层布局组合
- provider 装配
- 少量跨模块协调
- 必须放在入口层的路由或挂载逻辑
- 对外拼装已经拆好的 hooks、components、services

不要把下面这些大段实现长期留在入口文件：

- 长串 JSX 分支
- 多段 `useEffect` 业务编排
- 成片事件处理函数
- 请求细节和数据转换逻辑
- 大量局部工具函数
- 内联类型、常量、映射表
- 某个子区域的完整 UI 实现

入口文件变大时，优先拆成：

- `components/<feature>/*`
- `hooks/use<Feature>*.ts`
- `services/<feature>*.ts`
- `utils/<feature>*.ts`
- `types/<feature>*.ts` 或邻近类型文件

## Split Strategy

新增功能时，按这个顺序判断拆分：

1. 先抽离独立视觉区块。
2. 再抽离可复用状态和副作用到 hook。
3. 再抽离接口调用、缓存、适配逻辑到 service。
4. 再把纯函数、常量、映射挪到 util 或 types。
5. 最后让原文件只保留装配代码。

适合拆组件的信号：

- JSX 区块超过一个主要视觉区域
- 同一文件里出现多个可折叠的小面板、弹窗、列表、卡片
- 某段 JSX 需要单独理解才能维护

适合拆 hook 的信号：

- 同类状态和 `useEffect` 成组出现
- 某段状态逻辑和 UI 结构弱相关
- 这段逻辑未来会被另一个组件复用

适合拆 service 或 util 的信号：

- 包含请求、解析、适配、排序、过滤、缓存、序列化
- 与 React 生命周期无关
- 可以通过输入输出单独测试

## Change Pattern

默认采用“小入口 + 子模块实现”的改法：

- 在原文件中保留调用关系
- 把实现细节移动到新文件
- 只让原文件负责传参、组合、选择分支

如果某个旧文件已经臃肿，新增需求时不要只做“局部补丁式追加”。

应该优先做：

- 边改边抽离重复区块
- 顺手把强耦合逻辑拆成相邻模块
- 让新逻辑落在正确目录，而不是继续加深历史负担

## Practical Rule

写代码前先回答这几个问题：

1. 这段代码是视图、状态、服务、工具还是类型？
2. 它会不会让当前文件新增一个新的职责？
3. 它未来是否可能被复用或单独测试？
4. 如果继续写在这里，三天后是否会更难读？

只要其中两项答案指向“是”，就优先拆文件。

## Examples

反例：

- 在 `App.tsx` 中直接新增一个完整功能区 UI
- 在页面组件里顺手塞进请求函数、缓存映射、排序工具
- 为了省一次 import，把 100 多行 helper 留在当前组件底部

正例：

- 把新面板拆成 `components/...` 子组件
- 把新功能状态机拆成 `hooks/use...`
- 把接口拼装与响应适配拆成 `services/...`
- 把筛选、分组、格式化拆成 `utils/...`

## What To Avoid

- 让 `App.tsx` 成为所有功能的最终堆积点
- 在一个文件里混合页面结构、业务状态、接口细节、工具函数、类型声明
- 因为“这次改动不大”就反复往超大文件继续追加
- 创建名义上拆分、实际上仍强耦合且不可复用的空壳文件
- 把拆分理解成纯文件数量增加，而不是职责真正变清晰
