import { afterEach, describe, expect, it } from 'vitest';
import { getMachiDegrade, reportMachiDegrade, subscribeMachiDegrade, withdrawMachiDegrade } from '@/components/visualizer/machi/degradeStatus';

// test/unit/visualizer/machi/degradeStatus.test.ts
// 町景自动降级压了几格的报告：几个运行时并存时取压得最多的那个，撤掉的不算（预览运行时不报，见 createMachiRuntime.ts）。

const a = {};
const b = {};

describe('machi degrade status', () => {
    afterEach(() => {
        withdrawMachiDegrade(a);
        withdrawMachiDegrade(b);
    });

    it('shows the most any runtime has stepped down, whichever reported last', () => {
        expect(getMachiDegrade()).toBe(0);
        reportMachiDegrade(a, 2);
        reportMachiDegrade(b, 0);
        expect(getMachiDegrade()).toBe(2);
        reportMachiDegrade(b, 3);
        expect(getMachiDegrade()).toBe(3);
        withdrawMachiDegrade(b);
        expect(getMachiDegrade()).toBe(2);
    });

    it('tells listeners only when something changed', () => {
        let calls = 0;
        const stop = subscribeMachiDegrade(() => { calls += 1; });
        reportMachiDegrade(a, 1);
        reportMachiDegrade(a, 1);
        withdrawMachiDegrade(b);
        stop();
        expect(calls).toBe(1);
    });
});
