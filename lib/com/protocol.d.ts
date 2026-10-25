/**
 * COM 调用面 —— 全插件唯一出现"Proteus 类型库成员名期望形态"的文件。
 *
 * 所有标注 TODO(verify) 的成员名是按 8.16 COM 自动化约定写的后绑定期望，
 * 交付前必须用 broker 的 `introspect` op（Get-Member dump 活对象）一次性锁定。
 * 改名只改本文件与 broker.ps1，不许散落到工具层。
 *
 * 给定事实（用户契约，非 TODO）：
 *  - ProgID "Labcenter.InteractiveSimulation" → IApplication；Dispatch 启动/连接 Proteus.exe，
 *    每次调用都有跨进程开销 —— 因此 IApplication 全程只建一次。
 *  - 对象链 IApplication → IProject(.pdsprj) → ISchematicSheet → .Components。
 *  - 坐标：原生整数，100000 = 1 mm，Y 轴向上；放置坐标 = 模板原点，不保证是元件中心。
 *  - 引脚：pins(ref) 返回引脚实际世界坐标与出线方向；不得从放置坐标推算。
 *  - 连线：connect('R1.2','C1.2')；共享引脚自动形成真实结点；禁止坐标画线。
 */
/** 原生坐标单位：100000 = 1 mm，Y 轴向上。 */
export declare const UNITS_PER_MM = 100000;
/** 建议布局的默认间距（mm）。Proteus 元件体积差异大，偏保守。 */
export declare const DEFAULT_GRID_MM = 40;
export type SimState = 'idle' | 'running' | 'paused' | 'halted' | 'error';
export interface PinInfo {
    /** 引脚号（connect 引用中的 '.N' 部分，字符串以兼容非数字编号）。 */
    index: string;
    name?: string;
    /** 引脚世界坐标（原生单位，Y 向上）。 */
    x: number;
    y: number;
    /** 出线方向（度，0=右；TODO(verify) 具体约定）。 */
    directionDeg: number;
}
export interface ProbeValue {
    name: string;
    value: string;
    unit?: string;
}
/** 单个 COM 操作请求。op 必须是 OPS 之一。 */
export interface ComCall {
    op: string;
    args?: Record<string, unknown>;
}
/** broker 单调用结果：ok:false 时 error 是 broker 侧捕获的字符串。 */
export type ComCallResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: string;
};
export declare const OPS: readonly ["ping", "detectVersion", "openProject", "projectInfo", "listComponents", "placeComponent", "componentPins", "connectPins", "unknownObjectReport", "saveProjectAs", "schematicEditProbe", "simStart", "simPause", "simResume", "simStop", "simStatus", "readProbes", "introspect", "quit"];
export type OpName = (typeof OPS)[number];
/** 请求信封：一次往返可携带多个调用，摊薄跨进程开销。 */
export interface BrokerRequest {
    id: number;
    calls: ComCall[];
}
export interface BrokerResponse {
    id: number;
    results: ComCallResult[];
}
/** 各 op 的参数/返回类型约定（broker.ps1 按此实现）。 */
export declare const OP_CONTRACT: {
    detectVersion: string;
    openProject: string;
    projectInfo: string;
    listComponents: string;
    placeComponent: string;
    componentPins: string;
    connectPins: string;
    unknownObjectReport: string;
    saveProjectAs: string;
    schematicEditProbe: string;
    simStart: string;
    simPause: string;
    simResume: string;
    simStop: string;
    simStatus: string;
    readProbes: string;
    introspect: string;
    quit: string;
};
