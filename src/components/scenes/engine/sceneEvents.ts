import type { Disposer, SceneEvents } from '../definition';

// src/components/scenes/engine/sceneEvents.ts
// 场景的事件和订阅：ctx.on 的监听、ctx.settings.onChange 这类挂在宿主外面的订阅都记在这里，
// 场景停下时一起放掉；场景的回调抛错就交给 fail（回到用户的歌词样式），之后不再调这个场景的任何回调。

type Listener = (event: never) => void;

export interface SceneEventBus {
    on: <K extends keyof SceneEvents>(type: K, fn: (event: SceneEvents[K]) => void) => Disposer;
    emit: <K extends keyof SceneEvents>(type: K, event: SceneEvents[K]) => void;
    /** Wraps a scene callback: a throw goes to fail, and nothing is called once the bus is disposed. */
    guard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
    /** Keeps a subscription the scene made outside the bus, released on dispose (or by the scene). */
    track: (release: Disposer) => Disposer;
    dispose: () => void;
}

export const createSceneEventBus = (fail: (error: unknown) => void): SceneEventBus => {
    let disposed = false;
    const listeners = new Map<keyof SceneEvents, Set<Listener>>();
    const releases = new Set<Disposer>();

    const guard: SceneEventBus['guard'] = fn => (...args) => {
        if (disposed) return;
        try {
            fn(...args);
        } catch (error) {
            fail(error);
        }
    };

    return {
        on: (type, fn) => {
            const set = listeners.get(type) ?? new Set();
            set.add(fn);
            listeners.set(type, set);
            return () => { set.delete(fn); };
        },
        emit: (type, event) => {
            for (const listener of [...(listeners.get(type) ?? [])]) {
                if (disposed) return;
                guard(listener as (event: SceneEvents[typeof type]) => void)(event);
            }
        },
        guard,
        track: (release) => {
            if (disposed) {
                release();
                return () => {};
            }
            let released = false;
            const once = () => {
                if (released) return;
                released = true;
                releases.delete(once);
                release();
            };
            releases.add(once);
            return once;
        },
        dispose: () => {
            disposed = true;
            listeners.clear();
            [...releases].forEach(release => release());
        },
    };
};
