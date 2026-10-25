interface ToolsContext {
    tools: {
        register(definition: unknown): () => void;
    };
}
export declare function registerLayoutTools(ctx: ToolsContext): void;
export {};
