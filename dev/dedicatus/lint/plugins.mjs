import comments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
// dev/dedicatus/lint/plugins.mjs
// 从隔离的 lint 环境（本目录的 node_modules）取出 ESLint 插件，交给仓库根目录的 eslint.config.mjs。
// 根目录没有装 ESLint：从这里 import，Node 才会在本目录的 node_modules 里解析，typescript-eslint 也就用上这里钉的 TypeScript 6.0。

export { comments, globals, js, reactHooks, stylistic, tseslint };
