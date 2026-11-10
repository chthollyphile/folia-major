import type { PonderSurfaceDeclarations } from './surfaceDeclarations';

// src/components/ponder/surfaces/plain.surface.tsx
// 只有面板外框、里面什么都不画的那一种。模组的面板默认用它。

export default {
    plain: () => null,
} satisfies PonderSurfaceDeclarations;
