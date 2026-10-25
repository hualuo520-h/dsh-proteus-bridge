/**
 * COM 传输：出进程 PowerShell 5.1（-STA）子进程，进程内持有唯一的 IApplication。
 * 仅当目标机器的 Proteus 提供 Labcenter COM 自动化服务器时可用（shipping 的
 * Proteus 8.17 没有 —— 那种环境下 Session 会走 UiBroker）。
 * 取消语义：abort/超时 → 杀 broker（可靠取消），会话 dead，下次调用惰性重启。
 */
import { infra } from '../errors.js';
import { LineBroker, type LineCallResult } from './linebroker.js';
export declare class ComBroker extends LineBroker {
    static readonly PROG_ID = "Labcenter.InteractiveSimulation";
    constructor(brokerScriptPath: string);
    /** 单调用便捷封装。 */
    call<T>(call: Parameters<LineBroker['call']>[0], signal: AbortSignal, timeoutMs?: number): Promise<T>;
    /** 批量调用（保住旧签名）。 */
    batchOps(calls: {
        op: string;
        args?: Record<string, unknown>;
    }[], signal: AbortSignal, timeoutMs?: number): Promise<LineCallResult[]>;
}
/**
 * ProgID 预检：shipping Proteus（≤8.17）没有注册 Labcenter.InteractiveSimulation，
 * 先查注册表再 spawn broker，避免拿"COM 类不存在"污染为基础设施错。
 */
export declare function isComAutomationRegistered(): Promise<boolean>;
export { infra };
