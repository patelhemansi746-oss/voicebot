import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { defaultLauncherConfig, LauncherConfig, ServiceConfig } from '../config/launcher.config';

export class ServiceLauncher {
  private config: LauncherConfig;
  private processes: Map<string, ChildProcess> = new Map();
  private isShuttingDown: boolean = false;

  constructor(config: LauncherConfig = defaultLauncherConfig) {
    this.config = config;
  }

  /**
   * Perform pre-flight environment checks
   */
  public async preflightChecks(): Promise<boolean> {
    // eslint-disable-next-line no-console
    console.log(`[Launcher] Running pre-flight checks for ${this.config.appName}...`);

    if (!process.version) {
      // eslint-disable-next-line no-console
      console.error('[Launcher] Pre-flight failed: Node runtime not detected.');
      return false;
    }

    // eslint-disable-next-line no-console
    console.log(`[Launcher] Node environment: ${process.version} (${this.config.env})`);
    return true;
  }

  /**
   * Health check poller for an HTTP service
   */
  public async waitForHealthCheck(
    port: number,
    path: string,
    timeoutMs: number = 10000,
    intervalMs: number = 500
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (this.isShuttingDown) return false;

      const isHealthy = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://localhost:${port}${path}`, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
          req.destroy();
          resolve(false);
        });
      });

      if (isHealthy) {
        return true;
      }

      await new Promise((res) => setTimeout(res, intervalMs));
    }

    return false;
  }

  /**
   * Start a single service
   */
  public async startService(service: ServiceConfig): Promise<boolean> {
    // eslint-disable-next-line no-console
    console.log(`[Launcher] Starting service '${service.name}'...`);

    return new Promise((resolve) => {
      const child = spawn(service.command, service.args, {
        stdio: 'pipe',
        shell: process.platform === 'win32',
        env: { ...process.env, PORT: service.port?.toString() || '5000' }
      });

      this.processes.set(service.name, child);

      child.stdout?.on('data', (data) => {
        // eslint-disable-next-line no-console
        console.log(`[${service.name}] ${data.toString().trim()}`);
      });

      child.stderr?.on('data', (data) => {
        // eslint-disable-next-line no-console
        console.error(`[${service.name}:err] ${data.toString().trim()}`);
      });

      child.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error(`[Launcher] Failed to start service ${service.name}:`, err.message);
        resolve(false);
      });

      child.on('exit', (code) => {
        this.processes.delete(service.name);
        if (!this.isShuttingDown) {
          // eslint-disable-next-line no-console
          console.warn(`[Launcher] Service ${service.name} exited with code ${code}`);
        }
      });

      // If service has a health check, wait for it
      if (service.port && service.healthCheckPath) {
        this.waitForHealthCheck(service.port, service.healthCheckPath, service.timeoutMs)
          .then((healthy) => {
            if (healthy) {
              // eslint-disable-next-line no-console
              console.log(`[Launcher] Service '${service.name}' is healthy!`);
              resolve(true);
            } else {
              // eslint-disable-next-line no-console
              console.error(`[Launcher] Service '${service.name}' failed health check.`);
              if (service.required) {
                this.stopAll();
              }
              resolve(false);
            }
          })
          .catch(() => resolve(false));
      } else {
        // No health check needed, assume started
        resolve(true);
      }
    });
  }

  /**
   * Start all registered services in orchestrator
   */
  public async startAll(): Promise<boolean> {
    const passed = await this.preflightChecks();
    if (!passed) return false;

    // eslint-disable-next-line no-console
    console.log(`[Launcher] Orchestrating ${this.config.services.length} service(s)...`);

    for (const service of this.config.services) {
      const started = await this.startService(service);
      if (!started && service.required) {
        // eslint-disable-next-line no-console
        console.error(`[Launcher] Required service '${service.name}' failed to initialize.`);
        await this.stopAll();
        return false;
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[Launcher] All services started successfully.`);
    return true;
  }

  /**
   * Stop all running child processes gracefully
   */
  public async stopAll(): Promise<void> {
    this.isShuttingDown = true;
    // eslint-disable-next-line no-console
    console.log('[Launcher] Stopping all services...');

    for (const [name, proc] of this.processes.entries()) {
      // eslint-disable-next-line no-console
      console.log(`[Launcher] Terminating '${name}'...`);
      proc.kill('SIGTERM');
    }

    this.processes.clear();
  }

  public getActiveServiceCount(): number {
    return this.processes.size;
  }
}

// Direct execution entrypoint
if (require.main === module) {
  const launcher = new ServiceLauncher();

  const handleSignal = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n[Launcher] Caught ${signal}, initiating graceful shutdown...`);
    await launcher.stopAll();
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  launcher.startAll().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[Launcher] Fatal orchestrator error:', err);
    process.exit(1);
  });
}

