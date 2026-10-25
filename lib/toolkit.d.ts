/**
 * 工具定义共享件：统一的 output schema/render、presentCall，避免 11 个工具重复样板。
 * 形状依据 dsh-tools 实测契约：
 *  - output { schema, render } 是注册强制项；
 *  - execute 返回值先过 output.schema 校验，再由 render(args, value) 投影成内容块；
 *  - presentCall 只做展示、不得抛异常（会在任意历史日志参数上回放）。
 */
import type { DomainResult } from './errors.js';
/**
 * 所有工具共用的 output：顶层轻校验（ok/code/message/hint），
 * 有效载荷字段 additionalProperties 放行——领域失败分支与成功分支共用一张 schema，
 * 精确形状由各工具 execute 内部保证。
 */
export declare function proteusOutput(): {
    schema: {
        type: "object";
        additionalProperties: true;
        properties: {
            ok: {
                type: "boolean";
                description: string;
            };
            code: {
                type: "string";
                description: string;
            };
            message: {
                type: "string";
            };
            hint: {
                type: "string";
                description: string;
            };
        };
    };
    render(_args: unknown, value: DomainResult<Record<string, unknown>>): {
        type: "text";
        text: string;
    }[];
};
export declare function present(title: string, kind: 'read' | 'write'): () => {
    card: "generic";
    kind: "read" | "write";
    title: string;
};
