export declare const name = "proteus-bridge";
export declare const inject: readonly ["tools"];
interface ToolsContext {
    tools: {
        register(definition: unknown): () => void;
    };
    effect(callback: () => () => void, label?: string): () => void;
    logger?: {
        info(...args: unknown[]): void;
    };
}
export declare function apply(ctx: ToolsContext): void;
export {};
