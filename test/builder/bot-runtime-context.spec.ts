import { BotRuntime, IBotRuntimeOptions } from '../../src';
import { IContextDatabaseState, IPersistenceGateway } from '../../src';
import { IChatSessionState, SessionManager } from '../../src';
import { PageNavigator } from '../../src';
import { Logger } from '@nestjs/common';
import TelegramBot = require('node-telegram-bot-api');

describe('BotRuntime middleware context', () => {
    const createLoggerMock = (): Logger =>
        ({
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            verbose: jest.fn(),
            debug: jest.fn(),
            setContext: jest.fn(),
        }) as unknown as Logger;

    const createMessage = (
        overrides: Partial<TelegramBot.Message> = {},
    ): TelegramBot.Message =>
        ({
            message_id: overrides.message_id ?? 1,
            date: overrides.date ?? 0,
            chat: overrides.chat ?? { id: 123, type: 'private' },
            from:
                overrides.from ??
                ({
                    id: 321,
                    is_bot: false,
                    first_name: 'Tester',
                } as TelegramBot.User),
            text: overrides.text ?? 'message',
            ...overrides,
        }) as TelegramBot.Message;

    const createRuntime = (options: Partial<IBotRuntimeOptions> = {}) => {
        const pageNavigator = {
            registerPages: jest.fn(),
            resolveInitialPage: jest.fn(),
            resolvePage: jest.fn(),
            extractMessageValue: jest.fn(),
            validatePageValue: jest.fn(),
            resolveNextPageId: jest.fn(),
            renderPage: jest.fn(),
        } as unknown as jest.Mocked<PageNavigator>;

        const sessionManager = {
            getSession: jest.fn<
                Promise<IChatSessionState>,
                [TelegramBot.ChatId]
            >(),
            saveSession: jest.fn<
                Promise<void>,
                [TelegramBot.ChatId, IChatSessionState]
            >(),
        } as unknown as jest.Mocked<SessionManager>;

        const persistenceGateway = {
            ensureDatabaseState: jest.fn<
                Promise<IContextDatabaseState>,
                [
                    TelegramBot.ChatId,
                    IChatSessionState,
                    TelegramBot.Message?,
                    TelegramBot.Metadata?,
                    string?,
                ]
            >(() => Promise.resolve({})),
            persistStepProgress: jest.fn(),
            updateStepStateCurrentPage: jest.fn(),
            syncSessionState: jest.fn(),
            prisma: {},
        } as unknown as jest.Mocked<IPersistenceGateway> & {
            prisma: Record<string, unknown>;
        };

        const runtimeOptions: IBotRuntimeOptions = {
            id: options.id ?? 'bot-id',
            TG_BOT_TOKEN: options.TG_BOT_TOKEN ?? 'token',
            pages: options.pages ?? [],
            handlers: options.handlers ?? [],
            middlewares: options.middlewares ?? [],
            keyboards: options.keyboards ?? [],
            services: options.services ?? {},
            pageMiddlewares: options.pageMiddlewares ?? [],
        } as IBotRuntimeOptions;

        const dependencies = {
            pageNavigatorFactory: () => pageNavigator as unknown as PageNavigator,
            sessionManagerFactory: () =>
                sessionManager as unknown as SessionManager,
            persistenceGatewayFactory: () =>
                persistenceGateway as unknown as IPersistenceGateway,
        };

        const runtime = new BotRuntime(
            runtimeOptions,
            createLoggerMock(),
            dependencies,
        );

        return { runtime, sessionManager, persistenceGateway, createMessage };
    };

    it('builds a context when a message is passed directly', async () => {
        const { runtime, sessionManager, persistenceGateway } = createRuntime();

        const message = createMessage();
        const metadata = { type: 'text' } as unknown as TelegramBot.Metadata;
        const session = { data: { foo: 'bar' } } as IChatSessionState;
        const database: IContextDatabaseState = { stepState: undefined };

        sessionManager.getSession.mockResolvedValue(session);
        persistenceGateway.ensureDatabaseState.mockResolvedValue(database);

        const context = await (
            runtime as unknown as {
                buildMiddlewareContext: (
                    event: keyof TelegramBot.TelegramEvents,
                    args: unknown[],
                ) => Promise<unknown>;
            }
        ).buildMiddlewareContext('message', [message, metadata]);

        expect(sessionManager.getSession).toHaveBeenCalledWith(message.chat.id);
        expect(persistenceGateway.ensureDatabaseState).toHaveBeenCalledWith(
            message.chat.id,
            session,
            message,
            undefined,
        );
        expect(context).toEqual(
            expect.objectContaining({
                botId: 'bot-id',
                chatId: message.chat.id,
                message,
                metadata,
                session: session.data,
                user: message.from,
                db: database,
                event: 'message',
                args: [message, metadata],
            }),
        );
        expect(session.user).toBe(message.from);
    });

    it('finds a message nested under the "message" property', async () => {
        const { runtime, sessionManager, persistenceGateway } = createRuntime();

        const message = createMessage({ chat: { id: 999, type: 'private' } });
        const envelope = { message };
        const metadata = { type: 'text' } as unknown as TelegramBot.Metadata;
        const session = { data: {} } as IChatSessionState;
        const database: IContextDatabaseState = {};

        sessionManager.getSession.mockResolvedValue(session);
        persistenceGateway.ensureDatabaseState.mockResolvedValue(database);

        const context = await (
            runtime as unknown as {
                buildMiddlewareContext: (
                    event: keyof TelegramBot.TelegramEvents,
                    args: unknown[],
                ) => Promise<unknown>;
            }
        ).buildMiddlewareContext('message', [envelope, metadata]);

        expect(sessionManager.getSession).toHaveBeenCalledWith(message.chat.id);
        expect(context).toEqual(
            expect.objectContaining({
                chatId: message.chat.id,
                message,
                metadata,
            }),
        );
    });

    it('falls back to the user id when chat information is missing', async () => {
        const { runtime, sessionManager, persistenceGateway } = createRuntime();

        const user = {
            id: 555,
            is_bot: false,
            first_name: 'Fallback',
        } as TelegramBot.User;
        const message = createMessage({
            chat: { id: undefined as unknown as number, type: 'private' },
            from: user,
        });
        const metadata = { type: 'text' } as unknown as TelegramBot.Metadata;
        const session = { data: {} } as IChatSessionState;
        const database: IContextDatabaseState = {};

        sessionManager.getSession.mockResolvedValue(session);
        persistenceGateway.ensureDatabaseState.mockResolvedValue(database);

        const context = await (
            runtime as unknown as {
                buildMiddlewareContext: (
                    event: keyof TelegramBot.TelegramEvents,
                    args: unknown[],
                ) => Promise<unknown>;
            }
        ).buildMiddlewareContext('message', [message, metadata]);

        expect(sessionManager.getSession).toHaveBeenCalledWith(user.id);
        expect(persistenceGateway.ensureDatabaseState).toHaveBeenCalledWith(
            user.id,
            session,
            message,
            undefined,
        );
        expect(context).toEqual(
            expect.objectContaining({
                chatId: user.id,
                user,
            }),
        );
        expect(session.user).toBe(user);
    });

    it('returns an unknown chat context when chat id cannot be resolved', async () => {
        const { runtime, sessionManager, persistenceGateway } = createRuntime();

        const context = await (
            runtime as unknown as {
                buildMiddlewareContext: (
                    event: keyof TelegramBot.TelegramEvents,
                    args: unknown[],
                ) => Promise<unknown>;
            }
        ).buildMiddlewareContext('callback_query', [{}]);

        expect(sessionManager.getSession).not.toHaveBeenCalled();
        expect(persistenceGateway.ensureDatabaseState).not.toHaveBeenCalled();
        expect(context).toEqual(
            expect.objectContaining({
                chatId: 'unknown',
                session: undefined,
                db: undefined,
            }),
        );
    });

    it('ignores circular references when searching for messages', () => {
        const { runtime } = createRuntime();

        const message = createMessage();
        const cyclic: Record<string, unknown> = {};
        const wrapper: Record<string, unknown> = { message };
        cyclic.message = wrapper;
        (wrapper as { cycle?: unknown }).cycle = cyclic;

        const lookup = runtime as unknown as {
            findMessageInValue: (
                value: unknown,
                visited?: Set<unknown>,
            ) => TelegramBot.Message | undefined;
        };

        expect(lookup.findMessageInValue(cyclic)).toBe(message);
        expect(lookup.findMessageInValue(wrapper)).toBe(message);
    });

    it('applies overrides provided to buildContext', async () => {
        const { runtime, persistenceGateway } = createRuntime();

        const session = {
            data: { persisted: true },
        } as IChatSessionState;
        const database: IContextDatabaseState = {};
        const chatId = 42 as TelegramBot.ChatId;
        const originalMessage = createMessage();
        const originalMetadata = { type: 'original' } as unknown as TelegramBot.Metadata;
        const originalUser = originalMessage.from;

        persistenceGateway.ensureDatabaseState.mockResolvedValue(database);

        const prepared = await (
            runtime as unknown as {
                prepareContext: (options: {
                    chatId: TelegramBot.ChatId;
                    session: IChatSessionState;
                    message?: TelegramBot.Message;
                    metadata?: TelegramBot.Metadata;
                    user?: TelegramBot.User;
                }) => Promise<{
                    database: IContextDatabaseState;
                    buildContext: (
                        overrides?: Partial<{
                            message?: TelegramBot.Message;
                            metadata?: TelegramBot.Metadata;
                            user?: TelegramBot.User;
                        }>,
                    ) => Record<string, unknown> & {
                        message?: TelegramBot.Message;
                        metadata?: TelegramBot.Metadata;
                        user?: TelegramBot.User;
                    };
                }>;
            }
        ).prepareContext({
            chatId,
            session,
            message: originalMessage,
            metadata: originalMetadata,
            user: originalUser,
        });

        const overrideMessage = createMessage({ message_id: 999 });
        const overrideMetadata = { type: 'override' } as unknown as TelegramBot.Metadata;
        const overrideUser = {
            id: 777,
            is_bot: false,
            first_name: 'Override',
        } as TelegramBot.User;

        const context = prepared.buildContext({
            message: overrideMessage,
            metadata: overrideMetadata,
            user: overrideUser,
        });

        expect(context).toEqual(
            expect.objectContaining({
                message: overrideMessage,
                metadata: overrideMetadata,
                user: overrideUser,
            }),
        );
    });
});
