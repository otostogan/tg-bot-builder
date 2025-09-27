import type { PrismaClient as ActualPrismaClient } from '@prisma/client/extension';

export type PrismaClient = Partial<ActualPrismaClient> & {
  user: {
    upsert: jest.Mock<Promise<unknown>, [unknown]>;
  };
  stepState: {
    findUnique: jest.Mock<Promise<unknown | null>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
  formEntry: {
    upsert: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

const mergeDelegates = <T extends Record<string, jest.Mock>>(defaults: T, overrides?: Partial<T>): T => ({
  ...defaults,
  ...(overrides ?? {}),
});

export type MockPrismaClient = PrismaClient;

export const createMockPrisma = (overrides: Partial<MockPrismaClient> = {}): MockPrismaClient => {
  const prisma: MockPrismaClient = {
    ...(overrides as MockPrismaClient),
    user: mergeDelegates(
      {
        upsert: jest.fn(),
      },
      overrides.user,
    ),
    stepState: mergeDelegates(
      {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      overrides.stepState,
    ),
    formEntry: mergeDelegates(
      {
        upsert: jest.fn(),
      },
      overrides.formEntry,
    ),
  };

  return prisma;
};
