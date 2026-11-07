import { ServiceLauncher } from '../../src/scripts/launcher';
import { LauncherConfig } from '../../src/config/launcher.config';

describe('Service Launcher Smoke Tests', () => {
  it('should pass pre-flight checks in current Node environment', async () => {
    const launcher = new ServiceLauncher();
    const passed = await launcher.preflightChecks();

    expect(passed).toBe(true);
  });

  it('should initialize with default config and zero active services', () => {
    const launcher = new ServiceLauncher();
    expect(launcher.getActiveServiceCount()).toBe(0);
  });

  it('should gracefully stop when stopAll is called', async () => {
    const customConfig: LauncherConfig = {
      appName: 'test-orchestrator',
      version: '1.0.0',
      env: 'test',
      services: []
    };

    const launcher = new ServiceLauncher(customConfig);
    const startResult = await launcher.startAll();

    expect(startResult).toBe(true);
    await launcher.stopAll();
    expect(launcher.getActiveServiceCount()).toBe(0);
  });
});
