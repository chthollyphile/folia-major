# Project Skills

本仓库不再把项目规则直接堆在 `AGENTS.md` 中，而是改为按 skill 组织。

使用方式：

1. 如果需要的话，先根据任务选择最相关的 skill。
2. 读取对应 `skills/<skill-name>/SKILL.md`。
3. 按 skill 中的触发条件和执行规则完成工作。
4. 如果多个 skill 同时相关，可以组合使用，但只加载当前任务真正需要的内容。

当前项目内 skills：

- `testing-strategy`
  路径：`skills/testing-strategy/SKILL.md`
  用于决定当前任务应该看热加载报错、跑单测、跑 UI 截图测试，还是避免误跑构建。

- `readme-reference`
  路径：`skills/readme-reference/SKILL.md`
  用于在修改代码、测试、流程或文档前，先从仓库内 README 中提取仍然有效的项目上下文。

- `glossary-alignment`
  路径：`skills/glossary-alignment/SKILL.md`
  用于把开发者口头说的组件、视图、状态、面板、模式等术语，快速对齐到具体代码归属。

- `file-modularization`
  路径：`skills/file-modularization/SKILL.md`
  用于在新增或重构前端功能时约束文件长度、入口文件职责和模块拆分，避免继续把大量实现堆进 `App.tsx`、页面根组件或单个大文件。

全局沟通规则：

- 不需要使用skills的时候，不要读取它们。
- 回答用户问题时，直接给出结论，不添加无关的辅助性评价措辞。
- 如果用户指出的是潜在 bug 或不合理设计，需要直接指出问题并给出建议，不回避。
- 如果创建了新的文件，在导入行结束后插入当前文件的注释
- 如果创建了复杂的函数，写出简短的注释，说明函数功能
