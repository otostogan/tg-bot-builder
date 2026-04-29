"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts_jest_1 = require("ts-jest");
const { compilerOptions } = require('./tsconfig.json');
const config = {
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
        ...(0, ts_jest_1.pathsToModuleNameMapper)(compilerOptions?.paths ?? {}, {
            prefix: '<rootDir>/',
        }),
    },
    transform: {
        '^.+\\.(t|j)s$': [
            'ts-jest',
            {
                tsconfig: '<rootDir>/tsconfig.spec.json',
                diagnostics: {
                    ignoreCodes: [2578],
                },
            },
        ],
    },
};
exports.default = config;
//# sourceMappingURL=jest.config.js.map