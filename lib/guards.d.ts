export interface FileFingerprint {
    size: number;
    mtimeMs: number;
    sha256: string;
}
export declare function fileFingerprint(filePath: string): Promise<FileFingerprint>;
export declare function fingerprintsDiffer(a: FileFingerprint, b: FileFingerprint): boolean;
export interface FormatProbe {
    formatVersion: string;
    createdByBuild?: string;
}
/**
 * 读取 .pdsprj 的实际格式版本/元数据（同步，仅读头部）。
 *
 * TODO(verify)：容器字节签名需要真实样本 —— 取 Proteus 8.16 与 9 各自保存的
 * 工程文件各一枚，确定 header 中格式版本字段的位置与编码后替换占位正则。
 * 解析不出即抛 VERSION_FORMAT_UNKNOWN，绝不在版本不明时放行写入（fail-closed）。
 */
export declare function probeProjectFormatSync(filePath: string): FormatProbe;
/**
 * 版本回退守卫（给定接口，同步 void）：读取磁盘上 .pdsprj 的实际格式版本，
 * 阻断"8 打开 → 9 保存 → 回传 8"的流程。用户显式确认（confirmRollback）
 * 由工具层在调用本守卫前裁决。
 */
export declare function assertProjectWritableBy(version: 8 | 9, filePath: string): void;
/** 有了 FormatProbe 的纯判定（session 已探测过时避免重复读盘）。 */
export declare function assertProbeWritable(version: 8 | 9, probe: FormatProbe): void;
/**
 * 原子替换：rename(target → bak) → rename(tmp → target)；第二步失败回滚 bak。
 * Windows 上 Node 的 rename 可覆盖既有文件；bak 舞步提供失败回滚路径。
 */
export declare function atomicReplace(target: string, tmpPath: string): Promise<{
    backup: string;
}>;
