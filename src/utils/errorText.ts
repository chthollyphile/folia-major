// src/utils/errorText.ts
// 抛出的错要拆成字段或者一句话的时候（放进一个对象、一条记录、界面上的一行字），从这里取：名字、那句话、
// 代号和调用栈，都是原文。日志能直接交 Error 本身的就直接交（console.warn('[模块] ...', error)）：
// 开发者面板的会话日志和 DevTools 都会记下它的调用栈。

/**
 * 抛出来的东西的那句话。一个错自己没有话（AggregateError）：是它里面第一个错的话，或者 cause 的话。
 * 抛的不是错而是一个对象（一个 adapter 把平台的回答原样抛了）：是它的 JSON。
 */
export const errorMessage = (thrown: unknown): string => {
    if (thrown instanceof Error) {
        if (thrown.message) return thrown.message;
        const { errors, cause } = thrown as { errors?: unknown; cause?: unknown };
        const inside = Array.isArray(errors) ? errors[0] : cause;
        return inside instanceof Error ? inside.message : '';
    }
    if (typeof thrown !== 'object' || thrown === null) return String(thrown);
    try {
        return JSON.stringify(thrown) ?? Object.prototype.toString.call(thrown);
    } catch {
        return Object.prototype.toString.call(thrown);
    }
};

/** 一个代号或者状态码：字符串原样，数转成字符串，别的没有。 */
export const codeText = (value: unknown): string | undefined => (
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
);

/**
 * 一个抛出的错拆成字段：名字、那句话、代号和调用栈（后两样有才带）。放进一个对象里打日志时用它：
 * 对象里的 Error 本身在会话日志里会被 JSON 化成 {}。
 */
export const errorFields = (thrown: unknown): { name: string; message: string; code?: string; stack?: string } => {
    const { name, code, stack } = (thrown instanceof Error ? thrown : {}) as { name?: unknown; code?: unknown; stack?: unknown };
    const held = codeText(code);
    return {
        name: typeof name === 'string' && name ? name : 'Error',
        message: errorMessage(thrown),
        ...(held !== undefined ? { code: held } : {}),
        ...(typeof stack === 'string' && stack ? { stack } : {}),
    };
};
