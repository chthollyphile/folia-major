import type { FoliumSourceFmCatalog } from '@folia/folium';
import { personalFmModes } from '@folia/folium-source-kit';
import { neteaseTextKey } from './neteaseEnv';

// sources/netease/core/neteaseFmCatalog.ts
// 网易云私人 FM 的模式与场景（recommendations@1.getPersonalFmCatalog）。迁之前这份目录是宿主的
// DEFAULT_PERSONAL_FM_CATALOG（src/services/onlineMusic/fmModes.ts），网易云的 provider 原样交出；宿主那份还留着
// （存下的模式选择按它校正，目录没读到之前命令面板也显示它），这里照它抄一份：id 是网易云 `/personal/fm/mode` 的参数，
// 拼音关键字一样，名字来自模组自己的语言表（fm.mode.* / fm.scene.* / fm.category.*）。

type Category = 'mood' | 'activity' | 'genre' | 'language';

const CATEGORIES: readonly Category[] = ['mood', 'activity', 'genre', 'language'];

// [id, category, ...keywords]
const SCENES: ReadonlyArray<readonly [string, Category, ...string[]]> = [
    ['NIGHT_EMO', 'mood', 'shanggan', 'sg'],
    ['CURE', 'mood', 'zhiyu', 'zy'],
    ['CHEERFUL', 'mood', 'huankuai', 'hk'],
    ['LYRICAL', 'mood', 'shuqing', 'sq'],
    ['INSPIRATIONAL', 'mood', 'lizhi', 'lz'],
    ['RELAX', 'mood', 'fangsong', 'fs'],
    ['SWEET', 'mood', 'qingge', 'qg'],

    ['EXERCISE', 'activity', 'yundong', 'yd'],
    ['FOCUS', 'activity', 'zhuanzhu', 'zz'],
    ['SLEEP_HELP', 'activity', 'zhumian', 'zm'],
    ['TAKE_SHOWER', 'activity', 'xizao', 'xz'],
    ['COMMUTE', 'activity', 'chuxing', 'cx'],
    ['COFFEE_SHOP', 'activity', 'kafeiguan', 'kfg'],
    ['GAMES', 'activity', 'youxi', 'yx'],
    ['DANCE', 'activity', 'wudao', 'wd'],
    ['RAINY', 'activity', 'yutian', 'yt'],

    ['RHYTHM_BLUES', 'genre', 'rb', 'randb'],
    ['RAP', 'genre', 'shuochang', 'sc'],
    ['K_POP', 'genre', 'kpop'],
    ['ELECTRONIC', 'genre', 'dianyin', 'dy'],
    ['ROCK', 'genre', 'yaogun', 'yg'],
    ['FOLK', 'genre', 'minyao', 'my'],
    ['GUDIAN', 'genre', 'gudian', 'gd'],
    ['JAZZ', 'genre', 'jueshi', 'js'],
    ['BLUE', 'genre', 'landiao', 'ld'],
    ['PUNK', 'genre', 'fangke', 'fk'],
    ['COUNTRY', 'genre', 'xiangcunyue', 'xcy'],
    ['LIGHT', 'genre', 'qingyinyue', 'qyy'],
    ['GUOFENG', 'genre', 'guofeng', 'gf'],
    ['MANYAO', 'genre', 'manyao', 'manyaodj', 'my'],
    ['MUSICAL', 'genre', 'yinyueju', 'yyj'],
    ['ACG', 'genre', 'erciyuan', 'ecy'],
    ['JINGDIAN', 'genre', 'jingdian', 'jd'],
    ['ORIGINAL_MUSICIAL', 'genre', 'baozangyuanchuang', 'bzyc'],
    ['YINGSHI', 'genre', 'yingshi', 'ys'],

    ['CHINESE', 'language', 'huayu', 'hy'],
    ['ENGLISH', 'language', 'oumei', 'om'],
    ['YUEYU', 'language', 'yueyu', 'yy'],
    ['JAPANESE', 'language', 'riyu', 'ry'],
    ['FRANCH', 'language', 'fayu', 'fy'],
    ['LATIN', 'language', 'lading', 'ld'],
    ['GLOBAL', 'language', 'quanqiu', 'qq'],
];

/** The scene ids, for the tests (they are NetEase's own parameters). */
export const NETEASE_FM_SCENE_IDS: readonly string[] = SCENES.map(([id]) => id);

/** The whole catalogue: every standard mode, the scenes of SCENE_RCMD and their categories. */
export const neteaseFmCatalog = (): FoliumSourceFmCatalog => ({
    modes: personalFmModes(['DEFAULT', 'FAMILIAR', 'EXPLORE', 'PUZZLE_MODE_RCMD', 'SCENE_RCMD'], id => neteaseTextKey(`fm.mode.${id}`)),
    scenes: SCENES.map(([id, category, ...keywords]) => ({ id, category, label: neteaseTextKey(`fm.scene.${id}`), keywords })),
    categories: CATEGORIES.map(id => ({ id, label: neteaseTextKey(`fm.category.${id}`) })),
});
