import { defaultLauncherConfig } from '../../src/config/launcher.config';

describe('Launcher Config Unit', () => {
  it('should export valid launcher configuration', () => {
    expect(defaultLauncherConfig).toBeDefined();
    expect(defaultLauncherConfig.appName).toBeDefined();
    expect(defaultLauncherConfig.services.length).toBeGreaterThan(0);
    expect(defaultLauncherConfig.services[0].name).toBe('express-backend');
    expect(defaultLauncherConfig.services[0].port).toBeDefined();
  });
});
