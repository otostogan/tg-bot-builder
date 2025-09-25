# tg-bot-builder

## Description

**tg-bot-builder** is a NestJS-oriented toolkit that wires [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) runtimes, conversational page flows, and optional Prisma persistence into a single module. The package exports a `BotBuilder` dynamic module along with helper services such as `BuilderService`, `BotRuntime`, and factories for session management and middleware so you can script Telegram conversations with predictable state handling and validation.

## Connection

The builder is exposed as a NestJS dynamic module. Register it in your root module by returning one or more bot definitions from `BotBuilder.forRootAsync`. Each definition must provide a Telegram token and the conversational pages you want to serve.

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BotBuilder, IBotBuilderOptions, IBotPage } from 'tg-bot-builder';
import { string } from 'yup';

const onboardingPages: IBotPage[] = [
    {
        id: 'start',
        content: 'Welcome! Tap any key to begin.',
        next: () => 'collect-name',
    },
    {
        id: 'collect-name',
        content: 'What is your name?',
        yup: string().required('Name is required'),
    },
];

@Module({
    imports: [
        ConfigModule.forRoot(),
        BotBuilder.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (
                config: ConfigService,
            ): Promise<IBotBuilderOptions[]> => [
                {
                    id: 'onboarding-bot',
                    TG_BOT_TOKEN: config.getOrThrow('TG_BOT_TOKEN'),
                    pages: onboardingPages,
                    initialPageId: 'start',
                },
            ],
        }),
    ],
})
export class AppModule {}
```

The module bootstraps `BuilderService`, which internally calls `registerBots` so that each runtime starts polling for updates immediately after Nest finishes booting.

## Connecting multiple bots

You can register multiple bots at once by returning an array of options from `forRootAsync`, or augment the configuration later through `BotBuilder.forFeature`. Every option is normalized by `normalizeBotOptions`, which makes it safe to omit the `id` as long as a slug or token is present.

```ts
@Module({
    imports: [
        BotBuilder.forRootAsync({
            useFactory: async () => [
                { TG_BOT_TOKEN: process.env.SALES_TOKEN!, slug: 'sales' },
                { TG_BOT_TOKEN: process.env.SUPPORT_TOKEN!, slug: 'support' },
            ],
        }),
        BotBuilder.forFeature({
            TG_BOT_TOKEN: process.env.INTERNAL_TOKEN!,
            slug: 'internal-tools',
            middlewares: [
                {
                    name: 'audit-log',
                    priority: 10,
                    handler: async (ctx, next) => {
                        console.log('incoming update', ctx.event);
                        await next();
                    },
                },
            ],
        }),
    ],
})
export class BotsModule {}
```

`BuilderService` keeps the registered runtimes in a map, replacing any existing instance that uses the same id or token, so you can safely redeploy updates without restarting the Nest process manually.

## Observing registered bots via `BotRegistryService`

Whenever `BuilderService` registers a bot it stores the runtime, metadata, and the low-level `TelegramBot` instance in internal maps. The `BotRegistryService` exposes these details as an injectable, read-only API so that application modules can inspect active bots, render dashboards, or orchestrate bulk messaging without touching private state.

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { BotRegistryService } from 'tg-bot-builder';

@Controller('bots')
export class BotsController {
    constructor(private readonly registry: BotRegistryService) {}

    @Get()
    listBots() {
        return this.registry.listBots();
    }

    @Get(':id/send-test')
    async triggerTest(@Param('id') id: string) {
        const bot = this.registry.getTelegramBot(id);
        if (!bot) {
            return { ok: false, reason: 'Bot not found' };
        }

        await bot.sendMessage(process.env.ADMIN_CHAT_ID!, 'Test broadcast');
        return { ok: true };
    }
}
```

The service offers helpers to:

- Retrieve lightweight metadata for every bot with `listBots()`, including ids, slugs, token previews, and aggregate statistics.
- Fetch a single bot’s metadata via `getBotMetadata(id)`.
- Access the running `TelegramBot` client through `getTelegramBot(id)` for custom messaging workflows.
- Obtain the owning `BotRuntime` using `getRuntime(id)` when you need access to session managers or persistence gateways.

