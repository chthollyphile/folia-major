import { describe, expect, it } from 'vitest';
import { fitNebbiaCanvas } from '@/components/visualizer/nebbia/nebbiaGl';
import { NebbiaProgramBuild } from '@/components/visualizer/nebbia/nebbiaPrograms';

// test/unit/visualizer/nebbiaPrograms.test.ts
// 雾笺着色器的后台编译：编好之前 poll 不发会等 GPU 进程的调用（没有并行编译扩展时先等栅栏），
// 画布尺寸没变就不写（建了上下文以后写尺寸要同步等 GPU 进程）。

const COMPLETION_STATUS_KHR = 0x91B1;

/** 记下调过什么的假 WebGL2：`completed` 是程序编好没有，`signaled` 是栅栏到了没有。 */
const fakeGl = (withParallel: boolean) => {
    const calls: string[] = [];
    const state = { completed: false, signaled: false };
    const constants = { SYNC_GPU_COMMANDS_COMPLETE: 0x9117, SYNC_STATUS: 0x9114, SIGNALED: 0x9119, UNSIGNALED: 0x9118, LINK_STATUS: 0x8B82, VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30 };
    const gl = {
        ...constants,
        getExtension: (name: string) => (name === 'KHR_parallel_shader_compile' && withParallel ? { COMPLETION_STATUS_KHR } : null),
        createShader: () => ({}),
        shaderSource: () => undefined,
        compileShader: () => undefined,
        createProgram: () => ({}),
        attachShader: () => undefined,
        bindAttribLocation: () => undefined,
        linkProgram: () => undefined,
        flush: () => undefined,
        fenceSync: () => { calls.push('fenceSync'); return {}; },
        getSyncParameter: () => { calls.push('getSyncParameter'); return state.signaled ? constants.SIGNALED : constants.UNSIGNALED; },
        deleteSync: () => { calls.push('deleteSync'); },
        getProgramParameter: (_p: unknown, pname: number) => {
            calls.push(pname === COMPLETION_STATUS_KHR ? 'completionStatus' : 'linkStatus');
            return pname === COMPLETION_STATUS_KHR ? state.completed : true;
        },
        getAttachedShaders: () => [],
        deleteShader: () => undefined,
    };
    return { gl: gl as unknown as WebGL2RenderingContext, calls, state };
};

describe('nebbia program build', () => {
    it('with parallel compile asks only for completion until it is done, with no fence', () => {
        const { gl, calls, state } = fakeGl(true);
        const build = new NebbiaProgramBuild(gl, true);
        expect(build.poll()).toBe(false);
        expect(calls).not.toContain('fenceSync');
        expect(calls).not.toContain('linkStatus');
        state.completed = true;
        expect(build.poll()).toBe(true);
        expect(calls).toContain('linkStatus');
    });

    it('without parallel compile waits for the fence before asking for the link status, and deletes it once', () => {
        const { gl, calls, state } = fakeGl(false);
        const build = new NebbiaProgramBuild(gl, true);
        expect(calls).toEqual(['fenceSync']);
        expect(build.poll()).toBe(false);
        expect(build.poll()).toBe(false);
        expect(calls).toEqual(['fenceSync', 'getSyncParameter', 'getSyncParameter']);
        state.signaled = true;
        expect(build.poll()).toBe(true);
        expect(build.poll()).toBe(true);
        expect(calls.filter(c => c === 'deleteSync')).toHaveLength(1);
        expect(calls.indexOf('deleteSync')).toBeLessThan(calls.indexOf('linkStatus'));
    });
});

describe('nebbia canvas fit', () => {
    it('writes the size only when it changes', () => {
        const writes: string[] = [];
        let width = 300, height = 150;
        const canvas = {
            get width() { return width; },
            set width(v: number) { writes.push(`w${v}`); width = v; },
            get height() { return height; },
            set height(v: number) { writes.push(`h${v}`); height = v; },
        } as unknown as HTMLCanvasElement;
        fitNebbiaCanvas(canvas, 1600, 900, 1.6);
        expect(writes).toEqual(['w2560', 'h1440']);
        fitNebbiaCanvas(canvas, 1600, 900, 1.6);
        expect(writes).toHaveLength(2);
        fitNebbiaCanvas(canvas, 1600, 800, 1.6);
        expect(writes).toEqual(['w2560', 'h1440', 'h1280']);
    });
});
