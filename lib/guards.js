/**
 * 保存守卫链：外部修改检测、格式版本回退守卫、原子替换。
 * 全部基于磁盘事实，不依赖"哪个版本的 Proteus 打开过它"。
 *
 * assertProjectWritableBy 的签名是同步 void（用户给定接口）：用 readFileSync
 * 只读文件头 4KB 做版本嗅探，同步完成，工具层不需要为守卫开异步。
 */
import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { GuardRejection } from './errors.js';
export async function fileFingerprint(filePath) {
    const [st, data] = await Promise.all([stat(filePath), readFile(filePath)]);
    return {
        size: st.size,
        mtimeMs: st.mtimeMs,
        sha256: createHash('sha256').update(data).digest('hex'),
    };
}
export function fingerprintsDiffer(a, b) {
    return a.sha256 !== b.sha256 || a.size !== b.size;
}
/**
 * 读取 .pdsprj 的实际格式版本/元数据（同步，仅读头部）。
 *
 * TODO(verify)：容器字节签名需要真实样本 —— 取 Proteus 8.16 与 9 各自保存的
 * 工程文件各一枚，确定 header 中格式版本字段的位置与编码后替换占位正则。
 * 解析不出即抛 VERSION_FORMAT_UNKNOWN，绝不在版本不明时放行写入（fail-closed）。
 */
export function probeProjectFormatSync(filePath) {
    let head;
    try {
        const fd = openSync(filePath, 'r');
        try {
            const buf = Buffer.alloc(4096);
            const bytesRead = readSync(fd, buf, 0, buf.length, 0);
            head = buf.subarray(0, bytesRead);
        }
        finally {
            closeSync(fd);
        }
    }
    catch (error) {
        throw new GuardRejection('VERSION_FORMAT_UNKNOWN', `无法读取工程文件头部: ${String(error)}`);
    }
    const ascii = head.toString('latin1');
    const m = /formatVersion["\s:=]+([\w.\-]+)/i.exec(ascii);
    if (!m?.[1]) {
        throw new GuardRejection('VERSION_FORMAT_UNKNOWN', '工程头部未找到可判定的格式版本标记；版本回退守卫 fail-closed');
    }
    const createdBy = /createdBy["\s:=]+([\w.\-]+)/i.exec(ascii);
    return { formatVersion: m[1], createdByBuild: createdBy?.[1] };
}
/**
 * 版本回退守卫（给定接口，同步 void）：读取磁盘上 .pdsprj 的实际格式版本，
 * 阻断"8 打开 → 9 保存 → 回传 8"的流程。用户显式确认（confirmRollback）
 * 由工具层在调用本守卫前裁决。
 */
export function assertProjectWritableBy(version, filePath) {
    const probe = probeProjectFormatSync(filePath);
    assertProbeWritable(version, probe);
}
/** 有了 FormatProbe 的纯判定（session 已探测过时避免重复读盘）。 */
export function assertProbeWritable(version, probe) {
    // TODO(verify)：可写范围映射表随格式签名研究确定。骨架保守规则：
    // "8" 系格式双方可写；"9" 系格式 8 不可写（回退阻断）；其它一律 fail-closed。
    const major = probe.formatVersion.split('.')[0] ?? probe.formatVersion;
    if (major === '8')
        return;
    if (major === '9') {
        throw new GuardRejection('VERSION_ROLLBACK_BLOCKED', `文件格式版本 ${probe.formatVersion} 由 Proteus 9 系写入，Proteus ${version} 无法打开`, probe);
    }
    throw new GuardRejection('VERSION_FORMAT_UNKNOWN', `未知的工程格式版本 ${probe.formatVersion}`, probe);
}
/**
 * 原子替换：rename(target → bak) → rename(tmp → target)；第二步失败回滚 bak。
 * Windows 上 Node 的 rename 可覆盖既有文件；bak 舞步提供失败回滚路径。
 */
export async function atomicReplace(target, tmpPath) {
    const backup = join(dirname(target), `${basename(target)}.bak-${Date.now()}`);
    await rename(target, backup);
    try {
        await rename(tmpPath, target);
    }
    catch (error) {
        await rename(backup, target).catch(() => { });
        throw error;
    }
    await unlink(backup).catch(() => { });
    return { backup };
}
