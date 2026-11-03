module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.spec.ts'],
  cacheDirectory: '<rootDir>/.jest-cache',
  verbose: true
};
