// src/library/core/shared/session.contract.ts
// 跨 suite 的浏览会话。会话只存语义（筛选词、条目键），布局坐标由各 suite 自己存。
// （原先这里还有 renderer 标识 LibraryRendererId；R3 起换成 suite 契约里的 LibrarySuiteId。）

/** 跨 renderer 保留的浏览会话；布局坐标不在这里，由各 renderer 自己存。 */
export type LibraryBrowseSession = {
    query: string;
    focusedEntryKey: string | null;
};

/**
 * 筛选词的读写端口：命令面板（筛选框）经它读写某个 surface 的筛选词。core 给出它（集合 surface 的筛选词在
 * 浏览会话里），筛选框贴在哪个元素上（anchor）属于 renderer，由 renderer 注册时补上——core 不碰 DOM。
 * getQuery 每次现读，不缓存。
 */
export type LibraryQueryPort = {
    getQuery: () => string;
    setQuery: (query: string) => void;
};
