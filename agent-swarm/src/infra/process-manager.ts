import { promisify } from 'util';

const execFile = promisify(require('child_process').execFile);

const GAMMA_POOL_MAX = parseInt(process.env.GAMMA_POOL_MAX || '3');

interface GammaPoolStatus {
  active: number;
  total: number;
  instances: string[];
}

class ProcessManager {
  private gammaPool: Set<string> = new Set(['gamma-1']);

  async connect(): Promise<void> {
    console.log('[ProcessManager] Connected');
  }

  async getGammaPoolStatus(): Promise<GammaPoolStatus> {
    return {
      active: this.gammaPool.size,
      total: GAMMA_POOL_MAX,
      instances: Array.from(this.gammaPool),
    };
  }

  async scaleGammaIfNeeded(queuedCount: number): Promise<void> {
    const currentCount = this.gammaPool.size;

    if (queuedCount > 1 && currentCount < GAMMA_POOL_MAX) {
      const nextInstance = currentCount + 1;

      if (nextInstance <= GAMMA_POOL_MAX) {
        const instanceName = `gamma-${nextInstance}`;

        console.log(`[ProcessManager] Scaling gamma pool: starting ${instanceName}`);

        try {
          await execFile('pm2', [
            'start',
            'ecosystem.config.js',
            '--only',
            instanceName,
          ]);
          
          this.gammaPool.add(instanceName);
          console.log(`[ProcessManager] ${instanceName} started via PM2, pool size: ${this.gammaPool.size}`);
        } catch (error) {
          console.error(`[ProcessManager] Failed to start ${instanceName}: ${error}`);
        }
      }
    }
  }

  async scaleDownGamma(instanceName: string): Promise<void> {
    if (!this.gammaPool.has(instanceName)) return;
    if (instanceName === 'gamma-1') return;

    try {
      await execFile('pm2', ['delete', instanceName]);
      this.gammaPool.delete(instanceName);
      console.log(`[ProcessManager] Scaled down ${instanceName}, pool size: ${this.gammaPool.size}`);
    } catch (error) {
      console.error(`[ProcessManager] Failed to scale down ${instanceName}: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    console.log('[ProcessManager] Disconnected');
  }
}

export const processManager = new ProcessManager();
