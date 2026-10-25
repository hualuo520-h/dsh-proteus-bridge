/**
 * COM 传输：出进程 PowerShell 5.1（-STA）子进程，进程内持有唯一的 IApplication。
 * 仅当目标机器的 Proteus 提供 Labcenter COM 自动化服务器时可用（shipping 的
 * Proteus 8.17 没有 —— 那种环境下 Session 会走 UiBroker）。
 * 取消语义：abort/超时 → 杀 broker（可靠取消），会话 dead，下次调用惰性重启。
 */
import { infra } from '../errors.js';
import { LineBroker } from './linebroker.js';
const REQUEST_TIMEOUT_MS = 20_000;
export class ComBroker extends LineBroker {
    static PROG_ID = 'Labcenter.InteractiveSimulation';
    constructor(brokerScriptPath) {
        super('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', brokerScriptPath]);
    }
    /** 单调用便捷封装。 */
    async call(call, signal, timeoutMs = REQUEST_TIMEOUT_MS) {
        return super.call(call, signal, timeoutMs);
    }
    /** 批量调用（保住旧签名）。 */
    batchOps(calls, signal, timeoutMs = REQUEST_TIMEOUT_MS) {
        return this.batch(calls, signal, timeoutMs);
    }
}
/**
 * ProgID 预检：shipping Proteus（≤8.17）没有注册 Labcenter.InteractiveSimulation，
 * 先查注册表再 spawn broker，避免拿"COM 类不存在"污染为基础设施错。
 */
export async function isComAutomationRegistered() {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    for (const hive of ['HKLM\\SOFTWARE\\Classes', 'HKLM\\SOFTWARE\\WOW6432Node\\Classes', 'HKCU\\SOFTWARE\\Classes']) {
        try {
            await run('reg', ['query', `${hive}\\${ComBroker.PROG_ID}`], { timeout: 5_000 });
            return true;
        }
        catch {
            /* 该视图不存在，继续 */
        }
    }
    return false;
}
export { infra };
