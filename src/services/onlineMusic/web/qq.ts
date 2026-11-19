import type { OnlineMusicProvider } from '../../../types/onlineMusic';
import { qqProvider } from '../../../../sources/qq/core/qqProvider';

// src/services/onlineMusic/web/qq.ts
// The web build's qq (web/index.ts). For now the host's own provider, which providerRegistry.ts also registers;
// when qq moves to sources/qq/, this becomes createSource from sources/qq/core with the web env, through the
// adapter.

export const createQqWebSource = (): OnlineMusicProvider => qqProvider;
