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

## Connection and operation via Prisma

When a Prisma client is supplied, the runtime enables persistent chat history by way of the `PrismaPersistenceGateway`. Pass a configured `PrismaClient` and a `slug` so every bot stores its own answers and step history.

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
