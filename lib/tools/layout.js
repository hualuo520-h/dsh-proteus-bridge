/** 布局辅助工具（确定性，纯函数，零 COM）。 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { suggestLayout } from '../layout.js';
import { present, proteusOutput } from '../toolkit.js';
export function registerLayoutTools(ctx) {
    ctx.tools.register(defineTool({
        name: 'proteus_suggest_layout',
        description: '确定性网格/分区布局建议（纯本地计算，不需要连接 Proteus）。按 ref 排序后行主序网格排布，可用 partitionPrefixes 按前缀分区。返回的是模板原点坐标建议——放置后仍必须 proteus_query_pins 获取引脚真实坐标。让 Agent 不必凭空猜坐标。',
        parameters: {
            refs: {
                type: 'array',
                required: true,
                description: '要布局的元件引用列表。',
                items: { type: 'string' },
            },
            columns: { type: 'integer', description: '每行元件数（默认 5）。' },
            gridMm: { type: 'integer', description: '元件间距 mm（默认 40）。' },
            originX: { type: 'integer', description: '网格起点 X（原生单位，默认 4000000 = 40mm）。' },
            originY: { type: 'integer', description: '网格起点 Y（原生单位，Y 向上）。' },
            partitionPrefixes: {
                type: 'array',
                description: '按前缀分区，如 ["U","R","C"]；未匹配的进"其它"区。',
                items: { type: 'string' },
            },
        },
        output: proteusOutput(),
        execute(args) {
            return suggestLayout(args);
        },
        presentCall: present('生成布局建议', 'read'),
    }));
}
