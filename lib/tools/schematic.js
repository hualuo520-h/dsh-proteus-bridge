/** 原理图编辑工具：放置/引脚查询/连线/保存。所有编辑类工具独占调度。 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { present, proteusOutput } from '../toolkit.js';
export function registerSchematicTools(ctx, session) {
    ctx.tools.register(defineTool({
        name: 'proteus_list_placeable_components',
        description: '列出插件已验证可脚本放置的器件白名单（放置→保存→重开验证过的集合）。这不是 Proteus 器件库目录：目录能搜到的器件若不在白名单内，放置会被 COMPONENT_NOT_IN_PLACEABLE_WHITELIST 拒绝。不需要先连接。',
        parameters: {},
        output: proteusOutput(),
        execute() {
            return session.listPlaceable().then((components) => ({ ok: true, components }));
        },
        presentCall: present('列出可放置器件白名单', 'read'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_place_component',
        description: '在原理图放置一个白名单器件。坐标是元件模板原点（100000 单位 = 1mm，Y 轴向上），不保证是元件中心——放置后必须用 proteus_query_pins 查询引脚真实世界坐标，不要从放置坐标推算。device 必须来自 proteus_list_placeable_components。完成后该元件的引脚查询缓存自动失效。',
        parameters: {
            ref: { type: 'string', required: true, description: '元件引用（如 R1、C2）。' },
            device: { type: 'string', required: true, description: '白名单中的器件名（如 RES）。' },
            x: { type: 'integer', required: true, description: '放置 X（原生单位，100000=1mm）。' },
            y: { type: 'integer', required: true, description: '放置 Y（原生单位，Y 轴向上）。' },
            library: { type: 'string', description: '白名单库同名器件有歧义时指定。' },
            rotationDeg: { type: 'integer', description: '旋转角度（0/90/180/270，默认 0）。' },
        },
        output: proteusOutput(),
        timeoutMs: 60_000,
        execute(args, exec) {
            return session.placeComponent(args, exec.signal);
        },
        presentCall: present('放置元件', 'write'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_query_pins',
        description: '批量查询元件引脚的真实世界坐标与出线方向（pins(ref)）。连线前的强制步骤：proteus_connect_pins 会检查本工具的查询缓存，没查过就拒绝。多个 ref 一次传入（单次跨进程往返）。',
        parameters: {
            refs: {
                type: 'array',
                required: true,
                description: '要查询的元件引用列表，如 ["R1","C2","U1"]。',
                items: { type: 'string' },
            },
        },
        output: proteusOutput(),
        timeoutMs: 60_000,
        execute(args, exec) {
            return session.queryPins(args.refs, exec.signal);
        },
        presentCall: present('查询元件引脚', 'read'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_connect_pins',
        description: '连接两个引脚（引脚引用形如 "R1.2"）。强制"先查引脚再连线"：任一端点没有 proteus_query_pins 缓存时返回 PINS_NOT_QUERIED；引脚号与缓存不符返回 PIN_NOT_FOUND。共享引脚的连接会自动形成真实结点，禁止也不要尝试用坐标画线模拟连接。',
        parameters: {
            a: { type: 'string', required: true, description: '端点 A 引脚引用，如 "R1.2"。' },
            b: { type: 'string', required: true, description: '端点 B 引脚引用，如 "C1.2"。' },
        },
        output: proteusOutput(),
        timeoutMs: 60_000,
        execute(args, exec) {
            return session.connectPins(args, exec.signal);
        },
        presentCall: present('连接引脚', 'write'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_save_schematic',
        description: '保存当前工程（原子替换语义）。守卫链：未知对象预检（UNKNOWN_OBJECTS_PRESENT 时拒绝整体重写，避免删除内容）→ 外部修改检测（文件被外部改动需 overwrite:true）→ 版本回退守卫（Proteus 9 格式文件需 confirmRollback:true 且已备份）→ 写临时文件校验 → 原子替换。overwrite 与 confirmRollback 必须显式传入，默认 false。',
        parameters: {
            overwrite: {
                type: 'boolean',
                description: '目标文件自连接/上次保存后被外部修改时，显式 true 才允许覆盖（默认 false）。',
            },
            confirmRollback: {
                type: 'boolean',
                description: '确认已备份且接受降版本风险时显式 true（默认 false）。',
            },
        },
        output: proteusOutput(),
        timeoutMs: 180_000,
        execute(args, exec) {
            return session.saveSchematic(args, exec.signal);
        },
        presentCall: present('保存原理图工程', 'write'),
    }));
}
