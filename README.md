# dsh-proteus-bridge

DeepSeek Harness（Cordis）工具插件：让 Agent 通过 COM 控制 Proteus 8/9 交互仿真并编辑原理图。

- 完整实现方案：[DESIGN.md](./DESIGN.md)
- 骨架代码：`src/`（类型已通过 strict 检查；COM 成员名集中标注 `TODO(verify)`，
  交付前用 broker 的 `introspect` op 对照真实类型库锁定）
- 器件白名单：`whitelist/placeable.v1.json`（空起步，验证工作流见 DESIGN.md §5）

## 工具一览

`proteus_connect` · `proteus_sim_start` · `proteus_sim_stop` · `proteus_sim_status` ·
`proteus_read_signals` · `proteus_list_placeable_components` · `proteus_place_component` ·
`proteus_query_pins` · `proteus_connect_pins` · `proteus_save_schematic` · `proteus_suggest_layout`

## 构建

```bash
pnpm install && pnpm build   # peers 由 DSH 运行时提供（虚 peer），见 DESIGN.md §11
```
