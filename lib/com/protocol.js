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
export const UNITS_PER_MM = 100_000;
/** 建议布局的默认间距（mm）。Proteus 元件体积差异大，偏保守。 */
export const DEFAULT_GRID_MM = 40;
export const OPS = [
    'ping',
    'detectVersion',
    'openProject',
    'projectInfo',
    'listComponents',
    'placeComponent',
    'componentPins',
    'connectPins',
    'unknownObjectReport',
    'saveProjectAs',
    'schematicEditProbe',
    'simStart',
    'simPause',
    'simResume',
    'simStop',
    'simStatus',
    'readProbes',
    'introspect',
    'quit',
];
/** 各 op 的参数/返回类型约定（broker.ps1 按此实现）。 */
export const OP_CONTRACT = {
    // TODO(verify): $app.Version / build 属性名
    detectVersion: '→ { major: 8|9, build?: string }',
    // TODO(verify): $app.OpenProject(path)
    openProject: '{ path } → { opened: true, sheetCount }',
    // TODO(verify): $project.SchematicSheets 枚举
    projectInfo: '→ { path?, sheets: [{ name, componentCount }] }',
    listComponents: '{ sheet? } → [{ ref, device, library }]',
    // 放置坐标 = 模板原点；rotationDeg ∈ {0,90,180,270}
    // TODO(verify): 放置 API 名（可能在 sheet 或 app 上）
    placeComponent: '{ ref, device, library?, x, y, rotationDeg } → { ref }',
    // TODO(verify): pins(ref) —— 引脚世界坐标与出线方向
    componentPins: '{ ref } → PinInfo[]',
    // 共享引脚自动形成真实结点；返回值为结点报告（可空）
    connectPins: '{ aRef, aPin, bRef, bPin } → { junctions?: number }',
    // 保存守卫①：未知对象报告；非空 → UNKNOWN_OBJECTS_PRESENT
    // TODO(verify): 未知对象枚举 API
    unknownObjectReport: '{ sheet? } → { kinds: string[] }',
    // 原子保存第 4 步：SaveAs 到临时路径；目标替换由宿主侧完成
    // TODO(verify): $project.SaveAs(path)
    saveProjectAs: '{ path } → { saved: true }',
    // Proteus 9 专用能力探测：打开临时最小工程做一次无副作用原理图读
    schematicEditProbe: '→ { supported: boolean, reason?: string }',
    // TODO(verify): 仿真生命周期 API 与状态枚举映射到 SimState
    simStart: '→ { state: SimState }',
    simPause: '→ { state: SimState }',
    simResume: '→ { state: SimState }',
    simStop: '→ { state: SimState }',
    // TODO(verify): 收敛/失败信息来源；error 态必须给 reason
    simStatus: '→ { state: SimState, timeSeconds?: number, reason?: string }',
    // TODO(verify): 探针读取 API（交互仿真探针/电压表/电流表）
    readProbes: '{ names? } → ProbeValue[]',
    // 验证辅助：Get-Member dump 活 COM 对象，交付前锁定成员名用
    introspect: '{ target: "app"|"project"|"sheet" } → { members: string[] }',
    quit: '释放 COM 引用后退出 broker',
};
