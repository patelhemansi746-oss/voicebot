export interface ServiceConfig {
  name: string;
  command: string;
  args: string[];
  port?: number;
  healthCheckPath?: string;
  required: boolean;
  timeoutMs: number;
}

export interface LauncherConfig {
  appName: string;
  version: string;
  env: string;
  services: ServiceConfig[];
}

export const defaultLauncherConfig: LauncherConfig = {
  appName: process.env.LAUNCHER_SERVICE_NAME || 'sde-8-voicebot-backend',
  version: '1.0.0',
  env: process.env.NODE_ENV || 'development',
  services: [
    {
      name: 'express-backend',
      command: 'node',
      args: ['dist/server.js'],
      port: parseInt(process.env.PORT || '5000', 10),
      healthCheckPath: process.env.LAUNCHER_HEALTH_CHECK_PATH || '/health',
      required: true,
      timeoutMs: 10000
    }
  ]
};

