/** 仿真生命周期与信号读取工具。 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { present, proteusOutput } from '../toolkit.js';
export function registerSimulationTools(ctx, session) {
    ctx.tools.register(defineTool({
        name: 'proteus_connect',
        description: '建立/复用 Proteus COM 会话（ProgID Labcenter.InteractiveSimulation）。连接全程只建立一次并跨所有工具复用；可选打开一个 .pdsprj 工程。返回 Proteus 主版本/build、原理图编辑能力是否可用（Proteus 9 需探测）、工程 sheet 概要。打开工程前会做版本回退守卫：格式版本高于目标（Proteus 9 文件）时返回 VERSION_ROLLBACK_BLOCKED。重复调用幂等。',
        parameters: {
            projectPath: {
                type: 'string',
                description: '要打开的 .pdsprj 绝对路径；省略则仅建立会话不打开工程。',
            },
        },
        output: proteusOutput(),
        timeoutMs: 120_000,
        execute(args, exec) {
            return session.connect(args, exec.signal);
        },
        presentCall: present('连接 Proteus 会话', 'read'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_sim_start',
        description: '启动 Proteus 交互仿真。立即返回，运行状态与收敛情况用 proteus_sim_status 轮询；仿真失败/未收敛会作为领域结果 SIM_NOT_CONVERGED 返回，不是异常。Proteus 9 仿真能力探测未通过时返回 SIMULATION_UNSUPPORTED_ON_VERSION。',
        parameters: {},
        output: proteusOutput(),
        timeoutMs: 60_000,
        execute(_args, exec) {
            return session.simStart(exec.signal);
        },
        presentCall: present('启动交互仿真', 'write'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_sim_stop',
        description: '停止 Proteus 交互仿真。未运行时返回 SIM_NOT_RUNNING。',
        parameters: {},
        output: proteusOutput(),
        timeoutMs: 60_000,
        execute(_args, exec) {
            return session.simStop(exec.signal);
        },
        presentCall: present('停止交互仿真', 'write'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_sim_status',
        description: '查询交互仿真状态（idle/running/paused/halted/error）与已运行时长。state=error 时返回领域结果 SIM_NOT_CONVERGED 并携带原因——先修电路再重新 start。',
        parameters: {},
        output: proteusOutput(),
        timeoutMs: 30_000,
        execute(_args, exec) {
            return session.simStatus(exec.signal);
        },
        presentCall: present('查询仿真状态', 'read'),
    }));
    ctx.tools.register(defineTool({
        name: 'proteus_read_signals',
        description: '读取交互仿真探针值（电压表/电流表等）。可单次或按 sampleMs 间隔轮询 samples 次；轮询期间随时可被取消（取消延迟为一个采样间隔）。probe 名以原理图上的探针元件引用为准。',
        parameters: {
            probes: {
                type: 'array',
                description: '要读取的探针引用列表；省略则读取全部可见探针。',
                items: { type: 'string' },
            },
            sampleMs: {
                type: 'integer',
                description: '采样间隔毫秒（默认 500，最小 50）。',
            },
            samples: {
                type: 'integer',
                description: '采样次数（默认 1，最大 100）。',
            },
        },
        output: proteusOutput(),
        timeoutMs: 300_000,
        execute(args, exec) {
            return session.readSignals(args, exec.signal);
        },
        presentCall: present('读取仿真信号', 'read'),
    }));
}
