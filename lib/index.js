/**
 * dsh-proteus-bridge —— 插件入口。
 *
 * 事实契约（对照宿主 dsh-tools/dsh-tool-cordis 源码核实）：
 *  - 导出 { name, inject, apply }；inject=['tools'] 让 Cordis 等待工具注册表就绪；
 *  - ctx.tools.register(defineTool(...)) 返回精确 disposer，重复名注册失败；
 *  - 资源生命周期由本插件 fiber 管：ctx.effect 注册的 dispose 与工具注册同生命周期，
 *    卸载/HMR 时关闭 broker 子进程并释放 COM 引用。
 */
import { ProteusSession } from './session.js';
import { registerLayoutTools } from './tools/layout.js';
import { registerSchematicTools } from './tools/schematic.js';
import { registerSimulationTools } from './tools/simulation.js';
export const name = 'proteus-bridge';
export const inject = ['tools'];
const TOOL_NAMES = [
    'proteus_connect',
    'proteus_sim_start',
    'proteus_sim_stop',
    'proteus_sim_status',
    'proteus_read_signals',
    'proteus_list_placeable_components',
    'proteus_place_component',
    'proteus_query_pins',
    'proteus_connect_pins',
    'proteus_save_schematic',
    'proteus_suggest_layout',
];
export function apply(ctx) {
    const session = new ProteusSession();
    // fiber dispose：插件卸载时关 broker（进而释放 IApplication），不留孤儿进程。
    ctx.effect(() => () => {
        void session.dispose();
    }, 'proteus-bridge.session-dispose');
    registerSimulationTools(ctx, session);
    registerSchematicTools(ctx, session);
    registerLayoutTools(ctx);
    ctx.logger?.info(`proteus-bridge: ${TOOL_NAMES.length} tools registered (${TOOL_NAMES.join(', ')})`);
}
