import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { compilerOptions } = require('./tsconfig.json');

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage',
  setupFilesAfterEnv: ['<rootDir>/test/setup/jest.setup.ts'],
  passWithNoTests: true,
  moduleNameMapper: {
    '^@nestjs/(.*)$': '<rootDir>/node_modules/@nestjs/$1',
    ...pathsToModuleNameMapper(compilerOptions?.paths ?? {}, {
      prefix: '<rootDir>/',
    }),
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.spec.json',
    },
  },
};

export default config;
