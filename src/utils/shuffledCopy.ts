// src/utils/shuffledCopy.ts
// 均匀打乱（Fisher–Yates）出一份新数组，不动原数组。集合的「随机播放」用它把整批歌打乱后再交给播放器；
// 与队列的「打乱」（usePlaybackQueueController.shuffleQueue）是同一种洗法，只是没有要钉在最前面的当前歌。

/** 返回 `items` 打乱后的副本。`random` 返回 [0, 1)，默认 Math.random（单测传固定序列）。 */
export const shuffledCopy = <T>(items: readonly T[], random: () => number = Math.random): T[] => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(random() * (index + 1));
        [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
};
