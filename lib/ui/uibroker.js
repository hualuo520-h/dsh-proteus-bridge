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
 *   - 前台投递必须 AttachThreadInput 绕前台锁；keybd_event 全 VK 级。
 *   - 绝不向工具栏发 TB_* 消息（越界索引会把 32 位 comctl32 写崩，实测事故）。
 *   - 同步 SendMessage 会死锁（实测），一律 PostMessage / 只读 API。
 */
import { LineBroker } from '../com/linebroker.js';
export class UiBroker extends LineBroker {
    constructor(brokerScriptPath) {
        super('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', brokerScriptPath]);
    }
    /** 附着到已运行的 PDS 主窗口（按标题子串匹配）。 */
    async attach(titlePattern, signal) {
        await this.ensureAlive(signal);
        return this.call({ op: 'attach', args: { pattern: titlePattern } }, signal);
    }
    probe(signal) {
        return this.call({ op: 'probe' }, signal, 30_000);
    }
    keyF12(signal) {
        return this.call({ op: 'keyF12' }, signal);
    }
    keyPause(signal) {
        return this.call({ op: 'keyPause' }, signal);
    }
    keyShiftPause(signal) {
        return this.call({ op: 'keyShiftPause' }, signal);
    }
    /**
     * 菜单导航停止：F10 → Right×6(调试) → Down(打开) → Down×2(停止仿真) → Enter。
     * 不含 Shift（实测 Shift 和弦被中文 IME 的中英切换热键拦截）与字母键。
     * 菜单布局按 8.17 SP2 实测（调试为第 7 项，停止仿真为其第 3 项）；其它 build 需复核。
     */
    menuStop(signal) {
        return this.call({ op: 'menuStop' }, signal, 30_000);
    }
    keyCtrlS(signal) {
        return this.call({ op: 'keyCtrlS' }, signal);
    }
    /** 原子点击 Animation 工具栏第 index 颗按钮（0 起）。 */
    clickTransportButton(index, signal) {
        return this.call({ op: 'clickTransportButton', args: { index } }, signal);
    }
    batchOps(calls, signal) {
        return this.batch(calls, signal, 30_000);
    }
}
/**
 * UI 传输的 PowerShell 端（原子原语）。构建时随 lib 拷贝到同目录。
 */