All getters return clones of the stored data, keeping the underlying maps immutable. You can export the service from your module just like any Nest provider and inject it wherever runtime observability or orchestration is required.

## Connection and operation via Prisma

When a Prisma client is supplied, the runtime enables persistent chat history by way of the `PrismaPersistenceGateway`. Pass a configured `PrismaClient` and a `slug` so every bot stores its own answers and step history.

### Prisma models expected by the built-in gateway

Out of the box the gateway assumes the following Prisma schema. If you do not already have conflicting models, add these three entities to your `schema.prisma` so the runtime can store users, step state snapshots, and form submissions:

```prisma
model User {
  id           Int         @id @default(autoincrement())
  telegramId   BigInt      @unique
  chatId       String?
  username     String?
  firstName    String?
  lastName     String?
  languageCode String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  stepStates   StepState[]
  formEntries  FormEntry[]
}

model StepState {
  id          Int         @id @default(autoincrement())
  userId      Int
  chatId      String
  slug        String
  currentPage String?
  answers     Json?
  history     Json?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  formEntries FormEntry[]

  @@unique([userId, slug])
}

model FormEntry {
  id          Int       @id @default(autoincrement())
  userId      Int
  stepStateId Int
  slug        String
  pageId      String
  payload     Json
  createdAt   DateTime  @default(now())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  stepState   StepState @relation(fields: [stepStateId], references: [id], onDelete: Cascade)

  @@unique([stepStateId, pageId])
}
```

If your project already defines its own models, consider the adapter approach described below to map existing entities into the shapes required by the builder.

```ts
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
    BotBuilder,
    IBotBuilderOptions,
    IBotPage,
    IBotBuilderContext,
} from 'tg-bot-builder';
import { string } from 'yup';

const prisma = new PrismaClient();

const surveyPages: IBotPage[] = [
    {
        id: 'email',
        content: 'Enter your email address:',
        yup: string().email('Email is invalid').required(),
        onValid: async (ctx: IBotBuilderContext) => {
            await ctx.bot.sendMessage(
                ctx.chatId,
                'Thanks! We stored your email.',
            );
        },
        next: () => 'finish',
    },
    {
        id: 'finish',
        content: (ctx) => `All done, ${ctx.session?.['email'] ?? 'friend'}!`,
    },
];

@Module({
    imports: [
        BotBuilder.forRootAsync({
            useFactory: async (): Promise<IBotBuilderOptions[]> => [
                {
                    TG_BOT_TOKEN: process.env.SURVEY_TOKEN!,
                    prisma,
                    slug: 'customer-survey',
                    pages: surveyPages,
                    initialPageId: 'email',
                },
            ],
        }),
    ],
})
export class SurveyModule {}
```

The Prisma gateway will automatically upsert the Telegram user, persist each page submission through `persistStepProgress`, and expose the hydrated database state on `ctx.db`. You can read or mutate `ctx.db.user` / `ctx.db.stepState` from within page callbacks, handlers, or middlewares to build multi-step funnels backed by your relational data.

## Adapting to existing Prisma models

Projects that already ship with their own Prisma models for users and step state can keep those schemas untouched by injecting a custom `IPersistenceGateway`. The builder exposes a `dependencies.persistenceGatewayFactory` hook that lets you supply an adapter which translates between your schema and the minimal `IPrismaUser` / `IPrismaStepState` interfaces used by the runtime.

