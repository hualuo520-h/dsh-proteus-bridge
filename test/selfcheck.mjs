/**
 * 自检：不依赖宿主进程，直接 import 仓库内的 lib。
 * 覆盖 0.4.1 修掉的三处缺陷，回归点是"宿主的无损 JSON 判据"与"保存是否真落盘"。
 *
 *   node test/selfcheck.mjs
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// lib 依赖宿主的两个虚 peer（@deepseek-ai/dsh-llm、@deepseek-ai/dsh-tools）。
// 离线自检时用最小桩顶上：只为让模块能加载，不模拟任何宿主行为。
const SHIMS = {
  'dsh-llm': `export class HarnessError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; this.name = 'HarnessError'; }
}
`,
  'dsh-tools': `export function defineTool(def) { return def; }
`,
};
for (const [pkg, body] of Object.entries(SHIMS)) {
  const dir = join(ROOT, 'node_modules/@deepseek-ai', pkg);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${pkg}`, type: 'module', main: 'index.js' }, null, 2));
  await writeFile(join(dir, 'index.js'), body);
}

const u = (p) => pathToFileURL(join(ROOT, 'lib', p)).href;

const layout = await import(u('layout.js'));
const { UI_BROKER_PS1, UiBroker } = await import(u('ui/uibroker.js'));

let pass = 0;
let total = 0;
const check = (name, cond, extra = '') => {
  total += 1;
  if (cond) pass += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
};

// ── 缺陷 3：suggestLayout 必须产出无损 JSON ──────────────────────────────
// 宿主 snapshotJsonValue 会拒绝：值为 undefined 的自有属性、非有限数、-0、环、非 plain 原型。
// 0.4.0 写 `partition: group.label || undefined`，标签为空时就命中第一条。
const cases = [
  { refs: ['R1', 'R2', 'C1', 'U1'] },
  { refs: ['R1'] },
  { refs: ['R1', 'C1'] },
  { refs: ['R1', 'R2', 'C1', 'U1'], partitionPrefixes: ['R', 'C'] },
  { refs: ['R1'], partitionPrefixes: ['R'] },
  { refs: ['R1'], columns: 3, gridMm: 50 },
  { refs: ['R1', 'R2', 'R3', 'C1', 'C2'], gridMm: 25 },
  { refs: ['R1', 'U1', 'Q1'], partitionPrefixes: ['U', 'Q', 'D'] },
];
for (const c of cases) {
  const r = layout.suggestLayout(c);
  const bad = [];
  const walk = (v, p) => {
    if (v === undefined) { bad.push(p); return; }
    if (v === null || typeof v !== 'object') return;
    for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
  };
  walk(r, '$');
  const rt = JSON.stringify(r) === JSON.stringify(JSON.parse(JSON.stringify(r)));
  check(
    `layout ${JSON.stringify(c)}`,
    bad.length === 0 && rt,
    `n=${r.suggestions.length} badKeys=${bad.length} roundTrip=${rt}`,
  );
}

// ── 缺陷 1：前台锁 ──────────────────────────────────────────────────────
check(
  'PS: Foreground 先发裸 ALT 解锁前台锁',
  /public static void Foreground\(IntPtr hwnd\)[\s\S]{0,400}keybd_event\(0x12, 0, 0/.test(UI_BROKER_PS1),
);
check(
  'PS: 已在前台时短路（不多发键）',
  /public static void Foreground\(IntPtr hwnd\) \{\s*\n\s*if \(GetForegroundWindow\(\) == hwnd\)/.test(UI_BROKER_PS1),
);

// ── 缺陷 2：保存模态框 + 落盘校验 ───────────────────────────────────────
check(
  'PS: DismissDialog 找 #32770 并 BM_CLICK 确定',
  UI_BROKER_PS1.includes('DismissDialog') &&
    UI_BROKER_PS1.includes('#32770') &&
    UI_BROKER_PS1.includes('BM_CLICK'),
);
check(
  'PS: Op_saveWithDialog 轮询等模态框',
  UI_BROKER_PS1.includes('function Op_saveWithDialog') &&
    UI_BROKER_PS1.includes('Start-Sleep -Milliseconds 250'),
);
check('JS: UiBroker.saveWithDialog 方法存在', typeof new UiBroker('x').saveWithDialog === 'function');

const sessionSrc = await readFile(join(ROOT, 'lib/session.js'), 'utf8');
check('JS: 保存分支调用 saveWithDialog', sessionSrc.includes('saveWithDialog'));
check('JS: 保存分支做磁盘指纹校验', sessionSrc.includes('fingerprintsDiffer(before, after)'));
check('JS: 未落盘时返回 SAVE_NOT_APPLIED', sessionSrc.includes("'SAVE_NOT_APPLIED'"));
check(
  'JS: 成功后回传 dismissedDialog 与字节数',
  sessionSrc.includes('dismissedDialog: dialog?.dismissed') &&
    sessionSrc.includes('bytes: { before: before?.size ?? null, after: after?.size ?? null }'),
);

const errorsSrc = await readFile(join(ROOT, 'lib/errors.js'), 'utf8');
check('JS: SAVE_NOT_APPLIED 有 hint', errorsSrc.includes('SAVE_NOT_APPLIED:'));

// ── 0.4.2 缺陷 4：领域失败值也必须是无损 JSON ──────────────────────────
// fail() 旧实现无条件写 hint/details，未知 code 时留下值为 undefined 的自有属性，
// 宿主会在 snapshotJsonValue 处拒收整个工具结果，Agent 连 code/message 都看不到。
const errors = await import(u('errors.js'));
const noUndef = (obj) => Object.entries(obj).filter(([, v]) => v === undefined).map(([k]) => k);
const fKnown = errors.fail('SIM_NOT_CONVERGED', 'x');
const fUnknown = errors.fail('SOME_UNMAPPED_CODE', 'y');
const fDetails = errors.fail('UNSUPPORTED_ON_TRANSPORT', 'z', { details: { transport: 'ui' } });
check('JS: fail() 未知 code 不留下 undefined hint', noUndef(fUnknown).length === 0, JSON.stringify(fUnknown));
check('JS: fail() 已知 code 仍带 hint', fKnown.hint !== undefined && noUndef(fKnown).length === 0);
check('JS: fail() 只在有 details 时写 details', noUndef(fDetails).length === 0 && fDetails.details.transport === 'ui');

// ── 0.4.2 缺陷 5：UI 仿真生命周期不能只靠工具栏按钮 ─────────────────────
// 实测：Animation 工具栏按钮在 idle 时被禁用，点击无效；F12 / Shift+Pause 一直有效。
check(
  'JS: simStart 优先 F12、工具栏仅兜底',
  /async simStart\(signal\)[\s\S]{0,1200}this\.uiBroker\.keyF12\(signal\)[\s\S]{0,400}clickTransportButton\(0/.test(sessionSrc),
);
check(
  'JS: simStop 依次尝试 Shift+Pause、菜单停止、工具栏',
  /async simStop\(signal\)[\s\S]{0,1400}keyShiftPause\(signal\)[\s\S]{0,400}menuStop\(signal\)[\s\S]{0,600}clickTransportButton\(2/.test(sessionSrc),
);
check('JS: uiTransition 轮询目标状态', sessionSrc.includes('async uiTransition(signal, primitives, want)'));
check(
  'JS: simStatus 只在 timeSeconds 是数值时才带该键',
  sessionSrc.includes("typeof result.timeSeconds === 'number'"),
);

// ── 0.4.2 缺陷 6：最小化窗口必须能自恢复 ───────────────────────────────
// 最小化时 GetWindowRect 返回 -32000 级哨兵值，抢前台/取矩形/点击全部失效。
check(
  'PS: Foreground 最小化时 SW_RESTORE',
  /public static void Foreground\(IntPtr hwnd\)[\s\S]{0,500}IsIconic\(hwnd\)[\s\S]{0,200}ShowWindow\(hwnd, SW_RESTORE\)/.test(UI_BROKER_PS1),
);
check(
  'PS: Foreground 兜底 SwitchToThisWindow',
  /public static void Foreground\(IntPtr hwnd\)[\s\S]{0,1400}SwitchToThisWindow\(hwnd, true\)/.test(UI_BROKER_PS1),
);
check(
  'PS: HasUsableRect 拒绝 -32000 哨兵矩形',
  UI_BROKER_PS1.includes('HasUsableRect') && UI_BROKER_PS1.includes('r.Left <= -30000'),
);
check(
  'PS: clickTransportButton 前置检查窗口可用矩形',
  /public static void ClickTransportButton[\s\S]{0,400}HasUsableRect\(main\)/.test(UI_BROKER_PS1),
);

console.log(`\n== ${pass}/${total} checks pass ==`);
process.exit(pass === total ? 0 : 1);
