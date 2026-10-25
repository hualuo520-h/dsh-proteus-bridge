import type { PinInfo, ProbeValue, SimState } from './com/protocol.js';
import { type DomainResult } from './errors.js';
import { type PlaceableComponent } from './whitelist.js';
export type TransportKind = 'com' | 'ui';
export interface ConnectArgs {
    projectPath?: string;
    /** UI 传输下 PDS.EXE 的显式路径（默认自动探测）。 */
    pdsPath?: string;
}
export interface ConnectInfo {
    transport: TransportKind;
    major: 8 | 9;
    build?: string;
    schematicEditSupported: boolean;
    projectPath?: string;
    sheets?: {
        name: string;
        componentCount: number;
    }[];
    windowTitle?: string;
}
export declare class ProteusSession {
    private comBroker;
    private uiBroker;
    private adapter;
    private whitelist;
    private transport;
    private pinCache;
    private sheetGeneration;
    private saveState;
    private currentProjectPath;
    private major;
    private windowTitle;
    get connected(): boolean;
    get schematicEditSupported(): boolean;
    dispose(): Promise<void>;
    guard(): DomainResult<never> | null;
    connect(args: ConnectArgs, signal: AbortSignal): Promise<DomainResult<ConnectInfo>>;
    private connectViaCom;
    private connectViaUi;
    listPlaceable(): Promise<PlaceableComponent[]>;
    /** UI 传输不具备原理图脚本能力的一组操作，统一如实拒绝。 */
    private unsupported;
    placeComponent(args: {
        ref: string;
        device: string;
        library?: string;
        x: number;
        y: number;
        rotationDeg?: number;
    }, signal: AbortSignal): Promise<DomainResult<{
        ref: string;
        note: string;
    }>>;
    queryPins(refs: string[], signal: AbortSignal): Promise<DomainResult<{
        pins: Record<string, PinInfo[]>;
        generation: number;
    }>>;
    parsePinRef(ref: string): {
        component: string;
        pin: string;
    } | null;
    connectPins(args: {
        a: string;
        b: string;
    }, signal: AbortSignal): Promise<DomainResult<{
        a: string;
        b: string;
        note: string;
    }>>;
    saveSchematic(args: {
        overwrite?: boolean;
        confirmRollback?: boolean;
    }, signal: AbortSignal): Promise<DomainResult<{
        saved: string;
        /** UI 传输：被点掉的模态框按钮文本（无对话框则 null）。 */
        dismissedDialog?: string | null;
        /** UI 传输：磁盘内容是否真的变了（sha256+size）。 */
        contentChanged?: boolean;
        /** UI 传输：保存前后的字节数（工程此前未落盘时对应字段为 null）。 */
        bytes?: {
            before: number | null;
            after: number | null;
        };
    }>>;
    /** UI 传输：按顺序尝试多个原语，每个原语后轮询 probe 直到到达目标态。 */
    private uiTransition;

    simStart(signal: AbortSignal): Promise<DomainResult<{
        state: SimState;
    }>>;
    simStop(signal: AbortSignal): Promise<DomainResult<{
        state: SimState;
    }>>;
    simStatus(signal: AbortSignal): Promise<DomainResult<{
        state: SimState;
        timeSeconds?: number;
    }>>;
    readSignals(args: {
        probes?: string[];
        sampleMs?: number;
        samples?: number;
    }, signal: AbortSignal): Promise<DomainResult<{
        samples: ProbeValue[][];
    }>>;
    private simState;
}