```ts
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import {
    BotBuilder,
    IBotBuilderOptions,
    IBotPage,
    IBotSessionState,
    IPersistenceGateway,
    IPrismaStepState,
    IPrismaUser,
} from 'tg-bot-builder';

const prisma = new PrismaClient();

interface ExistingUser {
    id: number;
    telegramId: bigint;
    chatId: string | null;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    languageCode: string | null;
}

interface ExistingStepState {
    id: number;
    userId: number;
    chatId: string;
    slug: string;
    currentPage: string | null;
    answers: unknown;
    history: unknown;
}

type SessionSnapshot = {
    pageId?: string;
    data?: IBotSessionState;
    user?: TelegramBot.User;
};

class ExistingModelsGateway implements IPersistenceGateway {
    public readonly prisma?: PrismaClient;

    constructor(private readonly db: PrismaClient, private readonly slug: string) {
        this.prisma = db;
    }

    public async ensureDatabaseState(
        chatId: TelegramBot.ChatId,
        session: SessionSnapshot,
        message?: TelegramBot.Message,
        currentPageId?: string,
    ): Promise<{
        user?: IPrismaUser;
        stepState?: IPrismaStepState;
    }> {
        const telegramUser = message?.from ?? session.user;
        if (!telegramUser) {
            return {};
        }

        const chatIdentifier = chatId.toString();
        const telegramId = BigInt(telegramUser.id);

        const user = await this.db.user.upsert({
            where: { telegramId },
            update: {
                chatId: chatIdentifier,
                username: telegramUser.username ?? undefined,
                firstName: telegramUser.first_name ?? undefined,
                lastName: telegramUser.last_name ?? undefined,
                languageCode: telegramUser.language_code ?? undefined,
            },
            create: {
                telegramId,
                chatId: chatIdentifier,
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                lastName: telegramUser.last_name,
                languageCode: telegramUser.language_code,
            },
        });

        const targetPageId = currentPageId ?? session.pageId;

        const stepState = await this.db.stepState.upsert({
            where: { userId_slug: { userId: user.id, slug: this.slug } },
            update: {
                chatId: chatIdentifier,
                ...(targetPageId !== undefined
                    ? { currentPage: targetPageId }
                    : {}),
            },
            create: {
                userId: user.id,
                chatId: chatIdentifier,
                slug: this.slug,
                currentPage: targetPageId ?? null,
                answers: session.data ?? {},
                history: [],
            },
        });

        return {
            user: this.mapUser(user as ExistingUser),
            stepState: this.mapState(stepState as ExistingStepState),
        };
    }

    public async persistStepProgress(
        stepState: IPrismaStepState | undefined,
        pageId: string,
        value: unknown,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState) {
            return stepState;
        }

        const previousHistory = Array.isArray(stepState.history)
            ? stepState.history
            : [];
        const previousAnswers =
            typeof stepState.answers === 'object' && stepState.answers !== null
                ? (stepState.answers as Record<string, unknown>)
                : {};

        const updated = await this.db.stepState.update({
            where: { id: stepState.id },
            data: {
                currentPage: pageId,
                answers: {
                    ...previousAnswers,
                    [pageId]: value,
                },
                history: [
                    ...previousHistory,
                    { pageId, value, committedAt: new Date().toISOString() },
                ],
            },
        });

        await this.db.formEntry.upsert({
            where: {
                stepStateId_pageId: {
                    stepStateId: updated.id,
                    pageId,
                },
            },
            update: { payload: value },
            create: {
                userId: updated.userId,
                stepStateId: updated.id,
                slug: updated.slug,
                pageId,
                payload: value,
            },
        });

        return this.mapState(updated as ExistingStepState);
    }

    public async updateStepStateCurrentPage(
        stepState: IPrismaStepState | undefined,
        pageId: string | undefined,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState || pageId === undefined) {
            return stepState;
        }

        const updated = await this.db.stepState.update({
            where: { id: stepState.id },
            data: { currentPage: pageId ?? null },
        });

        return this.mapState(updated as ExistingStepState);
    }

    public async syncSessionState(
        stepState: IPrismaStepState | undefined,
        sessionData: IBotSessionState,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState) {
            return stepState;
        }

        const updated = await this.db.stepState.update({
            where: { id: stepState.id },
            data: { answers: sessionData },
        });

        return this.mapState(updated as ExistingStepState);
    }

    private mapUser(user: ExistingUser): IPrismaUser {
        return {
            id: user.id,
            telegramId: user.telegramId,
            chatId: user.chatId,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            languageCode: user.languageCode,
        };
    }

    private mapState(state: ExistingStepState): IPrismaStepState {
        return {
            id: state.id,
            userId: state.userId,
            chatId: state.chatId,
            slug: state.slug,
            currentPage: state.currentPage,
            answers: state.answers,
            history: state.history,
        };
    }
}

const onboardingPages: IBotPage[] = [];

@Module({
    imports: [
        BotBuilder.forRootAsync({
            useFactory: async (): Promise<IBotBuilderOptions[]> => [
                {
                    TG_BOT_TOKEN: process.env.TG_TOKEN!,
                    slug: 'onboarding',
                    pages: onboardingPages,
                    dependencies: {
                        persistenceGatewayFactory: ({ prisma: client, slug }) =>
                            new ExistingModelsGateway(client ?? prisma, slug),
                    },
                },
            ],
        }),
    ],
})
export class AppModule {}
```

