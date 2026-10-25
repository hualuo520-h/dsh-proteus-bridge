/**
 * UI 传输：持久 PowerShell 5.1 子进程做全部 Win32 工作（外部键盘驱动 PDS.EXE）。
 * PS 端只提供**原子键盘原语**（attach/probe/单键），组合逻辑（先探测再按键）在 session 层。
 *
 * 原语全部在 Proteus 8.17 SP2 实测验证（2026-10-25，两实例）：
 *   - F12            = 运行/恢复（idle→running 实测；paused→running 实测）
 *   - Pause          = 暂停（running→paused 实测）；paused 态再按 = 停止（两次实测一致）
 *   - Shift+Pause    = 停止仿真（paused→idle 实测）
 *   - Ctrl+F12       = 开始仿真（进入交互模式，初始态 paused@0，两次实测一致）
 *   - Ctrl+S         = 保存工程（会中断交互仿真）
 *   - 状态读取 = Alt+D 打开调试菜单刷新启用矩阵后 GetMenuState：
 *       582(停止) 禁用 → idle；581(暂停) 禁用 → paused；否则 running
 *     实测值：paused: 581=0x103；idle: 581/582 双 0x103；running: 576=0x103。
 *   - 前台投递必须先用一次裸 ALT 解掉 Windows 前台锁，再 AttachThreadInput；keybd_event 全 VK 级。
 *     （只做 AttachThreadInput+SetForegroundWindow 时 SetForegroundWindow 返回 true 但前台不变，
 *      实测会持续 FOREGROUND_FAILED。）
 *   - Ctrl+S 在 8.17 会弹「File will be saved in version 8.17 format…」确认框：必须点掉，
 *     否则它占住前台且文件不落盘。见 saveWithDialog。
 *   - 绝不向工具栏发 TB_* 消息（越界索引会把 32 位 comctl32 写崩，实测事故）。
 *   - 同步 SendMessage 会死锁（实测），一律 PostMessage / 只读 API。
 */
import { LineBroker, type LineCallResult } from '../com/linebroker.js';
export interface UiSessionInfo {
    hwnd: number;
    pid: number;
    title: string;
}
export declare class UiBroker extends LineBroker {
    constructor(brokerScriptPath: string);
    /** 附着到已运行的 PDS 主窗口（按标题子串匹配）。 */
    attach(titlePattern: string, signal: AbortSignal): Promise<UiSessionInfo>;
    probe(signal: AbortSignal): Promise<{
        state: 'idle' | 'running' | 'paused';
    }>;
    keyF12(signal: AbortSignal): Promise<unknown>;
    keyPause(signal: AbortSignal): Promise<unknown>;
    keyShiftPause(signal: AbortSignal): Promise<unknown>;
    /**
     * 菜单导航停止：F10 → Right×6(调试) → Down(打开) → Down×2(停止仿真) → Enter。
     * 不含 Shift（实测 Shift 和弦被中文 IME 的中英切换热键拦截）与字母键。
     * 菜单布局按 8.17 SP2 实测（调试为第 7 项，停止仿真为其第 3 项）；其它 build 需复核。
     */
    menuStop(signal: AbortSignal): Promise<unknown>;
    keyCtrlS(signal: AbortSignal): Promise<unknown>;
    /**
     * Ctrl+S + 点掉「File will be saved in version X format…」确认框。
     * 返回被点按钮的文本（无对话框则 null）与轮询耗时。
     * 不点掉该框时它占住前台：后续注键全部 FOREGROUND_FAILED，且文件根本不落盘。
     */
    saveWithDialog(signal: AbortSignal): Promise<{
        dismissed: string | null;
        waited: number;
    }>;
    /** 原子点击 Animation 工具栏第 index 颗按钮（0 起）。 */
    clickTransportButton(index: number, signal: AbortSignal): Promise<unknown>;
    batchOps(calls: {
        op: string;
        args?: Record<string, unknown>;
    }[], signal: AbortSignal): Promise<LineCallResult[]>;
}
/**
 * UI 传输的 PowerShell 端（原子原语）。构建时随 lib 拷贝到同目录。
 */
export declare const UI_BROKER_PS1: string;
/** 把 UI broker 脚本写到临时目录，返回路径（每次会话一份）。 */
export declare function writeUiBrokerScript(): Promise<string>;
