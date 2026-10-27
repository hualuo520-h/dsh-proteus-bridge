/** 领域失败代码：一切 Agent 可纠正的失败（守卫拒绝、状态冲突、不理想结果）。 */
export declare const DOMAIN_CODES: readonly ["NOT_CONNECTED", "PROJECT_NOT_OPEN", "SCHEMATIC_EDIT_UNSUPPORTED_ON_VERSION", "SIMULATION_UNSUPPORTED_ON_VERSION", "COMPONENT_NOT_IN_PLACEABLE_WHITELIST", "COMPONENT_NOT_FOUND", "DUPLICATE_COMPONENT_REF", "PINS_NOT_QUERIED", "INVALID_PIN_REF", "PIN_NOT_FOUND", "SIM_ALREADY_RUNNING", "SIM_NOT_RUNNING", "SIM_NOT_CONVERGED", "EXTERNAL_MODIFICATION_DETECTED", "UNKNOWN_OBJECTS_PRESENT", "VERSION_ROLLBACK_BLOCKED", "VERSION_FORMAT_UNKNOWN", "INVALID_ARGUMENT", "COM_AUTOMATION_UNAVAILABLE", "UNSUPPORTED_ON_TRANSPORT", "SIM_STOP_FAILED", "SAVE_NOT_APPLIED"];
export type DomainCode = (typeof DOMAIN_CODES)[number];
/** Agent 可执行的修正提示；renderer 会把它放在结果首行。 */
export declare const DOMAIN_HINTS: Partial<Record<DomainCode, string>>;
/** 领域结果：ok 分支携带工具自身数据，fail 分支携带可解释的守卫信息。 */
export type DomainResult<T> = ({
    ok: true;
} & T) | {
    ok: false;
    code: DomainCode;
    message: string;
    hint?: string;
    details?: unknown;
};
export declare function ok<T extends Record<string, unknown>>(value: T): DomainResult<T>;
export declare function fail(code: DomainCode, message: string, extra?: {
    hint?: string;
    details?: unknown;
}): DomainResult<never>;
/** 基础设施代码：环境损坏/进程死亡等，Agent 无法通过换调用方式纠正。 */
export type InfraCode = 'PROTEUS_NOT_INSTALLED' | 'PROTEUS_VERSION_PROBE_FAILED' | 'BROKER_CRASHED' | 'BROKER_TIMEOUT' | 'COM_CALL_FAILED' | 'WHITELIST_UNREADABLE';
export declare function infra(code: InfraCode, message: string): never;
/**
 * 守卫层抛出的领域拒绝。版本适配层接口签名是 void（用户给定），
 * 与"领域失败走规范值"由此调和：守卫抛它，工具边界捕获后翻译为 fail()。
 */
export declare class GuardRejection extends Error {
    readonly code: DomainCode;
    readonly details?: unknown;
    constructor(code: DomainCode, message: string, details?: unknown);
}
/** 工具边界统一翻译：GuardRejection → 领域值；其余原样上抛（基础设施异常）。 */
export declare function asDomainResult(error: unknown): DomainResult<never> | undefined;
