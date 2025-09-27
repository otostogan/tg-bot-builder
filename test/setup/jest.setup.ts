import 'reflect-metadata';

type NestTesting = typeof import('@nestjs/testing');

jest.mock('node-telegram-bot-api');

const ORIGINAL_ENV = { ...process.env };
const DEFAULT_TEST_ENV: NodeJS.ProcessEnv = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    TZ: 'UTC',
    TG_BOT_TOKEN: process.env.TG_BOT_TOKEN ?? 'test-token',
};

jest.mock('@nestjs/testing', (): NestTesting => {
    const actual: NestTesting = jest.requireActual('@nestjs/testing');
    const patched = actual.Test
        .createTestingModule as typeof actual.Test.createTestingModule & {
        __jestPatched?: boolean;
    };

    if (!patched.__jestPatched) {
        const originalCreateTestingModule = patched.bind(actual.Test);
        const wrappedCreateTestingModule = (
            ...args: Parameters<typeof originalCreateTestingModule>
        ) => {
            jest.useFakeTimers();
            return originalCreateTestingModule(...args);
        };

        (wrappedCreateTestingModule as typeof patched).__jestPatched = true;
        actual.Test.createTestingModule = wrappedCreateTestingModule;
    }

    return actual;
});

beforeEach(() => {
    process.env = { ...DEFAULT_TEST_ENV } as NodeJS.ProcessEnv;
    jest.clearAllMocks();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    process.env = { ...DEFAULT_TEST_ENV } as NodeJS.ProcessEnv;
});

afterAll(() => {
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
});
