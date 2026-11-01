import http from 'http';
import { app } from './app';
import { env } from './config/env';

const server = http.createServer(app);

const startServer = (): http.Server => {
  return server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`===============================================`);
    // eslint-disable-next-line no-console
    console.log(`🚀 SDE-8 Voicebot Backend Service Started!`);
    // eslint-disable-next-line no-console
    console.log(`📡 Listening on Port: ${env.PORT}`);
    // eslint-disable-next-line no-console
    console.log(`🌍 Environment: ${env.NODE_ENV}`);
    // eslint-disable-next-line no-console
    console.log(`🔗 Health Check: http://localhost:${env.PORT}/health`);
    // eslint-disable-next-line no-console
    console.log(`📋 Session API:  http://localhost:${env.PORT}${env.API_PREFIX}/sessions`);
    // eslint-disable-next-line no-console
    console.log(`===============================================`);
  });
};

// Graceful shutdown
const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log('Server stopped cleanly.');
    process.exit(0);
  });

  // Force shutdown if taking longer than 10s
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

export { server, startServer };

