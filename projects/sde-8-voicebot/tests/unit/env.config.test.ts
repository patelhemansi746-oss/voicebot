import { validateEnv } from '../../src/config/env';

describe('Configuration Validation (Safe Mock Defaults)', () => {
  it('should boot cleanly with safe mock defaults when no secrets are provided', () => {
    const config = validateEnv({});

    expect(config.PORT).toBe(5000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.API_PREFIX).toBe('/api/v1');
    expect(config.SESSION_TIMEOUT_MINUTES).toBe(30);
    expect(config.MOCK_MODE).toBe(true);
    expect(config.MAX_PAYLOAD_LIMIT).toBe('100kb');
  });

  it('should accept custom valid configurations', () => {
    const custom = validateEnv({
      PORT: '8080',
      NODE_ENV: 'test',
      SESSION_TIMEOUT_MINUTES: '60',
      MAX_CONCURRENT_SESSIONS: '50'
    });

    expect(custom.PORT).toBe(8080);
    expect(custom.NODE_ENV).toBe('test');
    expect(custom.SESSION_TIMEOUT_MINUTES).toBe(60);
    expect(custom.MAX_CONCURRENT_SESSIONS).toBe(50);
  });

  it('should throw validation error when invalid port is supplied', () => {
    expect(() =>
      validateEnv({
        PORT: '-10'
      })
    ).toThrow(/Invalid environment configuration/);
  });
});
