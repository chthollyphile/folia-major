import type { OnlineMusicProvider } from '../../../types/onlineMusic';
import { neteaseProvider } from '../netease/neteaseProvider';

// src/services/onlineMusic/web/netease.ts
// The web build's netease (web/index.ts). For now the host's own provider, which providerRegistry.ts also registers;
// when netease moves to sources/netease/, this becomes createSource from sources/netease/core with the web env, through the
// adapter.

export const createNeteaseWebSource = (): OnlineMusicProvider => neteaseProvider;
