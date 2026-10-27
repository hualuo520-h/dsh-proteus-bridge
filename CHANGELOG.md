# Changelog

## 0.4.3

一个安装探测缺陷 + 市场展示元数据。缺陷在 **Proteus 8.17.37159 / Windows 11 / DSH desktop profile** 上实测复现并验证修复。

### Fixed

- **Proteus 装在 C:/D: 以外盘符时，`proteus_connect` 报 `PROTEUS_NOT_INSTALLED`（并把真正的失败掩盖成 PowerShell 参数绑定异常）**
  旧实现 `PDS_CANDIDATES` 只硬编码 `C:\` 与 `D:\` 四个路径。本机 Proteus 装在 `E:\Program Files (x86)\Labcenter Electronics\Proteus 8 Professional\BIN\PDS.EXE`，于是候选全落空 → `findProteusExe()` 返回 `null` → `probeExeVersion('')` 把空字符串甩给 PowerShell，`Get-Item -LiteralPath ''` 抛 `ParameterArgumentValidationErrorEmptyStringNotAllowed`，用户看到的是一句 PowerShell 报错，而不是「没找到 PDS.EXE」。
  改为三段探测：App Paths → 卸载项 `InstallLocation`（Proteus 安装器会写真实安装根）→ `A:`–`Z:` × 常见尾段。命中前先 `stat` 校验路径真实存在（注册表可能指向已卸载的旧路径）。`probeExeVersion` 在空路径时直接抛 `PROTEUS_NOT_INSTALLED`，PowerShell 失败则抛新增的 `PROTEUS_VERSION_PROBE_FAILED`，不再把探测失败伪装成别的错误。
  验证：本机 `proteus_connect` 由 PowerShell 报错变为 `ok:true, transport:"ui", major:8, build:"8.17.37159"`。

### Added

- `screenshots.json` + `assets/`（市场详情页截图），`icon.png` 供目录条目的 `icon:` 字段使用。
- `lib/errors.d.ts` 新增 `PROTEUS_VERSION_PROBE_FAILED` 基础设施码。

## 0.4.2

三个新缺陷，同样在 **Proteus 8.17.37159 / Windows 11 / DSH desktop profile** 上实测复现并验证修复。

### Fixed

- **`proteus_sim_start` / `proteus_sim_status` 报 `value is not lossless JSON`**
  0.4.1 只修了 `suggestLayout` 一处，没意识到 `fail()` 是同一个坑的通用出口：它无条件写 `hint: extra?.hint ?? DOMAIN_HINTS[code]` 与 `details: extra?.details`，遇到没有 hint 映射的 code 就留下**值为 `undefined` 的自有属性**，宿主 `snapshotJsonValue` 直接拒收整个结果 —— 本该给 Agent 看的 `code`/`message` 一起丢掉，只剩一句工具层错误。
  改为条件写入：只有 `hint !== undefined` 才写 `hint`，只有 `extra.details !== undefined` 才写 `details`。
  同类隐患一并处理：`simStatus` 的 `timeSeconds` 只在 COM 真的返回数值时才带该键；UI 保存结果的 `bytes.before/after` 用 `?? null` 兜住「工程从未落盘」的情况（旧代码会在 `before.size` 处抛 TypeError）。
  验证：实机 `simStart` / 重复 `simStart`（`SIM_ALREADY_RUNNING`）/ `simStop` / 重复 `simStop` 全部返回零 undefined 属性。

- **`proteus_sim_start` 点工具栏播放键无反应，`sim_stop` 报 `SIM_STOP_FAILED`**
  UI 传输的仿真生命周期只靠 Animation 工具栏按钮：`simStart` 点 btn0、`simStop` 点 btn1→btn2。实测该工具栏在 `idle` 状态下按钮是**禁用**的，点击毫无反应，于是重试 3 次后返回 `SIM_NOT_CONVERGED`；`simStop` 同理会卡在 `SIM_STOP_FAILED`。
  改为「多原语 + 状态轮询」：新增 `uiTransition(signal, primitives, want)`，每个原语后轮询 `probe` 最多 3×450 ms，到达目标态即返回。
  - `simStart`：`F12`（运行/恢复，实测 idle→running、paused→running 均有效）优先，工具栏 btn0 兜底。
  - `simStop`：`Shift+Pause`（停止）优先，`Design→Stop Animation` 菜单路径次之，工具栏 pause→stop 最后兜底。
  验证：实机 `idle → simStart → running → simStop → idle`，再 `simStop` 幂等返回 `idle`。

- **Proteus 主窗口被最小化后，所有 UI 操作静默失效或抛 `FOREGROUND_FAILED`**
  最小化时 `GetWindowRect` 返回 `-32000` 级哨兵值（实测本机为 `left:-25600, top:-25600`），抢前台拿不到、工具栏矩形算出来在屏幕外，点击落到虚空。
  `Foreground` 增加 `IsIconic → ShowWindow(SW_RESTORE)` 前置，并在 ALT 解锁 + `AttachThreadInput` 之后仍不生效时兜底 `SwitchToThisWindow`；新增 `HasUsableRect` 拒绝 `-30000` 以下的哨兵矩形，`ClickTransportButton` 在取矩形前先断言窗口可用（否则抛 `WINDOW_NOT_RESTORED`，不再静默失败）。
  验证：外部 `ShowWindow(SW_MINIMIZE)` 把窗口压到 `-25600,-25600` 后，`probe` / `simStart` / `simStatus` / `simStop` / `saveSchematic` 全部照常成功。

### Changed

- `lib/errors.js` 补三个缺失的领域码 hint：`COMPONENT_NOT_FOUND`、`DUPLICATE_COMPONENT_REF`、`INVALID_PIN_REF`（此前查表为 `undefined`，正是缺陷 4 的触发源之一）。
- `SIM_STOP_FAILED` 的 hint 更新为描述新的三级回退策略。
- `simStart` 的 `SIM_ALREADY_RUNNING` 判定移到尝试之前：`paused` 不再被当成「已在运行」，`F12` 可正常恢复。

### Added

- `test/selfcheck.mjs` 从 18 项扩到 **29 项**：新增 `fail()` 无损性、`simStart`/`simStop` 原语顺序、`timeSeconds` 条件键、最小化恢复、`HasUsableRect` 五组断言。

## 0.4.1

三个缺陷全部在 **Proteus 8.17.37159 / Windows 11 / DSH desktop profile** 上实测复现并验证修复。

### Fixed

- **`proteus_suggest_layout` 返回非无损 JSON**（`value is not lossless JSON`）
  `lib/layout.js` 里 `partition: group.label || undefined` 在分区标签为空时会留下一个**值为 `undefined` 的自有属性**。宿主的 `snapshotJsonValue` 对任何 `typeof current !== 'object'` 的值直接判失败，于是整个工具输出被拦。表现为「同一组参数时好时坏」——其实是带 `partitionPrefixes` 的用例不产生该属性，不带的一定产生。
  改为条件构造：标签非空才写 `partition` 键。
  验证：8 个用例（含单件 `refs:['R1']`、`columns:3/gridMm:50`、`gridMm:25` 五件套、带未匹配前缀的分区）全部 `badKeys=0` 且 JSON 往返一致。

- **`FOREGROUND_FAILED: target window did not come to foreground`**
  `lib/ui/uibroker.js` 的 `PdsWin.Foreground` 只有 `AttachThreadInput` + `SetForegroundWindow` + `Sleep(350)`。当 Windows 前台锁生效（前台窗口属于别的进程）时，`SetForegroundWindow` **返回 `true` 但 `GetForegroundWindow()` 不变**，随后 `ForegroundAssert` 5 次比对全失败并抛错。
  改为先发一次裸 `ALT`（`keybd_event(0x12,0,0)` / `(0x12,0,2)`，无配套输入目标）解锁，再做原逻辑；已在目标窗口前台时短路不多发键。
  验证：解锁后 `probe` / `sim_start` / `sim_stop` 全部正常。

- **`proteus_save_schematic` 谎报成功，并把后续所有工具带崩**
  Proteus 8.17 的 `Ctrl+S` 会弹「File will be saved in version 8.17 format. This format cannot be loaded by older versions of Proteus…」确认框。旧代码不处理该框：`saveSchematic` 立刻返回 `{ok:true, saved}` 而**文件 mtime 与内容都没变**；同时该模态框占住前台，之后所有注键都 `FOREGROUND_FAILED`。
  新增 PS 原语 `Op_saveWithDialog`（`#32770` + `BM_CLICK` 命中 `确定/OK/是/继续`）与 `UiBroker.saveWithDialog`；保存分支改为「取指纹 → Ctrl+S 并点框 → 轮询等落盘 → 比对指纹」，未落盘返回 `SAVE_NOT_APPLIED`。
  新增成功字段：`dismissedDialog`、`contentChanged`、`bytes.before/after`。
  验证：真实 PDS.EXE 上 5640 → 14578 字节；连续三轮保存 `contentChanged=true`；保存后 `probe` 仍 `idle`（旧版此处必失败）。

### Changed

- `lib/errors.js` 新增领域码 `SAVE_NOT_APPLIED` 及其 hint。
- `saveWithDialog` 的对话框轮询从 12 次收紧到 6 次 × 250 ms：实测无对话框时 6 次足够，拉满 12 次会让每次保存多等 1.5 s。
- 保存判据同时看 `contentChanged`（sha256+size）与 `mtimeMs`：`fingerprintsDiffer` 只比内容，`touched` 兜住「存了但内容恰好相同」被误判为失败的情况。

### Added

- `test/selfcheck.mjs`（18 项，离线跑，不需要 Proteus 与宿主进程）。
- 补全 `lib/**/*.d.ts`：`saveWithDialog`、`saveSchematic` 的新返回字段、`SAVE_NOT_APPLIED`。

## 0.4.0

- 首次发布：11 个工具、COM / UI 双传输、器件白名单、版本回退守卫。
