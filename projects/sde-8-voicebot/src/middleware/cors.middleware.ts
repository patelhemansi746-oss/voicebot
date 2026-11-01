import cors, { CorsOptions } from 'cors';
import { env } from '../config/env';

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (env.CORS_ORIGIN === '*' || !origin || origin === env.CORS_ORIGIN) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked request from origin: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};

export const corsMiddleware = cors(corsOptions);

