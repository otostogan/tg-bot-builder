# tg-bot-builder

## 1. About the library

### Purpose

`tg-bot-builder` is a NestJS module that wraps `node-telegram-bot-api` with a declarative step-by-step builder for Telegram bots. It lets you describe a dialogue as a list of pages (steps) with validators, handlers, and middlewares while keeping user answers in sync with the session storage and a database.

### Problems it solves

- **Repeatable infrastructure.** The library eliminates the need to bootstrap the client, polling, session storage, and per-message context manually. All of that is orchestrated by a `BotRuntime` instance created by the `BuilderService`.
- **Complex validations and transitions.** Instead of handling every incoming message yourself, you can describe steps with Yup schemas or custom validation functions. Navigation logic is encapsulated in `next` handlers.
- **Built-in persistence.** The provided `PrismaPersistenceGateway` synchronizes users, step states, answer history, and `FormEntry` rows, so you do not have to write infrastructural code to save progress.
- **Extensibility.** Every component (Prisma provider, session manager, message factory, persistence gateway) can be replaced without rewriting your flows. This is handy for localization, custom databases, or distributed storage.

### Key principles

1. **Pages as steps.** Scenarios are described with `IBotPage[]`. Each page manages its content, validation, and navigation.
2. **Runtime wrapper around Telegram Bot API.** `BotRuntime` registers event handlers, builds context, and executes the middleware pipeline. It extracts user input, validates it, invokes `onValid`, determines the next page, and renders content through the `PageNavigator`.
3. **State and persistence.** `SessionManager` keeps chat sessions in memory (or in a custom `IBotSessionStorage`), while an `IPersistenceGateway` syncs the state to a database. If Prisma is not connected, the runtime falls back to `NoopPersistenceGateway` and works fully in memory.
4. **Overridable dependencies.** You can replace any runtime dependency through the `dependencies` field while preserving the contracts and default messages.

## 2. Page lifecycle

A page implements `IBotPage` and supports the fields `id`, `content`, `validate`, `onValid`, `next`, `middlewares`, and `yup`.

```ts
const pages: IBotPage[] = [
    {
        id: 'phone',
        content: 'Send your phone number',
        yup: yup.string().required(),
        onValid: async (ctx) => ctx.bot.sendMessage(ctx.chatId, 'Thank you!'),
        next: () => 'summary',
    },
];
```

### Processing order for an incoming message

1. **Load the session.** `SessionManager.getSession` reads the chat state. The user from the message is merged into the session.
2. **Prepare context.** `BotRuntime.prepareContext` calls `IPersistenceGateway.ensureDatabaseState` to ensure that a user and `StepState` exist in the database. The context contains `bot`, `chatId`, `session`, `db`, `services`, and the current `message`/`metadata`.
3. **Resolve the current page.** If no page is assigned, the runtime calls `PageNavigator.resolveInitialPage` and renders the initial step.
4. **Extract a value.** `PageNavigator.extractMessageValue` converts the message into a value (text, caption, contact, document, etc.).
5. **Validate.** The runtime first applies the page's Yup schema. If provided, `page.validate` is executed next and returns `{ valid, message }`. On failure the runtime sends the `validationFailed` message and stays on the same page.
6. **Persist answers.** After successful validation the value is stored in `session.data[page.id]`. `IPersistenceGateway.persistStepProgress` records the answer, history, and `FormEntry`, and `syncSessionState` updates the snapshot in the database.
7. **Run `onValid`.** When defined, `page.onValid` receives the current context.
8. **Determine the next page.** `PageNavigator.resolveNextPageId` attempts to call `page.next`. If it returns nothing, the runtime falls back to sequential order.
9. **Advance.** `BotRuntime.advanceToNextPage` updates `session.pageId` and `StepState.currentPage`, calls `PageNavigator.renderPage` for the next step, and persists the session.
10. **Execute page middlewares.** Before rendering, `PageNavigator.renderPage` runs `middlewares` (global middleware ids or inline definitions). A middleware can deny access, return a custom message, or redirect to another page.

This lifecycle provides a predictable, testable conversation flow with full control over state transitions.

## 3. Installation and setup

1. Install the package and its peer dependency:

    ```bash
    npm install tg-bot-builder node-telegram-bot-api
    ```

2. Import the module in your `AppModule` and register a bot configuration:

