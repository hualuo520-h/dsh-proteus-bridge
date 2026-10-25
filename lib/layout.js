/**
 * 确定性布局辅助（薄桥接边界内的"布局辅助"）：纯函数，零 COM。
 * 行主序网格 + 可选按 ref 前缀分区。输出是"模板原点"坐标建议；
 * Agent 放置后必须 proteus_query_pins 校正引脚世界坐标，不得据此推算连线。
 */
import { DEFAULT_GRID_MM, UNITS_PER_MM } from './com/protocol.js';
import { fail, ok } from './errors.js';
export function suggestLayout(req) {
    const refs = [...new Set(req.refs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (refs.length === 0) {
        return fail('INVALID_ARGUMENT', 'refs 为空：至少给一个元件引用');
    }
    const grid = Math.max(1, req.gridMm ?? DEFAULT_GRID_MM) * UNITS_PER_MM;
    const columns = Math.max(1, req.columns ?? 5);
    const originX = req.originX ?? 40 * UNITS_PER_MM;
    const originY = req.originY ?? 40 * UNITS_PER_MM;
    const groups = req.partitionPrefixes
        ? req.partitionPrefixes.map((p) => ({ label: p, refs: refs.filter((r) => r.startsWith(p)) }))
        : [{ label: '', refs }];
    if (req.partitionPrefixes) {
        const grouped = new Set(groups.flatMap((g) => g.refs));
        const rest = refs.filter((r) => !grouped.has(r));
        if (rest.length > 0)
            groups.push({ label: '其它', refs: rest });
    }
    const suggestions = [];
    let y = originY;
    for (const group of groups) {
        let x = originX;
        let col = 0;
        for (const ref of group.refs) {
            // partition 只在分区标签非空时出现：写 undefined 会留下一个值为 undefined 的
            // 自有属性，宿主侧 lossless-JSON 快照判定失败（"value is not lossless JSON"）。
            suggestions.push(group.label
                ? { ref, x, y, rotationDeg: 0, partition: group.label }
                : { ref, x, y, rotationDeg: 0 });
            x += grid;
            col += 1;
            if (col >= columns) {
                col = 0;
                x = originX;
                y += grid;
            }
        }
        y += grid * 2; // 分区之间留一行空白
    }
    return ok({
        suggestions,
        notes: [
            '坐标是元件模板原点，不保证是元件中心（100000 单位 = 1mm，Y 轴向上）。',
            '放置后必须 proteus_query_pins 查询引脚真实世界坐标与出线方向，再 proteus_connect_pins 连线。',
        ],
    });
}
