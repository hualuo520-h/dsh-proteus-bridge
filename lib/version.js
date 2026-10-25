import { assertProjectWritableBy } from './guards.js';
import { GuardRejection } from './errors.js';
class V8Adapter {
    broker;
    detection;
    placeables;
    constructor(broker, detection, placeables) {
        this.broker = broker;
        this.detection = detection;
        this.placeables = placeables;
    }
    async detect() {
        return { major: 8, build: this.detection.build };
    }
    /** 参考实现验证于 8.16 SP3 —— 恒支持。 */
    supportsSchematicEditing() {
        return true;
    }
    assertProjectWritableBy(version, filePath) {
        // 基于磁盘文件的实际格式版本判定（guards.probeProjectFormat），与"哪个版本的
        // Proteus 打开过它"无关。9 的文件不能被 8 打开；未知版本 fail-closed。
        assertProjectWritableBy(version, filePath);
    }
    async getPlaceableComponents() {
        return this.placeables();
    }
}
class V9Adapter {
    broker;
    detection;
    placeables;
    editSupport = null;
    constructor(broker, detection, placeables) {
        this.broker = broker;
        this.detection = detection;
        this.placeables = placeables;
    }
    async detect() {
        return { major: 9, build: this.detection.build };
    }
    /**
     * Proteus 9 必须单独探测：打开临时最小工程做一次无副作用原理图读。
     * 未探测或探测失败一律 false，由工具统一返回
     * SCHEMATIC_EDIT_UNSUPPORTED_ON_VERSION / SIMULATION_UNSUPPORTED_ON_VERSION。
     */
    supportsSchematicEditing() {
        return this.editSupport === true;
    }
    /** 消费一次探测结果（session 在 detect 后调用）。 */
    recordProbeResult(supported) {
        this.editSupport = supported;
    }
    assertProjectWritableBy(version, filePath) {
        assertProjectWritableBy(version, filePath);
    }
    async getPlaceableComponents() {
        return this.placeables();
    }
}
/** 按探测结果选择适配器；placeables 延迟绑定到白名单存储。 */
export function createAdapter(detection, broker, placeables) {
    if (detection.major === 9) {
        const adapter = new V9Adapter(broker, detection, placeables);
        // 立即执行一次能力探测并缓存（broker 已 alive；探测失败 = 不支持）。
        void broker
            .call({ op: 'schematicEditProbe' }, new AbortController().signal)
            .then((r) => adapter.recordProbeResult(r.supported === true))
            .catch(() => adapter.recordProbeResult(false));
        return adapter;
    }
    return new V8Adapter(broker, detection, placeables);
}
/** 工具边界用：把 GuardRejection 翻译前的适配层守卫调用包一层语义注释。 */
export function rollbackGuardMessage(probe, target) {
    return new GuardRejection('VERSION_ROLLBACK_BLOCKED', `文件格式版本 ${probe.formatVersion} 高于目标 Proteus ${target} 可写范围，回传 8 将无法打开`, probe);
}