The factory receives the Prisma client and bot slug so the adapter can orchestrate any custom lookup or persistence logic. Because the gateway returns objects shaped like `IPrismaUser` and `IPrismaStepState`, the rest of the runtime keeps working without being aware of your domain-specific entities.

## Working without Prisma using a local store

If you do not need database persistence, provide a custom `IBotSessionStorage` implementation (or rely on the built-in in-memory fallback) to keep session data in any store you like. The session manager will normalize entries into the `IChatSessionState` shape.

```ts
import { Module } from '@nestjs/common';
import { IBotSessionStorage, BotBuilder } from 'tg-bot-builder';

const sessions = new Map<string, any>();

const memoryStorage: IBotSessionStorage = {
    async get(chatId) {
        return sessions.get(chatId.toString());
    },
    async set(chatId, state) {
        sessions.set(chatId.toString(), state);
    },
    async delete(chatId) {
        sessions.delete(chatId.toString());
    },
};

@Module({
    imports: [
        BotBuilder.forRootAsync({
            useFactory: async () => [
                {
                    TG_BOT_TOKEN: process.env.MINIMAL_TOKEN!,
                    sessionStorage: memoryStorage,
                    pages: [
                        {
                            id: 'ping',
                            content: 'Pong! We keep everything in memory.',
                        },
                    ],
                    initialPageId: 'ping',
                },
            ],
        }),
    ],
})
export class LightweightModule {}
```

Custom stores are useful for Redis, key-value services, or encrypted file persistence. Because the runtime caches sessions internally, your storage driver only needs to support simple `get`, `set`, and optional `delete` operations.

## Different page configuration options

Pages are described with the `IBotPage` interface and can combine validation, keyboards, and middleware to produce rich flows.

- **Yup validation**: set the `yup` schema and the runtime will call `PageNavigator.validatePageValue` before advancing.
- **Custom keyboards**: declare `IBotKeyboardConfig` entries and bind them via `pageMiddlewares` or `pageNavigator` helpers so that keyboards persist between steps.
- **Middlewares**: attach `IBotMiddlewareConfig` instances globally or per handler to intercept Telegram events.

```ts
import {
    IBotPage,
    IBotKeyboardConfig,
    IBotMiddlewareConfig,
    TBotKeyboardMarkup,
} from 'tg-bot-builder';
import { object, string } from 'yup';

const keyboards: IBotKeyboardConfig[] = [
    {
        id: 'start-keyboard',
        persistent: true,
        resolve: async (): Promise<TBotKeyboardMarkup> => ({
            keyboard: [[{ text: 'Continue' }]],
            resize_keyboard: true,
        }),
    },
];

const pageMiddlewares = [
    {
        name: 'attach-keyboard',
        priority: 5,
        handler: async (ctx, page) => {
            const keyboard = keyboards[0];
            if (keyboard) {
                await ctx.bot.sendMessage(ctx.chatId, 'Keyboard attached', {
                    reply_markup: await keyboard.resolve(ctx),
                });
            }
            return { allow: true };
        },
    },
];

const formPages: IBotPage[] = [
    {
        id: 'profile',
        content: 'Fill in your profile',
        yup: object({
            fullName: string().required(),
            email: string().email().required(),
        }),
        middlewares: pageMiddlewares,
    },
];

const updateLogger: IBotMiddlewareConfig = {
    name: 'update-logger',
    handler: async (ctx, next) => {
        console.log(`[${ctx.botId}]`, ctx.event);
        await next();
    },
};
```
