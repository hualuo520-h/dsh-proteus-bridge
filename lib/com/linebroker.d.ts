export interface LineCall {
    op: string;
    args?: Record<string, unknown>;
}
export type LineCallResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: string;
};
export interface LineRequest {
    id: number;
    calls?: LineCall[];
    exit?: boolean;
}
export interface LineResponse {
    id: number;
    results: LineCallResult[];
}
export declare abstract class LineBroker {
    private readonly command;
    private readonly args;
    private proc;
    private pending;
    private nextId;
    private buffer;
    private crashed;
    protected constructor(command: string, args: string[]);
    protected get alive(): boolean;
    /** 启动子进程并跑一次 ping 确认存活（幂等；dead 后自动重建）。 */
    ensureAlive(signal: AbortSignal): Promise<void>;
    /** 单调用便捷封装；broker 层 ok:false 转成 COM_CALL_FAILED 异常。 */
    call<T>(call: LineCall, signal: AbortSignal, timeoutMs?: number): Promise<T>;
    /** 批量调用：单次跨进程往返执行多个 op。 */
    batch(calls: LineCall[], signal: AbortSignal, timeoutMs?: number): Promise<LineCallResult[]>;
    dispose(): Promise<void>;
    private spawnProc;
    private onStdout;
    private rejectPending;
    private killProc;
}
