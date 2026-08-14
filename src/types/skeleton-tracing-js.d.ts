// src/types/skeleton-tracing-js.d.ts
// Minimal public contract exposed by skeleton-tracing-js 1.x.
declare module 'skeleton-tracing-js' {
    interface TraceResult {
        polylines: Array<Array<[number, number]>>;
        rects: Array<[number, number, number, number]>;
        width: number;
        height: number;
    }

    interface TraceSkeletonApi {
        fromBoolArray(mask: ArrayLike<unknown>, width: number, height: number): TraceResult;
    }

    const TraceSkeleton: TraceSkeletonApi;
    export default TraceSkeleton;
}
