export interface PlaceableComponent {
    /** Proteus 器件名（如 RES, CAP, 8086）。 */
    device: string;
    /** 所属库（如 Active, DEVICE）。 */
    library: string;
    /** 验证时记录的引脚数（放置后与 query_pins 结果核对）。 */
    pinCount?: number;
    /** 执行验证流程时的 Proteus build（如 8.16.SP3）。 */
    verifiedOnBuild: string;
    verifiedAt: string;
    notes?: string;
}
export declare class WhitelistStore {
    private readonly filePath;
    private cache;
    constructor(filePath?: string);
    private load;
    list(): Promise<PlaceableComponent[]>;
    /** 放置前的白名单判定：精确匹配 device+library，library 未指明时匹配任一同名 device。 */
    lookup(device: string, library?: string): Promise<PlaceableComponent | undefined>;
    /** 验证工作流入库（开发/维护用，运行时工具不暴露写入）。 */
    addVerified(entry: PlaceableComponent): Promise<void>;
}
