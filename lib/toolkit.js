/**
 * 所有工具共用的 output：顶层轻校验（ok/code/message/hint），
 * 有效载荷字段 additionalProperties 放行——领域失败分支与成功分支共用一张 schema，
 * 精确形状由各工具 execute 内部保证。
 */
export function proteusOutput() {
    return {
        schema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                ok: { type: 'boolean', description: 'false = 领域级失败（守卫/状态），见 code' },
                code: { type: 'string', description: '领域失败代码，如 PINS_NOT_QUERIED' },
                message: { type: 'string' },
                hint: { type: 'string', description: 'Agent 可执行的修正提示' },
            },
        },
        render(_args, value) {
            let head = '';
            if (value && value.ok === false) {
                head = `PROTEUS ${value.code}: ${value.message}${value.hint ? `\n修正提示: ${value.hint}` : ''}\n`;
            }
            return [{ type: 'text', text: head + JSON.stringify(value, null, 2) }];
        },
    };
}
export function present(title, kind) {
    return () => ({ card: 'generic', kind, title });
}
