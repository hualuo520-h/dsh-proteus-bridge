import { type DomainResult } from './errors.js';
export interface LayoutRequest {
    refs: string[];
    columns?: number;
    /** 元件间距（mm），默认 40。 */
    gridMm?: number;
    /** 网格起点（原生单位，Y 向上）。 */
    originX?: number;
    originY?: number;
    /** 按前缀分区（如 ['U','R','C'] → U 区、R 区、C 区依次堆叠）。 */
    partitionPrefixes?: string[];
}
export interface LayoutSuggestion {
    ref: string;
    x: number;
    y: number;
    rotationDeg: 0;
    partition?: string;
}
export type LayoutResult = DomainResult<{
    suggestions: LayoutSuggestion[];
    notes: string[];
}>;
export declare function suggestLayout(req: LayoutRequest): LayoutResult;
