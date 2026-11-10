// src/library/core/collection/collectionDescription.ts
// 集合页要显示的描述（歌单简介、专辑介绍……）取哪一份：与网格集合页的信息面板同一条规则——资源的详情
// （CollectionResourceSnapshot.detail）盖在集合描述（LibraryCollectionDescriptor）上，详情里带了 description
// 字段就以详情为准（哪怕是空），否则用集合描述里的。本地 / Navidrome 的集合描述里这一栏是首页卡片上的那行字
// （「文件夹」、专辑歌手、歌单所有者），网格照样显示，这里也照样给。
// 不解析 HTML、不改换行：文本原样交给界面，界面按纯文本（保留换行）显示。只去掉首尾空白，空的当作没有。

type DescribedCollection = { readonly description?: string };

/** 集合页的描述；没有（或只有空白）时为 undefined，界面据此不占位。 */
export const resolveCollectionDescription = (
    descriptor: DescribedCollection | null | undefined,
    detail: DescribedCollection | null | undefined,
): string | undefined => {
    // 与网格的 `{ ...descriptor, ...detail }.description` 同义：详情里有这个字段就用详情的。
    const raw = detail && Object.prototype.hasOwnProperty.call(detail, 'description')
        ? detail.description
        : descriptor?.description;
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text || undefined;
};
