/**
 * 版本适配层。V8 是主支持目标（参考 8.16 SP3）；V9 的原理图编辑 COM 能力
 * 必须单独探测，探测不通过 → 工具返回 SCHEMATIC_EDIT_UNSUPPORTED_ON_VERSION，
 * 不静默降级、不尝试后报模糊错误。
 */
import type { ComBroker } from './com/broker.js';
import type { PlaceableComponent } from './whitelist.js';
import { type FormatProbe } from './guards.js';
import { GuardRejection } from './errors.js';
export interface ProteusVersionAdapter {
    detect(): Promise<{
        major: 8 | 9;
        build?: string;
    }>;
    supportsSchematicEditing(): boolean;
    /** 守卫层方法：失败抛 GuardRejection（工具边界翻译为领域值）。 */
    assertProjectWritableBy(version: 8 | 9, filePath: string): void;
    getPlaceableComponents(): Promise<PlaceableComponent[]>;
}
export interface ProteusDetection {
    major: 8 | 9;
    build?: string;
    formatProbe?: FormatProbe;
}
/** 按探测结果选择适配器；placeables 延迟绑定到白名单存储。 */
export declare function createAdapter(detection: ProteusDetection, broker: ComBroker, placeables: () => Promise<PlaceableComponent[]>): ProteusVersionAdapter;
/** 工具边界用：把 GuardRejection 翻译前的适配层守卫调用包一层语义注释。 */
export declare function rollbackGuardMessage(probe: FormatProbe, target: 8 | 9): GuardRejection;
