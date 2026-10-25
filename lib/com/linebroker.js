/**
 * JSON 行协议子进程的公共底座：一次会话一个持久子进程，请求批量、超时/abort 杀进程重建。
 * ComBroker（COM）与 UiBroker（Win32 UI）共用。
 */
import { spawn } from 'node:child_process';
import { infra } from '../errors.js';
export class LineBroker {
    command;
    args;
    proc = null;
    pending = new Map();
    nextId = 1;
    buffer = '';
    crashed = false;
    constructor(command, args) {
        this.command = command;
        this.args = args;
    }
    get alive() {
        return this.proc !== null && !this.crashed;
    }
    /** 启动子进程并跑一次 ping 确认存活（幂等；dead 后自动重建）。 */
    async ensureAlive(signal) {
        if (this.alive)
            return;
        this.spawnProc();
        const results = await this.batch([{ op: 'ping' }], signal, 20_000);
        const first = results[0];
        if (!first?.ok) {
            const reason = first && !first.ok ? first.error : 'no response';
            this.killProc();
            infra('COM_CALL_FAILED', `broker ping failed: ${reason}`);
        }
    }
    /** 单调用便捷封装；broker 层 ok:false 转成 COM_CALL_FAILED 异常。 */
    async call(call, signal, timeoutMs = 20_000) {
        const [result] = await this.batch([call], signal, timeoutMs);
        if (!result)
            infra('BROKER_CRASHED', 'broker returned no result');
        if (!result.ok)
            infra('COM_CALL_FAILED', `${call.op}: ${result.error}`);
        return result.value;
    }
    /** 批量调用：单次跨进程往返执行多个 op。 */
    async batch(calls, signal, timeoutMs = 20_000) {
        if (!this.alive)
            infra('BROKER_CRASHED', 'broker not alive; call ensureAlive() first');
        if (calls.length === 0)
            return Promise.resolve([]);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const proc = this.proc;
            const timer = setTimeout(() => {
                // 超时 = 可靠取消 = 杀子进程；本请求拒绝，其余 pending 由 exit 事件收尸。
                this.killProc();
                this.rejectPending(id, 'BROKER_TIMEOUT', reject);
            }, timeoutMs);
            if (signal.aborted) {
                clearTimeout(timer);
                reject(new Error('aborted'));
                return;
            }
            const onAbort = () => {
                clearTimeout(timer);
                this.pending.delete(id);
                this.killProc();
                reject(new Error('aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            this.pending.set(id, { resolve, reject, timer, signal, onAbort });
            const request = { id, calls };
            proc.stdin.write(JSON.stringify(request) + '\n');
        });
    }
    async dispose() {
        if (!this.proc)
            return;
        try {
            this.proc.stdin.write(JSON.stringify({ id: this.nextId++, exit: true }) + '\n');
        }
        catch {
            /* 进程已死则直接收尸 */
        }
        const proc = this.proc;
        setTimeout(() => {
            if (!proc.killed)
                proc.kill();
        }, 3_000).unref();
        this.proc = null;
        this.crashed = false;
    }
    spawnProc() {
        const proc = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.crashed = false;
        this.proc = proc;
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => this.onStdout(chunk));
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk) => {
            console.warn('[dsh-proteus-bridge] broker stderr:', chunk.trim());
        });
        proc.on('exit', () => {
            this.crashed = true;
            this.proc = null;
            for (const [id, p] of [...this.pending]) {
                clearTimeout(p.timer);
                p.signal.removeEventListener('abort', p.onAbort);
                p.reject(new Error('BROKER_CRASHED'));
                this.pending.delete(id);
            }
        });
    }
    onStdout(chunk) {
        this.buffer += chunk;
        for (;;) {
            const nl = this.buffer.indexOf('\n');
            if (nl < 0)
                break;
            const line = this.buffer.slice(0, nl).trim();
            this.buffer = this.buffer.slice(nl + 1);
            if (line === '')
                continue;
            let response;
            try {
                response = JSON.parse(line);
            }
            catch {
                continue; // 非 JSON 行（banner 等）忽略
            }
            const pending = this.pending.get(response.id);
            if (!pending)
                continue;
            clearTimeout(pending.timer);
            pending.signal.removeEventListener('abort', pending.onAbort);
            this.pending.delete(response.id);
            pending.resolve(response.results);
        }
    }
    rejectPending(id, message, reject) {
        const pending = this.pending.get(id);
        if (!pending)
            return;
        this.pending.delete(id);
        pending.signal.removeEventListener('abort', pending.onAbort);
        reject(new Error(message));
    }
    killProc() {
        const proc = this.proc;
        if (!proc)
            return;
        this.crashed = true;
        try {
            proc.kill();
        }
        catch {
            /* 已退出 */
        }
        this.proc = null;
    }
}