```ts
import { Module } from '@nestjs/common';
import { BotBuilder, IBotBuilderOptions } from 'tg-bot-builder';
import { PrismaService } from './prisma.service';

@Module({
    imports: [
        BotBuilder.forRootAsync({
            imports: [],
            inject: [PrismaService],
            useFactory: async (
                prisma: PrismaService,
            ): Promise<IBotBuilderOptions[]> => [
                {
                    TG_BOT_TOKEN: process.env.TG_TOKEN!,
                    slug: 'onboarding',
                    prisma,
                    initialPageId: 'welcome',
                    pages: [
                        {
                            id: 'welcome',
                            content: 'Hello! What is your name?',
                            yup: yup.string().required(),
                            next: () => 'done',
                        },
                        {
                            id: 'done',
                            content: (ctx) =>
                                `Thank you, ${ctx.session?.welcome}!`,
                        },
                    ],
                    // Disable reactions to group chats if the bot should only work in direct messages
                    respondToGroupMessages: false,
                },
            ],
        }),
    ],
})
export class AppModule {}
```

`BotBuilder` creates the `BotRuntime`, starts polling, attaches Prisma, and registers your pages automatically.

## 4. Registering multiple bots

You can register multiple bots by returning an array of configurations:

```ts
BotBuilder.forRootAsync({
  useFactory: async (prisma: PrismaService) => [
    {
      TG_BOT_TOKEN: process.env.SUPPORT_TOKEN!,
      slug: 'support',
      prisma,
      pages: [...],
    },
    {
      TG_BOT_TOKEN: process.env.SALES_TOKEN!,
      slug: 'sales',
      prisma,
      initialPageId: 'hello',
      pages: [...],
    },
  ],
  inject: [PrismaService],
});
```

To extend scenarios from a feature module, use `BotBuilder.forFeature`:

```ts
@Module({
  imports: [
    BotBuilder.forFeature({
      TG_BOT_TOKEN: process.env.SURVEY_TOKEN!,
      slug: 'survey',
      pages: [...],
    }),
  ],
})
export class SurveyModule {}
```

Each call to `registerBots` returns identifiers you can store in a registry.

## 5. `BotRegistryService` example

`BotRegistryService` exposes metadata, runtime access, and the underlying Telegram client:

```ts
import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { BotRegistryService } from 'tg-bot-builder';

@Controller('bots')
export class BotsController {
    constructor(private readonly registry: BotRegistryService) {}

    @Get()
    list() {
        return this.registry.listBots();
    }

    @Post(':id/broadcast')
    async broadcast(@Param('id') id: string, @Body('message') message: string) {
        const bot = this.registry.getTelegramBot(id);
        if (!bot) {
            throw new Error('Bot not found');
        }
        await bot.sendMessage(process.env.ADMIN_CHAT_ID!, message);
    }
}
```

Metadata includes a token preview, page count, and the presence of persistence or custom session storage—handy for admin panels.

## 6. Tracking outgoing messages

`tg-bot-builder` lets you observe every message the runtime sends through the
Telegram Bot API. Register observers with the `messageObservers` option to log
replies, persist them to a database, or trigger custom side effects.

```ts
import { BotBuilder } from 'tg-bot-builder';

@Module({
    imports: [
        BotBuilder.forRootAsync({
            inject: [PrismaService],
            useFactory: async (
                prisma: PrismaService,
            ): Promise<IBotBuilderOptions[]> => [
                {
                    TG_BOT_TOKEN: process.env.SUPPORT_TOKEN!,
                    slug: 'support',
                    prisma,
                    pages,
                    messageObservers: [async ({ context, payload, message }) => {
                        await prisma.supportChatRoomMessage.create({
                            data: {
                                roomId: context.session?.roomId,
                                type: 'text',
                                text: payload.text,
                                messageId: message.message_id,
                                sender: 'BOT',
                            },
                        });
                    }],
                },
            ],
        }),
    ],
})
export class SupportModule {}
```

Each observer receives the builder `context`, the original send `payload`
(`text` and `SendMessageOptions`), and the resulting Telegram `message`. The
runtime calls observers for messages sent from:

- Page rendering (`content`, `validationFailed`, redirects, etc.).
- Global and page middlewares that respond with text.
- Manual replies issued via `ctx.bot.sendMessage(...)` inside handlers.

Observers run sequentially; exceptions are logged but do not stop the runtime.

