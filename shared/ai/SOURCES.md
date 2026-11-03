# AI provider sources

The comments in `shared/ai/*.mjs`, `electron/aiTextClient.cjs` and `electron/ai/*.cjs` cite their
grounds as `[Provider·page]`. This is where each one points: the providers' own documentation, read
on 2026-10-22 while the adapters were written. When a provider changes a rule, update the adapter,
its test in `test/unit/ai/`, and the entry here.

## OpenAI

| Tag | Page |
|---|---|
| `[OpenAI·latest-model]` | https://developers.openai.com/api/docs/guides/latest-model |
| `[OpenAI·reasoning]` | https://developers.openai.com/api/docs/guides/reasoning |
| `[OpenAI·gpt-6-astra]` | https://developers.openai.com/api/docs/models/gpt-6-astra |
| `[OpenAI·gpt-6.1-sol]` | https://developers.openai.com/api/docs/models/gpt-6.1-sol |
| `[OpenAI·chat]` | https://developers.openai.com/api/reference/resources/chat |
| `[OpenAI·models-list]` | https://developers.openai.com/api/reference/resources/models/methods/list |
| `[OpenAI·deprecations]` | https://developers.openai.com/api/docs/deprecations |
| `[OpenAI·your-data]` | https://developers.openai.com/api/docs/guides/your-data |
| `[khoj#1377]` | https://github.com/khoj-ai/khoj/issues/1377 (a reasoning model answering 400 to a temperature) |

## Anthropic

| Tag | Page |
|---|---|
| `[Anthropic·models]` | https://platform.claude.com/docs/en/models/overview |
| `[Anthropic·haiku-5-5]` | https://platform.claude.com/docs/en/models/haiku-5-5/overview |
| `[Anthropic·sonnet-5-5]` | https://platform.claude.com/docs/en/models/sonnet-5-5/overview |
| `[Anthropic·opus-5-5]` | https://platform.claude.com/docs/en/models/opus-5-5/migration-guide |
| `[Anthropic·thinking]` | https://platform.claude.com/docs/en/build-with-claude/thinking |
| `[Anthropic·effort]` | https://platform.claude.com/docs/en/build-with-claude/effort |
| `[Anthropic·structured-outputs]` | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `[Anthropic·messages]` | https://platform.claude.com/docs/en/api/messages/create |
| `[Anthropic·models-list]` | https://platform.claude.com/docs/en/api/models/list |
| `[Anthropic·errors]` | https://platform.claude.com/docs/en/api/errors |
| `[Anthropic·versioning]` | https://platform.claude.com/docs/en/api/versioning |
| `[Anthropic·deprecations]` | https://platform.claude.com/docs/en/about-claude/model-deprecations |

## Google Gemini

| Tag | Page |
|---|---|
| `[Gemini·thinking]` | https://ai.google.dev/gemini-api/docs/thinking |
| `[Gemini·latest-model]` | https://ai.google.dev/gemini-api/docs/latest-model |
| `[Gemini·3-flash-preview]` | https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview |
| `[Gemini·3.6-flash]` | https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash |
| `[Gemini·3.5-flash-lite]` | https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite |
| `[Gemini·3.6]` | https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6 |
| `[Gemini·deprecations]` | https://ai.google.dev/gemini-api/docs/deprecations |
| `[Gemini·models-api]` | https://ai.google.dev/api/models |

## DeepSeek

| Tag | Page |
|---|---|
| `[DeepSeek·docs]` | https://api-docs.deepseek.com/ |
| `[DeepSeek·chat]` | https://api-docs.deepseek.com/api/create-chat-completion |
| `[DeepSeek·thinking_mode]` | https://api-docs.deepseek.com/guides/thinking_mode |
| `[DeepSeek·json_mode]` | https://api-docs.deepseek.com/guides/json_mode |
| `[DeepSeek·list-models]` | https://api-docs.deepseek.com/api/list-models |
| `[DeepSeek·pricing]` | https://api-docs.deepseek.com/quick_start/pricing |
| `[DeepSeek·news260424]` | https://api-docs.deepseek.com/news/news260424 |
| `[DeepSeek·news260910]` | https://api-docs.deepseek.com/news/news260910 |
| `[DeepSeek·news261017]` | https://api-docs.deepseek.com/news/news261017 |

## Kimi (Moonshot)

The international site's pages; the China site (platform.kimi.com/docs/) has the same paths.

