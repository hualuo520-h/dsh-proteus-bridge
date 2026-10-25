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
];
/** Agent 可执行的修正提示；renderer 会把它放在结果首行。 */
export const DOMAIN_HINTS = {
    NOT_CONNECTED: '先调用 proteus_connect 建立会话。',
    PROJECT_NOT_OPEN: 'proteus_connect 时传入 projectPath 打开工程。',
    SCHEMATIC_EDIT_UNSUPPORTED_ON_VERSION: '当前 Proteus 版本的原理图编辑 COM 能力探测未通过，请改用 Proteus 8（参考 8.16 SP3）。',
    SIMULATION_UNSUPPORTED_ON_VERSION: '当前版本不支持脚本驱动仿真，请改用 Proteus 8。',
    COMPONENT_NOT_IN_PLACEABLE_WHITELIST: '只能放置 proteus_list_placeable_components 列出的已验证器件；目录可查不等于可脚本导入。',
    PINS_NOT_QUERIED: '先对列出的元件调用 proteus_query_pins，再连线。',
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
    SIM_STOP_FAILED: '停止仿真未生效（重试 3 次后仍未 idle）。查看 Proteus 窗口是否有弹出对话框遮挡，处理后重试。',
};
export function ok(value) {
    return { ok: true, ...value };
}
export function fail(code, message, extra) {
    return {
        ok: false,
        code,
        message,
        hint: extra?.hint ?? DOMAIN_HINTS[code],
        details: extra?.details,
    };
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
