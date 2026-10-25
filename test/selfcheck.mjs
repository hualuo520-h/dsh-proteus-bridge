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
    sessionSrc.includes('bytes: { before: before.size, after: after.size }'),
);

const errorsSrc = await readFile(join(ROOT, 'lib/errors.js'), 'utf8');
check('JS: SAVE_NOT_APPLIED 有 hint', errorsSrc.includes('SAVE_NOT_APPLIED:'));

console.log(`\n== ${pass}/${total} checks pass ==`);
process.exit(pass === total ? 0 : 1);
