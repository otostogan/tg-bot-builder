import 'reflect-metadata';

type NestTesting = typeof import('@nestjs/testing');

jest.mock('@nestjs/testing', (): NestTesting => {
  const actual: NestTesting = jest.requireActual('@nestjs/testing');
  const patched = actual.Test.createTestingModule as typeof actual.Test.createTestingModule & {
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
  jest.clearAllMocks();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
