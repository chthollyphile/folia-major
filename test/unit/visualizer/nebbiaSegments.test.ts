import { describe, expect, it } from 'vitest';
import { NebbiaSegments, SEGMENT_FLOATS } from '@/components/visualizer/nebbia/nebbiaSegments';

// test/unit/visualizer/nebbiaSegments.test.ts
// 擦痕遮罩的线段收集器：照画布的路径规则拆成线段（子路径之间不连、单点不画），按当前变换换算坐标和线宽。

const segs = (s: NebbiaSegments) => Array.from({ length: s.count }, (_, i) => Array.from(s.data.subarray(i * SEGMENT_FLOATS, (i + 1) * SEGMENT_FLOATS)));

describe('nebbia mask segments', () => {
    it('splits a path into segments per subpath and drops lone points', () => {
        const s = new NebbiaSegments();
        s.moveTo(0, 0); s.lineTo(10, 0); s.lineTo(10, 10);
        s.moveTo(50, 50);
        s.moveTo(20, 20); s.lineTo(30, 20);
        s.stroke(4, 0.5);
        expect(segs(s)).toEqual([[0, 0, 10, 0, 4, 0.5], [10, 0, 10, 10, 4, 0.5], [20, 20, 30, 20, 4, 0.5]]);
    });

    it('applies the transform to points and width, and grows past its buffer', () => {
        const s = new NebbiaSegments();
        s.setTransform(0, 2, -2, 0, 100, 0);
        s.moveTo(1, 0); s.lineTo(1, 1);
        s.stroke(3, 1);
        expect(segs(s)[0]).toEqual([100, 2, 98, 2, 6, 1]);
        s.setTransform(1, 0, 0, 1, 0, 0);
        for (let i = 0; i < 5000; i += 1) { s.moveTo(i, 0); s.lineTo(i, 1); s.stroke(1, 1); }
        expect(s.count).toBe(5001);
        s.clear();
        expect(s.count).toBe(0);
    });
});
