# Changelog

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
