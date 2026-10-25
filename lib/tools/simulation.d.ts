import type { ProteusSession } from '../session.js';
interface ToolsContext {
    tools: {
        register(definition: unknown): () => void;
    };
}
export declare function registerSimulationTools(ctx: ToolsContext, session: ProteusSession): void;
export {};
