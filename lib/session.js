/**
 * ProteusSession —— 插件内唯一有状态对象，双传输协商。
 *
 * 传输选择（connect 时一次性决定并在结果里如实上报，不做逐 op 静默降级）：
 *  - 'com'：注册表存在 Labcenter.InteractiveSimulation（Labcenter COM SDK 环境）→ 全能力。
 *  - 'ui' ：COM 不存在但本机装有 Proteus → 外部键盘驱动 PDS.EXE。
 *           能力 = 仿真生命周期 + 保存；元件放置/引脚/连线如实返回
 *           UNSUPPORTED_ON_TRANSPORT（shipping Proteus 无原理图脚本接口）。
 */
import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { ComBroker, isComAutomationRegistered } from './com/broker.js';
import { asDomainResult, fail, infra, ok } from './errors.js';
import { assertProjectWritableBy, atomicReplace, fileFingerprint, fingerprintsDiffer, probeProjectFormatSync, } from './guards.js';
import { createAdapter } from './version.js';
import { WhitelistStore } from './whitelist.js';
import { UiBroker, writeUiBrokerScript } from './ui/uibroker.js';
const run = promisify(execFile);
const PDS_CANDIDATES = [
    'C:\\Program Files (x86)\\Labcenter Electronics\\Proteus 8 Professional\\BIN\\PDS.EXE',
    'C:\\Program Files\\Labcenter Electronics\\Proteus 8 Professional\\BIN\\PDS.EXE',
    'D:\\Program Files (x86)\\Labcenter Electronics\\Proteus 8 Professional\\BIN\\PDS.EXE',
    'D:\\Program Files\\Labcenter Electronics\\Proteus 8 Professional\\BIN\\PDS.EXE',
];
/** 探测本机 PDS.EXE：App Paths 注册表优先，随后已知安装路径。 */
async function findProteusExe() {
    try {
        const { stdout } = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\pds.exe', '/ve'], { timeout: 5_000 });
        const m = /\s+REG_SZ\s+(\S.*\.exe)/i.exec(stdout);
        if (m?.[1])
            return m[1];
    }
    catch {
        /* 无 App Paths 条目 */
    }
    for (const p of PDS_CANDIDATES) {
        try {
            await stat(p);
            return p;
        }
        catch {
            /* 下一个候选 */
        }
    }
    return null;
}
async function probeExeVersion(exePath) {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Item -LiteralPath '${exePath.replace(/'/g, "''")}').VersionInfo | ForEach-Object { "$($_.FileVersion)" }`], { timeout: 15_000 });
    const v = stdout.trim();
    const major = (Number.parseInt(v, 10) >= 9 ? 9 : 8);
    return { major, build: v };
}
/** UI 传输的版本适配：原理图编辑不支持（如实），守卫与白名单照常。 */
class UiAdapter {
    detection;
    placeables;
    constructor(detection, placeables) {
        this.detection = detection;
        this.placeables = placeables;
    }
    async detect() {
        return { major: this.detection.major, build: this.detection.build };
    }
    supportsSchematicEditing() {
        return false;
    }
    assertProjectWritableBy(version, filePath) {
        assertProjectWritableBy(version, filePath);
    }
    async getPlaceableComponents() {
        return this.placeables();
    }
}
export class ProteusSession {
    comBroker = null;
    uiBroker = null;
    adapter = null;
    whitelist = new WhitelistStore();
    transport = null;
    pinCache = new Map();
    sheetGeneration = 0;
    saveState = null;
    currentProjectPath = null;
    major = 8;
    windowTitle = null;
    get connected() {
        return this.transport !== null;
    }
    get schematicEditSupported() {
        return this.adapter?.supportsSchematicEditing() ?? false;
    }
    async dispose() {
        await Promise.all([
            this.comBroker?.dispose(),
            this.uiBroker?.dispose(),
        ]);
        this.comBroker = null;
        this.uiBroker = null;
        this.adapter = null;
        this.transport = null;
        this.pinCache.clear();
        this.saveState = null;
    }
    guard() {
        if (!this.connected)
            return fail('NOT_CONNECTED', '尚未建立 Proteus 会话');
        return null;
    }
    async connect(args, signal) {
        // 先 COM 后 UI：只有注册表证明 COM 自动化存在才走 COM；否则 UI。
        if (await isComAutomationRegistered()) {
            const com = await this.connectViaCom(args, signal);
            if (com)
                return com;
            // COM 已注册但连接失败 = 真故障，如实抛出（不静默降级）。
        }
        return this.connectViaUi(args, signal);
    }
    async connectViaCom(args, signal) {
        const { mkdtempSync, writeFileSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { COM_BROKER_PS1 } = await import('./com/script.js');
        const dir = mkdtempSync(join(tmpdir(), 'dsh-proteus-'));
        const scriptPath = join(dir, 'dsh-proteus-broker.ps1');
        // BOM 必须带：PowerShell 5.1 对无 BOM 文件按 ANSI 读，UTF-8 中文注释会乱码并破坏 Add-Type。
        writeFileSync(scriptPath, '\ufeff' + COM_BROKER_PS1, 'utf8');
        this.comBroker = new ComBroker(scriptPath);
        await this.comBroker.ensureAlive(signal);
        const detection = await this.comBroker.call({ op: 'detectVersion' }, signal);
        this.adapter = createAdapter(detection, this.comBroker, () => this.whitelist.list());
        this.transport = 'com';
        this.major = detection.major;
        const info = {
            transport: 'com',
            major: detection.major,
            build: detection.build,
            schematicEditSupported: this.adapter.supportsSchematicEditing(),
        };
        if (args.projectPath) {
            try {
                this.adapter.assertProjectWritableBy(detection.major, args.projectPath);
            }
            catch (error) {
                const domain = asDomainResult(error);
                if (domain)
                    return domain;
                throw error;
            }
            await this.comBroker.call({ op: 'openProject', args: { path: args.projectPath } }, signal);
            const details = await this.comBroker.call({ op: 'projectInfo' }, signal);
            info.projectPath = args.projectPath;
            info.sheets = details.sheets;
            this.currentProjectPath = args.projectPath;
            this.saveState = await fileFingerprint(args.projectPath);
        }
        return { ok: true, ...info };
    }
    async connectViaUi(args, signal) {
        const scriptPath = await writeUiBrokerScript();
        this.uiBroker = new UiBroker(scriptPath);
        await this.uiBroker.ensureAlive(signal);
        const TITLE = 'Proteus 8 Professional';
        let attached = null;
        try {
            attached = await this.uiBroker.attach(TITLE, signal);
        }
        catch {
            attached = null;
        }
        if (!attached) {
            const exePath = args.pdsPath ?? (await findProteusExe());
            if (!exePath) {
                infra('PROTEUS_NOT_INSTALLED', '未找到 PDS.EXE（注册表 App Paths 与常见安装路径均无）');
            }
            if (!args.projectPath) {
                return fail('PROJECT_NOT_OPEN', 'Proteus 未运行；请传入 projectPath（UI 传输将用它启动 PDS）');
            }
            const child = spawn(exePath, [args.projectPath], { detached: true, stdio: 'ignore' });
            child.unref();
            for (let attempt = 0; attempt < 6 && !attached; attempt++) {
                await new Promise((r) => setTimeout(r, 5_000));
                if (signal.aborted)
                    throw new Error('aborted');
                try {
                    attached = await this.uiBroker.attach(TITLE, signal);
                }
                catch {
                    attached = null;
                }
            }
            if (!attached) {
                return fail('NOT_CONNECTED', 'PDS 已启动但未找到主窗口（可能停在授权/启动对话框）', {
                    details: { exePath },
                });
            }
        }
        this.windowTitle = attached.title;
        const detection = await probeExeVersion(args.pdsPath ?? (await findProteusExe()) ?? '');
        this.adapter = new UiAdapter(detection, () => this.whitelist.list());
        this.transport = 'ui';
        this.major = detection.major;
        const info = {
            transport: 'ui',
            major: detection.major,
            build: detection.build,
            schematicEditSupported: false,
            windowTitle: attached.title,
        };
        if (args.projectPath) {
            info.projectPath = args.projectPath;
            this.currentProjectPath = args.projectPath;
            this.saveState = await fileFingerprint(args.projectPath).catch(() => null);
        }
        return { ok: true, ...info };
    }
    async listPlaceable() {
        return this.whitelist.list();
    }
    /** UI 传输不具备原理图脚本能力的一组操作，统一如实拒绝。 */
    unsupported(name) {
        return fail('UNSUPPORTED_ON_TRANSPORT', `${name} 在 UI 传输下不可用（shipping Proteus 无原理图脚本接口）`, {
            details: { transport: this.transport },
        });
    }
    async placeComponent(args, signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        if (this.transport === 'ui')
            return this.unsupported('proteus_place_component');
        if (!this.schematicEditSupported) {
            return fail('SCHEMATIC_EDIT_UNSUPPORTED_ON_VERSION', '当前版本的原理图编辑能力探测未通过');
        }
        const verified = await this.whitelist.lookup(args.device, args.library);
        if (!verified) {
            return fail('COMPONENT_NOT_IN_PLACEABLE_WHITELIST', `器件 ${args.device} 未通过放置验证`, {
                details: { device: args.device, library: args.library ?? null },
            });
        }
        const rotationDeg = args.rotationDeg ?? 0;
        await this.comBroker.call({
            op: 'placeComponent',
            args: {
                ref: args.ref,
                device: args.device,
                library: verified.library,
                x: Math.round(args.x),
                y: Math.round(args.y),
                rotationDeg,
            },
        }, signal);
        this.pinCache.delete(args.ref);
        this.sheetGeneration += 1;
        return {
            ok: true,
            ref: args.ref,
            note: `已放置（模板原点 x=${args.x}, y=${args.y}, rotation=${rotationDeg}）。连线前必须 proteus_query_pins ["${args.ref}"] 获取引脚世界坐标。`,
        };
    }
    async queryPins(refs, signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        if (this.transport === 'ui')
            return this.unsupported('proteus_query_pins');
        const results = await this.comBroker.batchOps(refs.map((ref) => ({ op: 'componentPins', args: { ref } })), signal);
        const pins = {};
        const missing = [];
        refs.forEach((ref, i) => {
            const r = results[i];
            if (!r?.ok) {
                missing.push(ref);
                return;
            }
            const list = (r.value.pins ?? []);
            pins[ref] = list;
            this.pinCache.set(ref, list);
        });
        if (missing.length > 0 && Object.keys(pins).length === 0) {
            return fail('COMPONENT_NOT_FOUND', `未找到元件: ${missing.join(', ')}`, {
                details: { missing },
            });
        }
        return ok({ pins, generation: this.sheetGeneration });
    }
    parsePinRef(ref) {
        const m = /^([^.]+)\.([^.]+)$/.exec(ref);
        return m ? { component: m[1] ?? '', pin: m[2] ?? '' } : null;
    }
    async connectPins(args, signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        if (this.transport === 'ui')
            return this.unsupported('proteus_connect_pins');
        const pa = this.parsePinRef(args.a);
        const pb = this.parsePinRef(args.b);
        const bad = [!pa ? args.a : null, !pb ? args.b : null].filter((v) => v !== null);
        if (bad.length > 0) {
            return fail('INVALID_PIN_REF', `引脚引用必须是 'R1.2' 形式: ${bad.join(', ')}`, {
                details: { bad },
            });
        }
        const notQueried = [pa, pb].filter((p) => !this.pinCache.has(p.component));
        if (notQueried.length > 0) {
            return fail('PINS_NOT_QUERIED', `连线前未查询引脚: ${notQueried.map((p) => p.component).join(', ')}`, {
                details: { refs: notQueried.map((p) => p.component) },
            });
        }
        const missing = [pa, pb].filter((p) => !this.pinCache.get(p.component)?.some((pin) => pin.index === p.pin));
        if (missing.length > 0) {
            return fail('PIN_NOT_FOUND', `引脚号不存在于缓存引脚表: ${missing.map((p) => `${p.component}.${p.pin}`).join(', ')}`);
        }
        await this.comBroker.call({ op: 'connectPins', args: { aRef: pa.component, aPin: pa.pin, bRef: pb.component, bPin: pb.pin } }, signal);
        this.sheetGeneration += 1;
        return {
            ok: true,
            a: args.a,
            b: args.b,
            note: '已连接。共享同一引脚的多条连接会自动形成真实结点，无需显式处理。',
        };
    }
    async saveSchematic(args, signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        const projectPath = this.currentProjectPath;
        if (!projectPath) {
            return fail('PROJECT_NOT_OPEN', '会话未绑定工程文件（connect 时未传 projectPath），无法确定保存目标');
        }
        if (this.transport === 'ui') {
            // UI 保存 = 应用内 Ctrl+S：原地保存、会中断交互仿真；文件级原子替换守卫不适用（如实说明）。
            // Ctrl+S 会弹出「File will be saved in version 8.17 format...」模态框：必须先点掉，
            // 否则它占住前台（后续注键全 FOREGROUND_FAILED）且文件根本不落盘 —— 旧实现在这里
            // 直接 return ok:true，属于谎报。现在点框 + 用磁盘指纹校验，落盘失败就如实报错。
            const before = await fileFingerprint(projectPath).catch(() => null);
            const dialog = await this.uiBroker.saveWithDialog(signal);
            let after = null;
            for (let attempt = 0; attempt < 12 && !after; attempt++) {
                await new Promise((r) => setTimeout(r, 250));
                after = await fileFingerprint(projectPath).catch(() => null);
            }
            this.saveState = after;
            // 只比内容：指纹的 mtime 会随「存了但内容没变」变化，按内容判成败才准确。
            const contentChanged = Boolean(before && after && fingerprintsDiffer(before, after));
            const touched = Boolean(after && (!before || after.mtimeMs !== before.mtimeMs));
            if (!contentChanged && !touched) {
                return fail('SAVE_NOT_APPLIED', 'Ctrl+S 未使工程文件发生变化（可能被对话框拦下或写入失败）', {
                    details: {
                        dismissedDialog: dialog?.dismissed ?? null,
                        before: before ? { size: before.size, mtimeMs: before.mtimeMs } : null,
                        after: after ? { size: after.size, mtimeMs: after.mtimeMs } : null,
                    },
                });
            }
            return {
                ok: true,
                saved: projectPath,
                dismissedDialog: dialog?.dismissed ?? null,
                contentChanged,
                // before 可能在首次指纹读取时就不存在（工程尚未落盘过），别在这里解引用 null。
                bytes: { before: before?.size ?? null, after: after?.size ?? null },
            };
        }
        // COM 传输：完整守卫链 + 原子替换。
        const unknown = await this.comBroker.call({ op: 'unknownObjectReport' }, signal);
        if (unknown.kinds.length > 0) {
            return fail('UNKNOWN_OBJECTS_PRESENT', `发现 ${unknown.kinds.length} 类未知对象，已拒绝整体重写`, {
                details: { kinds: unknown.kinds },
            });
        }
        const current = await fileFingerprint(projectPath);
        if (this.saveState && fingerprintsDiffer(this.saveState, current) && !args.overwrite) {
            return fail('EXTERNAL_MODIFICATION_DETECTED', '目标文件自上次连接/保存后被外部修改', {
                details: { expected: this.saveState.sha256.slice(0, 12), actual: current.sha256.slice(0, 12) },
            });
        }
        try {
            this.adapter.assertProjectWritableBy(this.major, projectPath);
        }
        catch (error) {
            const domain = asDomainResult(error);
            if (domain) {
                if (args.confirmRollback) {
                    // 用户已显式确认且自认已备份；记录进结果供审计。
                }
                else {
                    return domain;
                }
            }
            else {
                throw error;
            }
        }
        const tmpPath = `${projectPath}.tmp-${process.pid}-${Date.now()}`;
        await this.comBroker.call({ op: 'saveProjectAs', args: { path: tmpPath } }, signal, 120_000);
        try {
            probeProjectFormatSync(tmpPath);
            const size = (await stat(tmpPath)).size;
            if (size === 0)
                throw new Error('临时文件为空');
        }
        catch (error) {
            const { unlink } = await import('node:fs/promises');
            await unlink(tmpPath).catch(() => { });
            const domain = asDomainResult(error);
            if (domain)
                return domain;
            return fail('VERSION_FORMAT_UNKNOWN', `临时文件校验失败: ${String(error)}`);
        }
        await atomicReplace(projectPath, tmpPath);
        this.saveState = await fileFingerprint(projectPath);
        return { ok: true, saved: projectPath };
    }
    // ---- 仿真生命周期（双传输；UI 侧组合全部基于实测键盘原语） ----
    /**
     * UI 侧状态迁移：按顺序尝试多个原语，每个原语后轮询 probe 直到到达目标态。
     * 单靠一个原语不可靠（实测：Animation 工具栏按钮在 idle 时被禁用、点击无效；
     * 而 F12 与 Shift+Pause 一直有效），所以两种都试，谁先到目标态谁算数。
     */
    async uiTransition(signal, primitives, want) {
        for (const run of primitives) {
            await run();
            for (let poll = 0; poll < 3; poll++) {
                await new Promise((r) => setTimeout(r, 450));
                if ((await this.uiBroker.probe(signal)).state === want) {
                    return true;
                }
            }
        }
        return false;
    }
    async simStart(signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        if (this.transport === 'ui') {
            // 已经是 running 就直接报领域失败；paused 不算（那是「恢复」，F12 能接上）。
            if ((await this.uiBroker.probe(signal)).state === 'running') {
                return fail('SIM_ALREADY_RUNNING', '仿真已在运行');
            }
            for (let attempt = 0; attempt < 2; attempt++) {
                // 实测优先级：F12 = 运行/恢复（idle→running、paused→running 均实测通过）；
                // 工具栏 btn0 在同一 build 上 idle 时是禁用状态，点了没有反应，只作为兜底。
                const started = await this.uiTransition(signal, [
                    () => this.uiBroker.keyF12(signal),
                    () => this.uiBroker.clickTransportButton(0, signal),
                ], 'running');
                if (started) {
                    return { ok: true, state: 'running' };
                }
            }
            return fail('SIM_NOT_CONVERGED', '启动仿真未生效（F12 与工具栏播放键均未使状态变为 running）');
        }
        if (this.simState === 'running') {
            return fail('SIM_ALREADY_RUNNING', '仿真已在运行');
        }
        const result = await this.comBroker.call({ op: 'simStart' }, signal);
        this.simState = result.state;
        return { ok: true, state: result.state };
    }
    async simStop(signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        if (this.transport === 'ui') {
            for (let attempt = 0; attempt < 2; attempt++) {
                const cur = (await this.uiBroker.probe(signal)).state;
                if (cur === 'idle') {
                    return { ok: true, state: 'idle' };
                }
                // 实测优先级：Shift+Pause = 停止（running/paused→idle 均有效）；
                // 菜单 Design→Stop Animation 走 F10 键盘路径，作为第二选择；
                // 工具栏先 pause 再 stop 是最后的兜底（按钮在部分状态下被禁用）。
                const stopped = await this.uiTransition(signal, [
                    () => this.uiBroker.keyShiftPause(signal),
                    () => this.uiBroker.menuStop(signal),
                    async () => {
                        if ((await this.uiBroker.probe(signal)).state === 'running') {
                            await this.uiBroker.clickTransportButton(1, signal);
                            await new Promise((r) => setTimeout(r, 800));
                        }
                        await this.uiBroker.clickTransportButton(2, signal);
                    },
                ], 'idle');
                if (stopped) {
                    return { ok: true, state: 'idle' };
                }
            }
            return fail('SIM_STOP_FAILED', '停止仿真未生效（Shift+Pause、菜单停止与工具栏停止键均未使状态变为 idle）');
        }
        if (this.simState === null || this.simState === 'idle') {
            return fail('SIM_NOT_RUNNING', '仿真未在运行');
        }
        const result = await this.comBroker.call({ op: 'simStop' }, signal);
        this.simState = result.state;
        return { ok: true, state: result.state };
    }
    async simStatus(signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        if (this.transport === 'ui') {
            const cur = (await this.uiBroker.probe(signal)).state;
            return { ok: true, state: cur };
        }
        const result = await this.comBroker.call({ op: 'simStatus' }, signal);
        this.simState = result.state;
        if (result.state === 'error') {
            return fail('SIM_NOT_CONVERGED', result.reason ?? '仿真进入失败状态（未收敛）');
        }
        // timeSeconds 是可选字段：写 undefined 会让宿主 lossless-JSON 快照失败，
        // 所以只在 COM 真的给出数值时才带这个键。
        return typeof result.timeSeconds === 'number'
            ? { ok: true, state: result.state, timeSeconds: result.timeSeconds }
            : { ok: true, state: result.state };
    }
    async readSignals(args, signal) {
        const guard = this.guard();
        if (guard)
            return guard;
        if (this.transport === 'ui')
            return this.unsupported('proteus_read_signals');
        const sampleMs = Math.max(50, args.sampleMs ?? 500);
        const samples = Math.max(1, Math.min(100, args.samples ?? 1));
        const collected = [];
        for (let i = 0; i < samples; i++) {
            if (signal.aborted)
                break;
            const result = await this.comBroker.call({ op: 'readProbes', args: { names: args.probes } }, signal);
            collected.push(result.probes);
            if (i < samples - 1) {
                await new Promise((resolve, reject) => {
                    const t = setTimeout(resolve, sampleMs);
                    signal.addEventListener('abort', () => {
                        clearTimeout(t);
                        reject(new Error('aborted'));
                    }, { once: true });
                }).catch(() => { });
            }
        }
        return { ok: true, samples: collected };
    }
    simState = null;
}