## 7. Prisma integration example

Supply a Prisma service whose schema contains the following structure:

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

```ts
@Module({
  imports: [
    BotBuilder.forRootAsync({
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => [
        {
          TG_BOT_TOKEN: process.env.TG_TOKEN!,
          slug: 'default',
          prisma,
          pages: [...],
        },
      ],
    }),
  ],
})
export class AppModule {}
```

Model names can be different as long as the relationships follow the same shape.

## 8. `persistenceGatewayFactory`

`BotRuntime` lets you replace the persistence layer through `dependencies.persistenceGatewayFactory`. Use it when you need custom model names, a different ORM, or additional business logic.

```ts
import { BotRuntimeDependencies, PersistenceGatewayFactoryOptions } from 'tg-bot-builder';
import { PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';

class PrismaGateway implements IPersistenceGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly slug: string,
  ) {}

  async ensureDatabaseState(
    chatId: TelegramBot.ChatId,
    session: IChatSessionState,
    message?: TelegramBot.Message,
    currentPageId?: string,
  ) {
    /* implementation shown below */
  }

  // persistStepProgress, syncSessionState, updateStepStateCurrentPage ...
}

const dependencies: BotRuntimeDependencies = {
  persistenceGatewayFactory: ({ prisma, slug }: PersistenceGatewayFactoryOptions) => {
    if (!prisma) {
      throw new Error('Prisma instance is required');
    }
    return new PrismaGateway(prisma, slug);
  },
};

const options: IBotBuilderOptions = {
  TG_BOT_TOKEN: process.env.TG_TOKEN!,
  slug: 'custom',
  prisma: prismaService, // forward Prisma to the gateway
  dependencies,
  pages: [...],
};
```

Below is a complete `PrismaGateway` implementation you can copy and adapt. Model names such as `botUser`, `stepState`, and `formEntry` are placeholders—rename them to match your schema.

```ts
import { Prisma, PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import {
    IBotSessionState,
    IChatSessionState,
    IContextDatabaseState,
    IPersistenceGateway,
    IPrismaStepState,
    IPrismaUser,
    normalizeAnswers,
    normalizeChatId,
    normalizeHistory,
    normalizeTelegramId,
    serializeValue,
} from 'tg-bot-builder';
import { isDeepStrictEqual } from 'util';

export class PrismaGateway implements IPersistenceGateway {
    prisma: PrismaClient;
    constructor(
        private readonly db: PrismaClient,
        private readonly slug: string,
    ) {
        this.prisma = db;
    }

    public async ensureDatabaseState(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
        message?: TelegramBot.Message,
        currentPageId?: string,
    ): Promise<IContextDatabaseState> {
        const telegramUser = message?.from ?? session.user;
        if (!telegramUser) {
            return {};
        }

        const telegramId = normalizeTelegramId(telegramUser.id);
        const chatIdentifier = normalizeChatId(chatId);

        const user = (await this.db.botUser.upsert({
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
        })) as unknown as IPrismaUser;

        const targetPageId = currentPageId ?? session.pageId;

        let stepState = (await this.db.stepState.findUnique({
            where: {
                userId_slug: {
                    userId: user.id,
                    slug: this.slug,
                },
            },
        })) as unknown as IPrismaStepState | null;

        if (!stepState) {
            stepState = (await this.db.stepState.create({
                data: {
                    userId: user.id,
                    chatId: chatIdentifier,
                    slug: this.slug,
                    currentPage: targetPageId ?? null,
                    answers: serializeValue(
                        session.data ?? {},
                        Prisma.JsonNull,
                    ),
                    history: serializeValue([], Prisma.JsonNull),
                },
            })) as unknown as IPrismaStepState;
        } else {
            const updates: Record<string, unknown> = {};

            if (stepState.chatId !== chatIdentifier) {
                updates.chatId = chatIdentifier;
            }

            if (
                targetPageId !== undefined &&
                stepState.currentPage !== targetPageId
            ) {
                updates.currentPage = targetPageId;
            }

            if (Object.keys(updates).length > 0) {
                stepState = (await this.db.stepState.update({
                    where: { id: stepState.id },
                    data: updates,
                })) as unknown as IPrismaStepState;
            }
        }

        return {
            user,
            stepState,
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

        const serializedValue = serializeValue(value, Prisma.JsonNull);
        const answers = normalizeAnswers(stepState.answers, Prisma.JsonNull);
        answers[pageId] = serializedValue;

        const history = normalizeHistory(stepState.history, Prisma.JsonNull);
        history.push({
            pageId,
            value: serializedValue,
            timestamp: new Date().toISOString(),
        });

        const updatedStepState = (await this.db.stepState.update({
            where: { id: stepState.id },
            data: {
                answers: serializeValue(answers, Prisma.JsonNull),
                history: serializeValue(history, Prisma.JsonNull),
            },
        })) as unknown as IPrismaStepState;

        await this.db.formEntry.upsert({
            where: {
                stepStateId_pageId: {
                    stepStateId: updatedStepState.id,
                    pageId,
                },
            },
            update: {
                payload: serializedValue,
            },
            create: {
                userId: updatedStepState.userId,
                stepStateId: updatedStepState.id,
                slug: updatedStepState.slug,
                pageId,
                payload: serializedValue,
            },
        });

        return updatedStepState;
    }

    public async syncSessionState(
        stepState: IPrismaStepState | undefined,
        sessionData: IBotSessionState,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState) {
            return stepState;
        }

        const serializedSession = serializeValue(
            sessionData ?? {},
            Prisma.JsonNull,
        );
        const normalizedSession = normalizeAnswers(
            serializedSession ?? {},
            null,
        );
        const normalizedExisting = normalizeAnswers(
            stepState.answers,
            Prisma.JsonNull,
        );

        if (isDeepStrictEqual(normalizedExisting, normalizedSession)) {
            return stepState;
        }

        return (await this.db.stepState.update({
            where: { id: stepState.id },
            data: {
                answers: serializedSession ?? {},
            },
        })) as unknown as IPrismaStepState;
    }

    public async updateStepStateCurrentPage(
        stepState: IPrismaStepState | undefined,
        pageId: string | undefined,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState) {
            return stepState;
        }

        const targetPage = pageId ?? null;
        if (stepState.currentPage === targetPage) {
            return stepState;
        }

        return (await this.db.stepState.update({
            where: { id: stepState.id },
            data: {
                currentPage: targetPage,
            },
        })) as unknown as IPrismaStepState;
    }
}
```

