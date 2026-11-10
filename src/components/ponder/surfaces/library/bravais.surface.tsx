import PonderBravaisHomeSeamSurface from '../PonderBravaisHomeSeamSurface';
import PonderBravaisStripSurface from '../PonderBravaisStripSurface';
import PonderBravaisWallSurface from '../PonderBravaisWallSurface';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/library/bravais.surface.tsx
// bravais 资料库的三张合成界面报上名字：墙（bravais-wall），首页那道窄缝与集合 / 歌手页的完整信息条
// （bravais-seam-home / bravais-seam-strip）。画它们的文件和几何表还在 surfaces/ 根上
// （PonderBravais*.tsx、ponderBravais*Geometry.ts），测试按那个路径引用几何表。

export default {
    'bravais-wall': PonderBravaisWallSurface,
    'bravais-seam-home': PonderBravaisHomeSeamSurface,
    'bravais-seam-strip': PonderBravaisStripSurface,
} satisfies PonderSurfaceDeclarations;
