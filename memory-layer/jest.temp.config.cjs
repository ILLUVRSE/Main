module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: null,
  testRegex: '(/test/.*|(\\.|/)(test|spec))\\.tsx?$',
  moduleFileExtensions: ['ts','tsx','js','jsx','json','node'],
  globals: { 'ts-jest': { tsconfig: 'tsconfig.json' } }
};
