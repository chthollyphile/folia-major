import React from 'react';
import { useIsPresent } from 'framer-motion';
import { ACTIVE_GRID_ATTR, LEAVING_GRID_ATTR } from '../transitions/gridMorphContract';

// src/library/suites/grid/shared/ActiveGridMarker.tsx
// 把「我是不是当前那一层网格」写进 DOM，供移形换影的测量读取：它渲染一个不占位置的
// 标记元素，带着 data-folia-active-grid；**它的父元素**就是当前那一层（见 morphProbes 的
// activeGridRoot）。所以要把它直接放在网格根节点（或包含全部卡片与落点的容器）里面。
//
// 为什么是一个几行的子组件，而不是在 GridView / ArtistGridView 的根节点上直接调
// useIsPresent()：那两个组件都是上千行的树（几十张卡片、每张都有图片和按钮），而
// presence 上下文恰好在**退出动画开始的那一帧**翻转 —— 在根节点订阅它，整个网格会在最不
// 该掉帧的时刻重渲染一次。订阅关在这里之后，翻转只重渲染这个组件。
//
// 为什么是渲染出来的元素，而不是在 effect 里往根节点上写属性：转场在「挂载这一页的那次
// 提交」的 layout effect 里量落点，标记必须那时就在。effect 写属性赶不上：被动 effect 在
// 提交之后才跑；layout effect 又跑在父元素的 ref 接上之前（子先于父），第一次挂载时拿不到
// 根节点。渲染出来的元素随这次提交一起进 DOM，没有先后问题。

//
// 这一层开始退出时，同一个元素换成 data-folia-leaving-grid：返回时要散开的是这一层的卡片
// （见 morphProbes 的 leavingGridRoot）。

const ActiveGridMarker: React.FC = () => (
    <span hidden aria-hidden="true" {...{ [useIsPresent() ? ACTIVE_GRID_ATTR : LEAVING_GRID_ATTR]: '' }} />
);

export default ActiveGridMarker;
