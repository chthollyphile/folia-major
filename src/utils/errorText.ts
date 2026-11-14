// src/utils/errorText.ts
// 宿主里拆错误文字的入口（AGENTS.md「日志」一节说的那个）。实现在 packages/folium-source-kit/src/errorText.ts：
// 音源模组（sources/<id>/）不能 import src/，要和宿主用同一套，所以放进了 kit，这里原样转出。
export { codeText, errorFields, errorMessage } from '@folia/folium-source-kit';
