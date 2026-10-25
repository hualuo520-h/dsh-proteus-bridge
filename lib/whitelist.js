/**
 * 器件白名单 = 插件自身"放置 → 保存 → 重开"验证过的可放置器件集合。
 * 不是 Proteus 器件库目录的倒出：目录可查但未验证的器件必须被拒绝。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { infra } from './errors.js';
const DEFAULT_PATH = fileURLToPath(new URL('../whitelist/placeable.v1.json', import.meta.url));
export class WhitelistStore {
    filePath;
    cache = null;
    constructor(filePath = DEFAULT_PATH) {
        this.filePath = filePath;
    }
    async load() {
        if (this.cache)
            return this.cache;
        let parsed;
        try {
            parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
        }
        catch (error) {
            infra('WHITELIST_UNREADABLE', `白名单文件不可读 (${this.filePath}): ${String(error)}`);
        }
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.components)) {
            infra('WHITELIST_UNREADABLE', `白名单文件结构不合法 (schemaVersion=${parsed?.schemaVersion})`);
        }
        this.cache = parsed;
        return parsed;
    }
    async list() {
        return [...(await this.load()).components];
    }
    /** 放置前的白名单判定：精确匹配 device+library，library 未指明时匹配任一同名 device。 */
    async lookup(device, library) {
        const { components } = await this.load();
        return components.find((c) => c.device === device &&
            (library === undefined || library === '' || c.library === library));
    }
    /** 验证工作流入库（开发/维护用，运行时工具不暴露写入）。 */
    async addVerified(entry) {
        const file = await this.load();
        file.components = file.components.filter((c) => !(c.device === entry.device && c.library === entry.library));
        file.components.push(entry);
        const { writeFile } = await import('node:fs/promises');
        await writeFile(this.filePath, JSON.stringify(file, null, 2) + '\n', 'utf8');
    }
}
