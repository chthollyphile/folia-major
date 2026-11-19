import type { OnlineMusicProvider } from '../../../types/onlineMusic';
import { kugouProvider } from '../../../../sources/kugou/core/kugouProvider';

// src/services/onlineMusic/web/kugou.ts
// The web build's kugou (web/index.ts). For now the host's own provider, which providerRegistry.ts also registers;
// when kugou moves to sources/kugou/, this becomes createSource from sources/kugou/core with the web env, through the
// adapter.

export const createKugouWebSource = (): OnlineMusicProvider => kugouProvider;
