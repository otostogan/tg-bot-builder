import { Logger } from '@nestjs/common';
import type { PrismaClient as ActualPrismaClient } from '@prisma/client/extension';
import type { IBotBuilderOptions } from '../../src/app.interface';
import {
  BotRuntime,
  BotRuntimeDependencies,
  IBotRuntimeOptions,
  normalizeBotOptions,
} from '../../src/builder/bot-runtime';
import { BuilderService } from '../../src/builder/builder.service';
import {
  createMockPrisma,
  PrismaClient as MockPrismaClient,
} from '../mocks/prisma';
import { createInMemorySessionStorage } from '../mocks/session-storage';

type BotOptionOverrides = Partial<Omit<IBotBuilderOptions, 'prisma'>> & {
  prisma?: MockPrismaClient | ActualPrismaClient;
};

export interface CreateTestBotRuntimeOptions extends BotOptionOverrides {
  logger?: Logger;
  runtimeDependencies?: BotRuntimeDependencies;
}

const DEFAULT_BOT_OPTIONS: IBotBuilderOptions = {
  TG_BOT_TOKEN: 'test-token',
  id: 'test-bot',
  pages: [],
  handlers: [],
  middlewares: [],
  keyboards: [],
  services: {},
  pageMiddlewares: [],
};

const mergeBotOptions = (overrides: BotOptionOverrides): IBotBuilderOptions => ({
  ...DEFAULT_BOT_OPTIONS,
  ...overrides,
  pages: overrides.pages ?? [],
  handlers: overrides.handlers ?? [],
  middlewares: overrides.middlewares ?? [],
  keyboards: overrides.keyboards ?? [],
  services: overrides.services ?? {},
  pageMiddlewares: overrides.pageMiddlewares ?? [],
  dependencies: overrides.dependencies,
  prisma: overrides.prisma as ActualPrismaClient | undefined,
});

export const createTestBotRuntime = (
  options: CreateTestBotRuntimeOptions = {},
): { runtime: BotRuntime; options: IBotRuntimeOptions } => {
  const { logger, runtimeDependencies, ...botOverrides } = options;
  const botOptions = mergeBotOptions(botOverrides);

  if (!botOptions.sessionStorage) {
    botOptions.sessionStorage = createInMemorySessionStorage();
  }

  if (!botOptions.prisma) {
    botOptions.prisma = createMockPrisma() as unknown as ActualPrismaClient;
  }

  const normalized = normalizeBotOptions(botOptions);
  const runtime = new BotRuntime(
    normalized,
    logger ?? new Logger('TestBotRuntime'),
    runtimeDependencies,
  );

  return { runtime, options: normalized };
};

export interface CreateTestBuilderServiceOptions {
  prisma?: MockPrismaClient | ActualPrismaClient;
}

export const createTestBuilderService = (
  options: CreateTestBuilderServiceOptions = {},
): BuilderService => {
  const prisma = options.prisma ?? (createMockPrisma() as unknown as ActualPrismaClient);
  return new BuilderService(prisma);
};
