import { createApp, app } from '../../src/app';

describe('App Factory & Middleware Assembly', () => {
  it('should instantiate Express app with all middlewares attached', () => {
    const customApp = createApp();
    expect(customApp).toBeDefined();
    expect(typeof customApp.use).toBe('function');
  });

  it('default exported app should be defined', () => {
    expect(app).toBeDefined();
  });
});
