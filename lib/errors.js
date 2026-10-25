/**
 * 错误模型：领域失败写规范值（{ ok:false, code, ... }，由 output.render 解释），
 * 基础设施故障抛 HarnessError（registry 会把 code 带进 error.info）。
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** 领域失败代码：一切 Agent 可纠正的失败（守卫拒绝、状态冲突、不理想结果）。 */
export const DOMAIN_CODES = [
    'NOT_CONNECTED',
    'PROJECT_NOT_OPEN',
    'SCHEMATIC_EDIT_UNSUPPORTED_ON_VERSION',
    'SIMULATION_UNSUPPORTED_ON_VERSION',
    'COMPONENT_NOT_IN_PLACEABLE_WHITELIST',
    'COMPONENT_NOT_FOUND',
    'DUPLICATE_COMPONENT_REF',
    'PINS_NOT_QUERIED',
    'INVALID_PIN_REF',
    'PIN_NOT_FOUND',
    'SIM_ALREADY_RUNNING',
    'SIM_NOT_RUNNING',
    'SIM_NOT_CONVERGED',
    'EXTERNAL_MODIFICATION_DETECTED',
    'UNKNOWN_OBJECTS_PRESENT',
    'VERSION_ROLLBACK_BLOCKED',
    'VERSION_FORMAT_UNKNOWN',
    'INVALID_ARGUMENT',
    'COM_AUTOMATION_UNAVAILABLE',
    'UNSUPPORTED_ON_TRANSPORT',
    'SIM_STOP_FAILED',
    'SAVE_NOT_APPLIED',
];
/** Agent 可执行的修正提示；renderer 会把它放在结果首行。 */
export const DOMAIN_HINTS = {
    NOT_CONNECTED: '先调用 proteus_connect 建立会话。',
    PROJECT_NOT_OPEN: 'proteus_connect 时传入 projectPath 打开工程。',
    SCHEMATIC_EDIT_UNSUPPORTED_ON_VERSION: '当前 Proteus 版本的原理图编辑 COM 能力探测未通过，请改用 Proteus 8（参考 8.16 SP3）。',
    SIMULATION_UNSUPPORTED_ON_VERSION: '当前版本不支持脚本驱动仿真，请改用 Proteus 8。',
    COMPONENT_NOT_IN_PLACEABLE_WHITELIST: '只能放置 proteus_list_placeable_components 列出的已验证器件；目录可查不等于可脚本导入。',
    COMPONENT_NOT_FOUND: '用 proteus_query_pins 确认元件引用拼写；原理图上不存在的元件无法查询引脚。',
    DUPLICATE_COMPONENT_REF: '换一个未被占用的元件引用（如 R2、C3）后重新放置。',
    PINS_NOT_QUERIED: '先对列出的元件调用 proteus_query_pins，再连线。',
    INVALID_PIN_REF: '引脚引用必须是 元件引用.引脚号 的形式（如 R1.2），且引脚号来自 proteus_query_pins 的结果。',
    PIN_NOT_FOUND: '用 proteus_query_pins 重新查询该元件的真实引脚号。',
    SIM_ALREADY_RUNNING: '先 proteus_sim_stop 或 proteus_sim_status 查看状态。',
    SIM_NOT_RUNNING: '先 proteus_sim_start。',
    SIM_NOT_CONVERGED: '仿真未收敛/已失败：检查电源与地、模型参数后重新 start。',
    EXTERNAL_MODIFICATION_DETECTED: '目标文件被外部程序修改过。确认后用 overwrite:true 显式覆盖。',
    UNKNOWN_OBJECTS_PRESENT: '工程包含插件无法理解的未知对象，已拒绝整体重写以避免删除内容。请人工处理。',
    VERSION_ROLLBACK_BLOCKED: '磁盘文件的格式版本高于目标版本（Proteus 9 文件不能被 8 打开）。确认已备份后用 confirmRollback:true 显式放行。',
    VERSION_FORMAT_UNKNOWN: '无法从磁盘判定工程格式版本，保存被拒绝（fail-closed）。',
    INVALID_ARGUMENT: '按工具 schema 修正参数后重试。',
    COM_AUTOMATION_UNAVAILABLE: '本机 Proteus 未提供 Labcenter COM 自动化服务器（shipping 的 Proteus 8 ≤8.17 均无）；插件已自动改走 UI 传输，能力见 connect 结果。',
    UNSUPPORTED_ON_TRANSPORT: '当前传输层不支持该操作。UI 传输只覆盖仿真生命周期与保存；元件放置/引脚/连线需要 COM 自动化或未来的原理图脚本接口。',
    SIM_STOP_FAILED: '停止仿真未生效（Shift+Pause、菜单停止与工具栏停止键均试过）：查看 Proteus 窗口是否有弹出对话框遮挡或状态异常，处理后重试。',
    SAVE_NOT_APPLIED: 'Ctrl+S 未使工程文件发生变化：检查 Proteus 是否有未处理的模态对话框（如"另存为/格式转换/只读文件"），处理后重试。',
};
export function ok(value) {
    return { ok: true, ...value };
}
/**
 * 领域失败值。
 * 只写入有内容的字段：值为 undefined 的自有属性会让宿主的 lossless-JSON 快照判定失败
 * （`value is not lossless JSON`），把一个本该给 Agent 看的领域失败变成工具层错误，
 * 连 code/message/hint 一起丢掉。所以 hint 与 details 都必须条件写入。
 */
export function fail(code, message, extra) {
    const result = { ok: false, code, message };
    const hint = extra?.hint ?? DOMAIN_HINTS[code];
    if (hint !== undefined) {
        result.hint = hint;
    }
    if (extra?.details !== undefined) {
        result.details = extra.details;
    }
    return result;
}
export function infra(code, message) {
    throw new HarnessError(`[${code}] ${message}`, code);
}
/**
 * 守卫层抛出的领域拒绝。版本适配层接口签名是 void（用户给定），
 * 与"领域失败走规范值"由此调和：守卫抛它，工具边界捕获后翻译为 fail()。
 */
export class GuardRejection extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'GuardRejection';
        this.code = code;
        this.details = details;
    }
}
/** 工具边界统一翻译：GuardRejection → 领域值；其余原样上抛（基础设施异常）。 */
export function asDomainResult(error) {
    if (error instanceof GuardRejection) {
        return fail(error.code, error.message, { details: error.details });
    }
    return undefined;
}