| Tag | Page |
|---|---|
| `[Kimi·overview]` | https://platform.kimi.ai/docs/api/overview.md |
| `[Kimi·models]` | https://platform.kimi.ai/docs/models.md |
| `[Kimi·chat]` | https://platform.kimi.ai/docs/api/chat.md |
| `[Kimi·thinking]` | https://platform.kimi.ai/docs/guide/use-thinking-models.md |
| `[Kimi·reasoning-effort]` | https://platform.kimi.ai/docs/guide/use-reasoning-effort.md |
| `[Kimi·k3]` | https://platform.kimi.ai/docs/guide/kimi-k3-quickstart.md |
| `[Kimi·response_format]` | https://platform.kimi.ai/docs/guide/response_format.md |
| `[Kimi·list-models]` | https://platform.kimi.ai/docs/api/list-models.md |
| `[Kimi·changelog]` | https://platform.kimi.ai/docs/platform-changelog.md |

## Zhipu GLM (Z.ai, open.bigmodel.cn)

| Tag | Page |
|---|---|
| `[Z.ai·overview]` | https://docs.z.ai/guides/overview/overview.md |
| `[Z.ai·concept-param]` | https://docs.z.ai/guides/overview/concept-param.md |
| `[Z.ai·thinking-mode]` | https://docs.z.ai/guides/capabilities/thinking-mode.md |
| `[Z.ai·struct-output]` | https://docs.z.ai/guides/capabilities/struct-output.md |
| `[Z.ai·glm-5.3]` | https://docs.z.ai/guides/llm/glm-5.3.md |
| `[Z.ai·chat-completion]` | https://docs.z.ai/api-reference/llm/chat-completion.md |
| `[Z.ai·api-code]` | https://docs.z.ai/api-reference/api-code.md |
| `[Z.ai·openapi]` | https://docs.z.ai/openapi.json |
| `[BigModel·overview]` | https://docs.bigmodel.cn/cn/guide/start/model-overview.md |
| `[BigModel·thinking-mode]` | https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode.md |
| `[BigModel·openapi]` | https://docs.bigmodel.cn/openapi/openapi.json |

## Alibaba Cloud Model Studio (Qwen)

| Tag | Page |
|---|---|
| `[Qwen·base-url]` | https://help.aliyun.com/zh/model-studio/base-url |
| `[Qwen·openai-chat]` | https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions |
| `[Qwen·deep-thinking]` | https://help.aliyun.com/zh/model-studio/deep-thinking |
| `[Qwen·structured-output]` | https://help.aliyun.com/zh/model-studio/qwen-structured-output |
| `[Qwen·list-models]` | https://help.aliyun.com/zh/model-studio/list-models |
| `[Qwen·models]` | https://help.aliyun.com/zh/model-studio/models |
| `[Qwen·error-code]` | https://help.aliyun.com/zh/model-studio/error-code |

## Tencent Cloud TokenHub

The China site's documentation names the tencentmaas.com hosts; the international account
documentation (https://intl.cloud.tencent.com/zh/document/product/1300/80632) names
`tokenhub-intl.tencentcloudmaas.com`, which the international site preset uses.

| Tag | Page |
|---|---|
| `[TokenHub·models-api]` | https://cloud.tencent.com/document/product/1823/130078 (API usage, `GET /v1/models`) |
| `[TokenHub·130079]` | https://cloud.tencent.com/document/product/1823/130079 (calling language models) |
| `[TokenHub·models]` | https://cloud.tencent.com/document/product/1823/130051 (model list) |
| `[TokenHub·deep-thinking]` | https://cloud.tencent.com/document/product/1823/131208 |
| `[TokenHub·131595]` | https://cloud.tencent.com/document/product/1823/131595 (error codes) |
| `[lkeap·115969]` | https://cloud.tencent.com/document/product/1772/115969 (the retired knowledge-engine address) |
| `[hunyuan·111007]` | https://cloud.tencent.com/document/product/1729/111007 (the frozen Hunyuan address) |

## Xiaomi MiMo

| Tag | Page |
|---|---|
| `[MiMo·first-api-call]` | https://mimo.mi.com/static/docs/quick-start/summary/first-api-call.md |
| `[MiMo·model]` | https://mimo.mi.com/static/docs/quick-start/summary/model.md |
| `[MiMo·openai-api]` | https://mimo.mi.com/static/docs/api/chat/openai-api.md |
| `[MiMo·deep-thinking]` | https://mimo.mi.com/static/docs/quick-start/usage-guide/text-generation/deep-thinking.md |
| `[MiMo·structured-output]` | https://mimo.mi.com/static/docs/quick-start/usage-guide/text-generation/structured-output.md |
| `[MiMo·hyperparameters]` | https://mimo.mi.com/static/docs/api/guidance/model-hyperparameters.md |
| `[MiMo·list-models]` | https://mimo.mi.com/static/docs/api/model/list-models.md |
| `[MiMo·deprecate]` | https://mimo.mi.com/static/docs/updates/deprecate.md |
