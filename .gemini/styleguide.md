## Response language

All pull request summaries, review comments, explanations, and replies must be written in Simplified Chinese.

If the code, variable names, comments, error messages, logs, or documentation are in English, keep those technical terms as-is when appropriate, but explain the review feedback in Simplified Chinese.

## Review style

- 回复应简洁、具体、可操作。
- 优先指出 correctness、security、performance、maintainability 相关问题。
- 不要为了风格偏好提出低价值评论。
- 如果只是建议而非必须修改，请明确标注“建议”。

## Project Context & Skills Guidelines

- 在执行任务、代码生成或代码审查前，须优先读取仓库根目录下的 `AGENTS.md`。
- 根据具体任务类型，选择并读取 `skills/` 目录中对应的 Skill 文件（`skills/<skill-name>/SKILL.md`），并遵循其中定义的约束条件与执行流程。
- 仅在任务需要时按需加载相关的 Skill，无关联任务时避免随意读取无关 Skill。