export const UI_BROKER_PS1 = String.raw `
$ErrorActionPreference = 'Stop'

$script:hwnd = [IntPtr]::Zero

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class PdsWin {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder b, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder b, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr h, uint id, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  public const uint WM_CANCELMODE = 0x001F;
  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;

  // 找 Animation 工具栏（ReBarWindow32 下的 ToolbarWindow32，标题带 Animation 的带子）。
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  static IntPtr animToolbar = IntPtr.Zero;
  static bool ToolbarCb(IntPtr h, IntPtr lp) {
    var c = new StringBuilder(64); GetClassNameW(h, c, 64);
    if (c.ToString() == "ToolbarWindow32") {
      IntPtr parent = GetParent(h);
      if (parent != IntPtr.Zero) {
        var pt = new StringBuilder(64); GetWindowTextW(parent, pt, 64);
        if (pt.ToString() == "Animation") { animToolbar = h; return false; }
      }
    }
    return true;
  }
  public static IntPtr FindAnimationToolbar(IntPtr main) {
    animToolbar = IntPtr.Zero;
    EnumChildWindows(main, ToolbarCb, IntPtr.Zero);
    return animToolbar;
  }
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr addr, uint size, uint type, uint protect);
  [DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr h, IntPtr addr, uint size, uint type);
  [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, uint size, out uint read);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public const uint TB_BUTTONCOUNT = 0x418, TB_GETITEMRECT = 0x41D;
  // 目标是 32 位进程：RECT 16 字节直接可读。
  public static List<object> ButtonRects(IntPtr tb, uint pid) {
    var list = new List<object>();
    int count = (int)SendMessageW(tb, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
    IntPtr proc = OpenProcess(0x38, false, pid);
    if (proc == IntPtr.Zero) throw new Exception("OpenProcess failed");
    IntPtr remote = VirtualAllocEx(proc, IntPtr.Zero, 64, 0x3000, 4);
    for (int i = 0; i < count; i++) {
      SendMessageW(tb, TB_GETITEMRECT, (IntPtr)i, remote);
      byte[] buf = new byte[16]; uint read;
      ReadProcessMemory(proc, remote, buf, 16, out read);
      int l = BitConverter.ToInt32(buf, 0), t = BitConverter.ToInt32(buf, 4);
      int r = BitConverter.ToInt32(buf, 8), btm = BitConverter.ToInt32(buf, 12);
      var p = new POINT { X = l, Y = t };
      ClientToScreen(tb, ref p);
      list.Add(new { index = i, x = p.X, y = p.Y, w = r - l, h = btm - t });
    }
    VirtualFreeEx(proc, remote, 0, 0x8000);
    CloseHandle(proc);
    return list;
  }
  public static void ClickAt(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(80);
    mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(150);
  }
  // 原子操作：取按钮矩形并立即点击（同一往返，杜绝 ReBar 换行导致的坐标失效）。
  public static void ClickTransportButton(IntPtr main, uint pid, int index) {
    IntPtr tb = FindAnimationToolbar(main);
    if (tb == IntPtr.Zero) throw new Exception("ANIMATION_TOOLBAR_NOT_FOUND");
    IntPtr proc = OpenProcess(0x38, false, pid);
    if (proc == IntPtr.Zero) throw new Exception("OpenProcess failed");
    IntPtr remote = VirtualAllocEx(proc, IntPtr.Zero, 64, 0x3000, 4);
    SendMessageW(tb, TB_GETITEMRECT, (IntPtr)index, remote);
    byte[] buf = new byte[16]; uint read;
    ReadProcessMemory(proc, remote, buf, 16, out read);
    int l = BitConverter.ToInt32(buf, 0), t = BitConverter.ToInt32(buf, 4);
    int r = BitConverter.ToInt32(buf, 8), btm = BitConverter.ToInt32(buf, 12);
    VirtualFreeEx(proc, remote, 0, 0x8000);
    CloseHandle(proc);
    if (r - l <= 0 || btm - t <= 0) throw new Exception("BUTTON_EMPTY (hidden?)");
    var p = new POINT { X = l, Y = t };
    ClientToScreen(tb, ref p);
    ForegroundAssert(main);
    ClickAt(p.X + (r - l) / 2, p.Y + (btm - t) / 2);
  }

  public static IntPtr FindByTitle(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr lp) {
      var t = new StringBuilder(256);
      GetWindowTextW(h, t, 256);
      if (t.ToString().Contains(needle)) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid != 0) { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static void Foreground(IntPtr hwnd) {
    IntPtr fg = GetForegroundWindow(); uint a = 0, b = 0;
    uint ta = GetWindowThreadProcessId(fg, out a);
    uint tb = GetWindowThreadProcessId(hwnd, out b);
    AttachThreadInput(ta, tb, true);
    SetForegroundWindow(hwnd);
    AttachThreadInput(ta, tb, false);
    System.Threading.Thread.Sleep(350);
  }
  // 注键前的硬性前置：确认目标窗口真的在前台，否则重试；失败必须抛错。
  // 不做断言的话按键会落进用户其它窗口（实测：打进输入法变成拼音候选垃圾）。
  public static void ForegroundAssert(IntPtr hwnd) {
    for (int i = 0; i < 5; i++) {
      Foreground(hwnd);
      if (GetForegroundWindow() == hwnd) return;
      System.Threading.Thread.Sleep(250);
    }
    throw new Exception("FOREGROUND_FAILED: target window did not come to foreground");
  }
  public static void Tap(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60);
    keybd_event(vk, 0, 2, UIntPtr.Zero); System.Threading.Thread.Sleep(220);
  }
  public static void Chord(byte mod, byte key) {
    keybd_event(mod, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(70);
    keybd_event(key, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(70);
    keybd_event(key, 0, 2, UIntPtr.Zero); System.Threading.Thread.Sleep(70);
    keybd_event(mod, 0, 2, UIntPtr.Zero);
  }
  // 每次注键前先发一个 ESC：取消输入法组合（实测残留组合会吞掉后续所有按键）
  // 和残留菜单。ESC 落在画布上只是取消选择，无副作用。
  public static void CancelComposition(IntPtr hwnd) {
    ForegroundAssert(hwnd);
    keybd_event(0x1B, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60);
    keybd_event(0x1B, 0, 2, UIntPtr.Zero); System.Threading.Thread.Sleep(250);
  }
  // 实测状态矩阵：582 禁用=idle；581 禁用=paused；否则 running。三种真实状态下
  // 576/581/582 至少有一个被灰化（idle: 581+582、paused: 581、running: 576），
  // 全部 0x100 只出现在菜单未刷新的旧存储上 —— 以此为菜单是否真正打开的判据并重试。
  // 菜单打开用 F10 + Right×6 + Down（菜单栏第 7 项 = 调试）：全程无字母键，
  // 输入法无法拦截（Alt+D 的 D 实测会被 IME 组合吞掉）。菜单开合用 WM_CANCELMODE
  // 收尾，零按键到达画布，对运行中的仿真完全非破坏（连续探测读数一致）。
  public static string Probe(IntPtr hwnd) {
    ForegroundAssert(hwnd);
    PostMessageW(hwnd, WM_CANCELMODE, IntPtr.Zero, IntPtr.Zero);
    System.Threading.Thread.Sleep(300);
    for (int attempt = 0; attempt < 3; attempt++) {
      Tap(0x79);                                 // F10 -> 菜单栏模式（无字母键，IME 不可拦截；ESC 会误停运行中的仿真，禁用）
      for (int i = 0; i < 6; i++) Tap(0x27);     // Right×6 -> 调试
      Tap(0x28);                                 // Down -> 打开调试菜单
      System.Threading.Thread.Sleep(700);
      IntPtr menu = GetMenu(hwnd);
      uint s576 = GetMenuState(menu, 576, 0);
      uint s581 = GetMenuState(menu, 581, 0);
      uint s582 = GetMenuState(menu, 582, 0);
      PostMessageW(hwnd, WM_CANCELMODE, IntPtr.Zero, IntPtr.Zero);
      System.Threading.Thread.Sleep(400);
      bool fresh = !((s576 == 0x100) && (s581 == 0x100) && (s582 == 0x100));
      if (!fresh) continue;
      if ((s582 & 0x3) != 0) return "idle";
      if ((s581 & 0x3) != 0) return "paused";
      return "running";
    }
    throw new Exception("MENU_NOT_FRESH: menu states never refreshed after 3 attempts");
  }
}
"@

function Ensure-Attached {
  if ($script:hwnd -eq [IntPtr]::Zero -or -not [PdsWin]::IsWindow($script:hwnd)) {
    throw 'NOT_ATTACHED'
  }
}

function Op_ping($a) { @{ pong = $true } }

function Op_attach($a) {
  $h = [PdsWin]::FindByTitle([string]$a.pattern)
  if ($h -eq [IntPtr]::Zero) { throw "window not found: $($a.pattern)" }
  $script:hwnd = $h
  $p = 0
  [void][PdsWin]::GetWindowThreadProcessId($h, [ref]$p)
  $t = New-Object System.Text.StringBuilder 256
  [void][PdsWin]::GetWindowTextW($h, $t, 256)
  @{ hwnd = $h.ToInt64(); pid = $p; title = $t.ToString() }
}

function Op_probe($a) {
  Ensure-Attached
  @{ state = [PdsWin]::Probe($script:hwnd) }
}

function Op_keyF12($a) {
  Ensure-Attached
  [PdsWin]::ForegroundAssert($script:hwnd)
  [PdsWin]::Tap(0x7B)
  @{ ok = $true }
}

function Op_keyPause($a) {
  Ensure-Attached
  [PdsWin]::ForegroundAssert($script:hwnd)
  [PdsWin]::Tap(0x13)
  @{ ok = $true }
}

function Op_keyShiftPause($a) {
  Ensure-Attached
  [PdsWin]::ForegroundAssert($script:hwnd)
  [PdsWin]::Chord(0x10, 0x13)
  @{ ok = $true }
}

function Op_menuStop($a) {
  Ensure-Attached
  [PdsWin]::ForegroundAssert($script:hwnd)
  [PdsWin]::Tap(0x79)                          # F10 -> 菜单栏
  for ($i = 0; $i -lt 6; $i++) { [PdsWin]::Tap(0x27) }   # Right×6 -> 调试
  [PdsWin]::Tap(0x28)                          # Down -> 打开菜单，选中开始仿真
  [PdsWin]::Tap(0x28)                          # Down -> 暂停仿真
  [PdsWin]::Tap(0x28)                          # Down -> 停止仿真
  [PdsWin]::Tap(0x0D)                          # Enter
  @{ ok = $true }
}

function Op_buttonRects($a) {
  Ensure-Attached
  $p = 0
  [void][PdsWin]::GetWindowThreadProcessId($script:hwnd, [ref]$p)
  $tb = [PdsWin]::FindAnimationToolbar($script:hwnd)
  if ($tb -eq [IntPtr]::Zero) { throw 'ANIMATION_TOOLBAR_NOT_FOUND' }
  @{ buttons = [PdsWin]::ButtonRects($tb, [uint32]$p) }
}

function Op_clickAt($a) {
  Ensure-Attached
  [PdsWin]::ForegroundAssert($script:hwnd)
  [PdsWin]::ClickAt([int]$a.x, [int]$a.y)
  @{ ok = $true }
}

function Op_clickTransportButton($a) {
  Ensure-Attached
  $p = 0
  [void][PdsWin]::GetWindowThreadProcessId($script:hwnd, [ref]$p)
  [PdsWin]::ClickTransportButton($script:hwnd, [uint32]$p, [int]$a.index)
  @{ ok = $true }
}

function Op_keyCtrlS($a) {
  Ensure-Attached
  [PdsWin]::ForegroundAssert($script:hwnd)
  [PdsWin]::Chord(0x11, 0x53)
  @{ ok = $true }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $req = $line | ConvertFrom-Json
  if ($req.exit) { break }
  $results = @()
  foreach ($call in $req.calls) {
    try {
      $fn = Get-Item "function:Op_$($call.op)" -ErrorAction Stop
      $results += @{ ok = $true; value = & $fn.ScriptBlock $call.args }
    } catch {
      $results += @{ ok = $false; error = $_.Exception.Message }
    }
  }
  [Console]::Out.WriteLine((@{ id = $req.id; results = $results } | ConvertTo-Json -Depth 12 -Compress))
}
`;
/** 把 UI broker 脚本写到临时目录，返回路径（每次会话一份）。 */
export async function writeUiBrokerScript() {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'dsh-proteus-ui-'));
    const script = join(dir, 'dsh-proteus-ui-broker.ps1');
    // BOM 必须带：PowerShell 5.1 对无 BOM 文件按 ANSI 读，UTF-8 中文注释会乱码并破坏 Add-Type。
    await writeFile(script, '\ufeff' + UI_BROKER_PS1, 'utf8');
    return script;
}