## 9. Working without Prisma

When a bot configuration omits the `prisma` option, `createPersistenceGateway` returns a `NoopPersistenceGateway`. In this mode:

- No database is touched; state lives entirely in memory via the `SessionManager` map-based storage.
- `persistStepProgress`, `syncSessionState`, and `updateStepStateCurrentPage` are no-ops that return the existing state.
- You can still plug in an external session store (e.g., Redis) by passing a custom `sessionStorage` implementation.

This setup is useful for prototypes, tests, or when you manage persistence outside of Prisma.

## 10. `createBotRuntimeMessages`

Runtime messages (logs and user prompts) can be localized with `createBotRuntimeMessages` or by providing `dependencies.messageFactory`.

```ts
import { createBotRuntimeMessages } from 'tg-bot-builder';

const messages = createBotRuntimeMessages({
  runtimeInitialized: ({ id }) => `Bot ${id} is running`,
  validationFailed: () => 'Please check your input.',
});

const options: IBotBuilderOptions = {
  TG_BOT_TOKEN: process.env.TG_TOKEN!,
  slug: 'localized',
  messages,
  pages: [...],
};
```

To override the factory itself, use dependencies:

```ts
const dependencies: BotRuntimeDependencies = {
    messageFactory: (overrides) =>
        createBotRuntimeMessages({
            ...overrides,
            middlewareError: ({ event }) =>
                `Middleware error for event ${event}`,
        }),
};
```

This approach enables centralized multilingual support or integration with an existing localization service.

## 11. Testing and coverage

Jest is configured with `ts-jest` so that TypeScript sources and NestJS testing utilities work out of the box. The test harness
loads `reflect-metadata`, mocks timer utilities from `@nestjs/testing`, and clears mocks between runs. To execute tests or collect
coverage locally and in CI/CD, use the following commands:

```bash
npm test           # single test run
npm run test:watch # watch mode for local development
npm run test:cov   # run the suite with coverage reporting
```

Coverage artifacts are emitted to the `coverage` directory, making it easy to upload reports from CI pipelines.

---

Following these steps you can build predictable, extensible, and reliable Telegram bot flows on top of NestJS.
