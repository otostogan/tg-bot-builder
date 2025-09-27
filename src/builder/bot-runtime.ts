import {
    IBotBuilderContext,
    IBotBuilderOptions,
    IBotPage,
    IBotHandler,
    IBotMiddlewareConfig,
    IBotMiddlewareContext,
    IBotSessionState,
    IBotSessionStorage,
    IBotRuntimeMessages,
    IPrismaStepState,
    TBotPageIdentifier,
} from '../app.interface';
import TelegramBot = require('node-telegram-bot-api');
import {
    BotRuntimeMessageFactory,
    DEFAULT_BOT_RUNTIME_MESSAGES,
    createBotRuntimeMessages,
} from './builder.messages';
import {
    PageNavigator,
    PageNavigatorFactoryOptions,
} from './runtime/page-navigator';
import {
    IChatSessionState,
    SessionManager,
    SessionManagerFactoryOptions,
} from './runtime/session-manager';
import {
    IContextDatabaseState,
    IPersistenceGateway,
    PersistenceGatewayFactoryOptions,
} from './runtime/persistence-gateway';
import { createPageNavigator } from './runtime/page-navigator';
import { createSessionManager } from './runtime/session-manager';
import { createPersistenceGateway } from './runtime/persistence-gateway';
import {
    buildMiddlewarePipeline,
    mergeMiddlewareConfigs,
    sortMiddlewareConfigs,
} from './runtime/middleware-pipeline';
import { Logger } from '@nestjs/common';
import { normalizeAnswers } from './utils/serialization';
import { isDeepStrictEqual } from 'util';

type ContextFactoryOverrides = Partial<
    Pick<IBuilderContextOptions, 'message' | 'metadata' | 'user'>
>;

type ContextFactory = (
    overrides?: ContextFactoryOverrides,
) => IBotBuilderContext;

export interface IBotRuntimeOptions extends IBotBuilderOptions {
    id: string;
}
export interface BotRuntimeDependencies {
    pageNavigatorFactory?: (
        options: PageNavigatorFactoryOptions,
    ) => PageNavigator;
    sessionManagerFactory?: (
        options: SessionManagerFactoryOptions,
    ) => SessionManager;
    persistenceGatewayFactory?: (
        options: PersistenceGatewayFactoryOptions,
    ) => IPersistenceGateway;
    /**
     * Optional factory for building runtime messages. Use this to inject localisation-aware
     * message builders while preserving defaults via {@link createBotRuntimeMessages}.
     */
    messageFactory?: BotRuntimeMessageFactory;
}
export interface IBuilderContextOptions {
    chatId: TelegramBot.ChatId;
    session: IChatSessionState;
    message?: TelegramBot.Message;
    metadata?: TelegramBot.Metadata;
    user?: TelegramBot.User;
    database?: IContextDatabaseState;
}

/**
 * Derives runtime-ready bot options by cloning array inputs, resolving a
 * fallback identifier, and ensuring defaults for optional properties.
 */
export function normalizeBotOptions(
    options: IBotBuilderOptions,
    index?: number,
): IBotRuntimeOptions {
    const pages = [...(options.pages ?? [])];
    const handlers = [...(options.handlers ?? [])];
    const middlewares = [...(options.middlewares ?? [])];
    const keyboards = [...(options.keyboards ?? [])];
    const services = { ...(options.services ?? {}) };
    const pageMiddlewares = [...(options.pageMiddlewares ?? [])];
    const slug = options.slug ?? 'default';

    const fallbackId =
        options.id ??
        (typeof options.slug === 'string' && options.slug.length > 0
            ? options.slug
            : undefined) ??
        options.TG_BOT_TOKEN ??
        (index !== undefined ? `bot-${index}` : undefined);

    if (!fallbackId) {
        throw new Error(DEFAULT_BOT_RUNTIME_MESSAGES.botIdResolutionFailed());
    }

    const dependencies =
        options.dependencies !== undefined
            ? { ...options.dependencies }
            : undefined;

    return {
        ...options,
        id: fallbackId,
        pages,
        handlers,
        middlewares,
        keyboards,
        services,
        pageMiddlewares,
        slug,
        dependencies,
    } as IBotRuntimeOptions;
}

export class BotRuntime {
    public readonly id: string;
    public readonly token: string;
    public readonly bot: TelegramBot;

    private readonly logger: Logger;
    private readonly pageNavigator: PageNavigator;
    private readonly sessionManager: SessionManager;
    private readonly persistenceGateway: IPersistenceGateway;
    private readonly helperServices: Record<string, unknown>;
    private readonly globalMiddlewares: IBotMiddlewareConfig[];
    private readonly messages: IBotRuntimeMessages;

    /**
     * Boots the Telegram runtime by wiring helpers, persistence, middleware,
     * and handlers around the provided bot configuration.
     */
    constructor(
        options: IBotRuntimeOptions,
        logger: Logger,
        dependencies: BotRuntimeDependencies = {},
    ) {
        this.id = options.id;
        this.token = options.TG_BOT_TOKEN;
        this.bot = new TelegramBot(this.token, { polling: true });
        this.logger = logger;

        const resolvedDependencies = {
            ...dependencies,
            ...(options.dependencies ?? {}),
        };

        const messageFactory =
            resolvedDependencies.messageFactory ?? createBotRuntimeMessages;

        this.messages = messageFactory(options.messages);

        this.helperServices = options.services ?? {};
        this.globalMiddlewares = sortMiddlewareConfigs(
            options.middlewares ?? [],
        );

        const providedSessionStorage = options.sessionStorage as
            | IBotSessionStorage<IChatSessionState | IBotSessionState>
            | undefined;

        const sessionManagerFactory =
            resolvedDependencies.sessionManagerFactory ?? createSessionManager;

        this.sessionManager = sessionManagerFactory({
            sessionStorage: providedSessionStorage,
        });

        const prisma = options.prisma;

        const persistenceGatewayFactory =
            resolvedDependencies.persistenceGatewayFactory ??
            createPersistenceGateway;

        this.persistenceGateway = persistenceGatewayFactory({
            prisma,
            slug: options.slug ?? 'default',
        });

        const pageNavigatorFactory =
            resolvedDependencies.pageNavigatorFactory ?? createPageNavigator;

        this.pageNavigator = pageNavigatorFactory({
            bot: this.bot,
            logger: this.logger,
            initialPageId: options.initialPageId,
            keyboards: options.keyboards ?? [],
            pageMiddlewares: options.pageMiddlewares ?? [],
        });

        this.pageNavigator.registerPages(options.pages ?? []);

        this.logger.log(this.messages.runtimeInitialized({ id: this.id }));

        this.registerHandlers(options.handlers ?? []);
    }

    /**
     * Attaches middleware-wrapped listeners for each configured handler and
     * subscribes to base message events.
     */
    private registerHandlers(handlers: IBotHandler[] = []): void {
        this.bot.on('message', this.handleMessage);

        if (!Array.isArray(handlers) || handlers.length === 0) {
            return;
        }

        for (const handler of handlers) {
            if (!handler || typeof handler.event !== 'string') {
                this.logger.warn(this.messages.invalidHandler());
                continue;
            }

            if (typeof handler.listener !== 'function') {
                this.logger.warn(
                    this.messages.handlerMissingListener({
                        event: String(handler.event),
                    }),
                );
                continue;
            }

            const handlerMiddlewares = sortMiddlewareConfigs(
                handler.middlewares ?? [],
            );
            const combinedMiddlewares = mergeMiddlewareConfigs(
                this.globalMiddlewares,
                handlerMiddlewares,
            );

            const pipeline = buildMiddlewarePipeline<
                Parameters<typeof handler.listener>
            >({
                event: handler.event,
                middlewares: combinedMiddlewares,
                handler: async (
                    ...args: Parameters<typeof handler.listener>
                ) => {
                    // @ts-expect-error - TS2345: Argument of type 'unknown[]' is not assignable to parameter of type 'Parameters<typeof handler.listener>'.
                    await Promise.resolve(handler.listener(...args));
                },
                contextFactory: (event, args) =>
                    this.buildMiddlewareContext(event, args as unknown[]),
                onError: (error) =>
                    this.logMiddlewareError(handler.event, error),
            });

            this.bot.on(
                handler.event,
                pipeline as TelegramBot.TelegramEvents[typeof handler.event],
            );
        }
    }

    /**
     * Core message entry point that retrieves the chat session, validates the
     * current page, persists progress, and advances the conversation flow.
     */
    private readonly handleMessage = async (
        message: TelegramBot.Message,
        metadata?: TelegramBot.Metadata,
    ): Promise<void> => {
        try {
            const chatId = message.chat.id;
            const session = await this.sessionManager.getSession(chatId);
            if (message.from) {
                session.user = message.from;
            }

            session.data = session.data ?? {};

            const { database, buildContext } = await this.prepareContext({
                chatId,
                session,
                message,
                metadata,
                user: session.user,
            });

            if (!session.pageId) {
                await this.startFromInitialPage({
                    chatId,
                    session,
                    message,
                    metadata,
                });
                return;
            }

            const currentPage = this.pageNavigator.resolvePage(session.pageId);
            if (!currentPage) {
                this.logger.warn(
                    this.messages.pageNotFound({
                        pageId: session.pageId,
                        chatId,
                    }),
                );
                await this.resetToInitialPage(chatId, session);
                return;
            }

            const context = buildContext();

            const value = this.pageNavigator.extractMessageValue(message);
            const validationResult = await this.pageNavigator.validatePageValue(
                currentPage,
                value,
                context,
            );

            if (!validationResult.valid) {
                await this.processValidationFailure({
                    chatId,
                    page: currentPage,
                    errorMessage: validationResult.errorMessage,
                    buildContext,
                });
                return;
            }

            session.data[currentPage.id] = value;

            const updatedStepState =
                await this.persistenceGateway.persistStepProgress(
                    database.stepState,
                    currentPage.id,
                    value,
                );
            if (updatedStepState) {
                database.stepState = updatedStepState;
            }

            if (currentPage.onValid) {
                await currentPage.onValid(buildContext());
            }

            const synchronizedStepState =
                await this.persistenceGateway.syncSessionState(
                    database.stepState,
                    session.data,
                );
            if (synchronizedStepState) {
                database.stepState = synchronizedStepState;
            }

            const nextPageId = await this.pageNavigator.resolveNextPageId(
                currentPage,
                buildContext(),
            );

            await this.advanceToNextPage({
                chatId,
                session,
                nextPageId,
                database,
                buildContext,
            });
        } catch (error) {
            this.logger.error(this.messages.messageHandlingError({ error }));
        }
    };

    /**
     * Builds a middleware context tailored to the incoming Telegram event,
     * loading session information when a chat id can be inferred.
     */
    private async buildMiddlewareContext(
        event: keyof TelegramBot.TelegramEvents,
        args: unknown[],
    ): Promise<IBotMiddlewareContext> {
        const message = this.extractMessageFromArgs(args);
        const metadata = this.extractMetadataFromArgs(args, message);
        const user = this.resolveUserFromArgs(args, message);
        const chatId = this.resolveChatIdFromArgs(args, message, user);

        if (chatId !== undefined) {
            const session = await this.sessionManager.getSession(chatId);
            if (user) {
                session.user = user;
            }

            const { database, buildContext } = await this.prepareContext({
                chatId,
                session,
                message,
                metadata,
                user,
            });

            const context = buildContext({ message, metadata, user });

            return {
                ...context,
                db: database,
                event,
                args,
            };
        }

        return {
            botId: this.id,
            bot: this.bot,
            chatId: 'unknown' as TelegramBot.ChatId,
            message,
            metadata,
            session: undefined,
            user,
            prisma: this.persistenceGateway.prisma,
            db: undefined,
            services: this.helperServices,
            event,
            args,
        };
    }

    /**
     * Emits a structured log entry when a middleware pipeline throws an
     * exception for a particular Telegram event.
     */
    private logMiddlewareError(
        event: keyof TelegramBot.TelegramEvents,
        error: unknown,
    ): void {
        this.logger.error(this.messages.middlewareError({ event, error }));
    }

    /**
     * Attempts to locate a Telegram message object within middleware handler
     * arguments, following nested structures when necessary.
     */
    private extractMessageFromArgs(
        args: unknown[],
    ): TelegramBot.Message | undefined {
        for (const arg of args) {
            const message = this.findMessageInValue(arg);
            if (message) {
                return message;
            }
        }

        return undefined;
    }

    /**
     * Recursively scans an arbitrary value for an embedded Telegram message,
     * guarding against circular references via a visited set.
     */
    private findMessageInValue(
        value: unknown,
        visited = new Set<unknown>(),
    ): TelegramBot.Message | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        if (visited.has(value)) {
            return undefined;
        }
        visited.add(value);

        const record = value as Record<string, unknown>;

        if ('message_id' in record && 'chat' in record) {
            return value as TelegramBot.Message;
        }

        if ('message' in record) {
            return this.findMessageInValue(record.message, visited);
        }

        return undefined;
    }

    /**
     * Retrieves Telegram metadata from handler arguments when available,
     * skipping entries that merely repeat the message instance.
     */
    private extractMetadataFromArgs(
        args: unknown[],
        message?: TelegramBot.Message,
    ): TelegramBot.Metadata | undefined {
        if (args.length < 2) {
            return undefined;
        }

        const candidate = args[1];
        if (
            !candidate ||
            typeof candidate !== 'object' ||
            candidate === message
        ) {
            return undefined;
        }

        return candidate as TelegramBot.Metadata;
    }

    /**
     * Determines the chat identifier tied to the event using message details,
     * argument inspection, or a fallback to the associated user id.
     */
    private resolveChatIdFromArgs(
        args: unknown[],
        message?: TelegramBot.Message,
        user?: TelegramBot.User,
    ): TelegramBot.ChatId | undefined {
        if (message?.chat?.id !== undefined) {
            return message.chat.id;
        }

        for (const arg of args) {
            const chatId = this.extractChatIdFromValue(arg);
            if (chatId !== undefined) {
                return chatId;
            }
        }

        if (user?.id !== undefined) {
            return user.id;
        }

        return undefined;
    }

    /**
     * Searches an arbitrary object for nested chat identifiers commonly
     * present on Telegram payloads.
     */
    private extractChatIdFromValue(
        value: unknown,
    ): TelegramBot.ChatId | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        const record = value as Record<string, unknown>;

        if ('chat' in record) {
            const chat = record.chat as { id?: TelegramBot.ChatId } | undefined;
            if (chat && chat.id !== undefined) {
                return chat.id;
            }
        }

        if ('message' in record) {
            const nested = this.extractChatIdFromValue(record.message);
            if (nested !== undefined) {
                return nested;
            }
        }

        if ('from' in record) {
            const from = record.from as { id?: TelegramBot.ChatId } | undefined;
            if (from && from.id !== undefined) {
                return from.id;
            }
        }

        return undefined;
    }

    /**
     * Resolves the Telegram user participating in the event, inspecting
     * message and handler arguments.
     */
    private resolveUserFromArgs(
        args: unknown[],
        message?: TelegramBot.Message,
    ): TelegramBot.User | undefined {
        if (message?.from) {
            return message.from;
        }

        for (const arg of args) {
            const user = this.extractUserFromValue(arg);
            if (user) {
                return user;
            }
        }

        return undefined;
    }

    /**
     * Traverses a value to locate a nested Telegram user object.
     */
    private extractUserFromValue(value: unknown): TelegramBot.User | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }

        const record = value as Record<string, unknown>;

        if ('from' in record) {
            const from = record.from as TelegramBot.User | undefined;
            if (from) {
                return from;
            }
        }

        if ('message' in record) {
            return this.extractUserFromValue(record.message);
        }

        return undefined;
    }

    /**
     * Initializes the conversation by moving the chat session to the initial
     * page and rendering it for the user.
     */
    private async startFromInitialPage(options: {
        chatId: TelegramBot.ChatId;
        session: IChatSessionState;
        message: TelegramBot.Message;
        metadata?: TelegramBot.Metadata;
    }): Promise<void> {
        const initialPage = this.pageNavigator.resolveInitialPage();
        if (!initialPage) {
            this.logger.warn(this.messages.noInitialPage());
            return;
        }

        options.session.data = options.session.data ?? {};

        const { database, buildContext } = await this.prepareContext({
            chatId: options.chatId,
            session: options.session,
            message: options.message,
            metadata: options.metadata,
        });

        let targetPage: IBotPage | undefined;
        if (options.session.pageId) {
            targetPage = this.pageNavigator.resolvePage(options.session.pageId);
        }

        if (!targetPage) {
            options.session.pageId = initialPage.id;
            await this.sessionManager.saveSession(
                options.chatId,
                options.session,
            );

            const nextStepState =
                await this.persistenceGateway.updateStepStateCurrentPage(
                    database.stepState,
                    initialPage.id,
                );
            if (nextStepState) {
                database.stepState = nextStepState;
            }

            targetPage = initialPage;
        }

        await this.pageNavigator.renderPage(targetPage, buildContext());
    }

    /**
     * Ensures persistence state exists for the chat and returns a factory for
     * building fresh handler contexts.
     */
    private async prepareContext(options: {
        chatId: TelegramBot.ChatId;
        session: IChatSessionState;
        message?: TelegramBot.Message;
        metadata?: TelegramBot.Metadata;
        user?: TelegramBot.User;
        pageId?: TBotPageIdentifier;
    }): Promise<{
        database: IContextDatabaseState;
        buildContext: ContextFactory;
    }> {
        const database = await this.persistenceGateway.ensureDatabaseState(
            options.chatId,
            options.session,
            options.message,
            options.pageId ?? options.session.pageId,
        );

        await this.hydrateSessionFromStepState({
            chatId: options.chatId,
            session: options.session,
            stepState: database.stepState,
        });

        const buildContext = this.createContextBuilder({
            chatId: options.chatId,
            session: options.session,
            database,
            message: options.message,
            metadata: options.metadata,
            user: options.user,
        });

        return { database, buildContext };
    }

    /**
     * Produces a helper that assembles builder contexts, supporting overrides
     * for message-related properties when middlewares mutate them.
     */
    private createContextBuilder(options: {
        chatId: TelegramBot.ChatId;
        session: IChatSessionState;
        database?: IContextDatabaseState;
        message?: TelegramBot.Message;
        metadata?: TelegramBot.Metadata;
        user?: TelegramBot.User;
    }): ContextFactory {
        return (overrides = {}) => {
            const hasMessageOverride = Object.prototype.hasOwnProperty.call(
                overrides,
                'message',
            );
            const hasMetadataOverride = Object.prototype.hasOwnProperty.call(
                overrides,
                'metadata',
            );
            const hasUserOverride = Object.prototype.hasOwnProperty.call(
                overrides,
                'user',
            );

            return this.createContext({
                chatId: options.chatId,
                session: options.session,
                database: options.database,
                message: hasMessageOverride
                    ? overrides.message
                    : options.message,
                metadata: hasMetadataOverride
                    ? overrides.metadata
                    : options.metadata,
                user: hasUserOverride ? overrides.user : options.user,
            });
        };
    }

    /**
     * Rehydrates the in-memory session from Prisma so chats always resume from
     * the latest persisted step after process restarts or cache evictions.
     */
    private async hydrateSessionFromStepState(options: {
        chatId: TelegramBot.ChatId;
        session: IChatSessionState;
        stepState?: IPrismaStepState;
    }): Promise<void> {
        if (!options.stepState) {
            return;
        }

        const persistedPageId = this.normalizePersistedPageId(
            options.stepState.currentPage,
        );
        const persistedAnswers = normalizeAnswers(
            options.stepState.answers,
            null,
        );
        const existingSessionData = options.session.data ?? {};
        const mergedSessionData = {
            ...existingSessionData,
            ...persistedAnswers,
        } as IBotSessionState;

        let sessionChanged = false;

        if (options.session.pageId !== persistedPageId) {
            options.session.pageId = persistedPageId;
            sessionChanged = true;
        }

        if (!isDeepStrictEqual(existingSessionData, mergedSessionData)) {
            options.session.data = mergedSessionData;
            sessionChanged = true;
        } else if (!options.session.data) {
            options.session.data = mergedSessionData;
        }

        if (sessionChanged) {
            await this.sessionManager.saveSession(
                options.chatId,
                options.session,
            );
        }
    }

    /**
     * Normalizes persisted page identifiers, discarding null or blank values.
     */
    private normalizePersistedPageId(
        pageId: string | null | undefined,
    ): string | undefined {
        if (typeof pageId !== 'string') {
            return undefined;
        }

        const trimmed = pageId.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    /**
     * Notifies the user about validation errors and re-renders the current
     * page to allow correcting input.
     */
    private async processValidationFailure(options: {
        chatId: TelegramBot.ChatId;
        page: IBotPage;
        errorMessage?: string;
        buildContext: ContextFactory;
    }): Promise<void> {
        const errorMessage =
            options.errorMessage ?? this.messages.validationFailed();

        await this.bot.sendMessage(options.chatId, errorMessage);
        await this.pageNavigator.renderPage(
            options.page,
            options.buildContext({ message: undefined, metadata: undefined }),
        );
    }

    /**
     * Moves the session forward to the computed next page, persisting the new
     * position and rendering the next form step when available.
     */
    private async advanceToNextPage(options: {
        chatId: TelegramBot.ChatId;
        session: IChatSessionState;
        nextPageId?: TBotPageIdentifier;
        database: IContextDatabaseState;
        buildContext: ContextFactory;
    }): Promise<void> {
        if (!options.nextPageId) {
            options.session.pageId = undefined;
            await this.sessionManager.saveSession(
                options.chatId,
                options.session,
            );
            await this.persistenceGateway.updateStepStateCurrentPage(
                options.database.stepState,
                undefined,
            );
            return;
        }

        const nextPage = this.pageNavigator.resolvePage(options.nextPageId);
        if (!nextPage) {
            this.logger.warn(
                this.messages.nextPageNotFound({
                    pageId: options.nextPageId,
                    chatId: options.chatId,
                }),
            );
            options.session.pageId = undefined;
            await this.sessionManager.saveSession(
                options.chatId,
                options.session,
            );
            await this.persistenceGateway.updateStepStateCurrentPage(
                options.database.stepState,
                undefined,
            );
            return;
        }

        options.session.pageId = nextPage.id;
        await this.sessionManager.saveSession(options.chatId, options.session);

        const nextStepState =
            await this.persistenceGateway.updateStepStateCurrentPage(
                options.database.stepState,
                nextPage.id,
            );
        if (nextStepState) {
            options.database.stepState = nextStepState;
        }

        await this.pageNavigator.renderPage(
            nextPage,
            options.buildContext({ message: undefined, metadata: undefined }),
        );
    }

    /**
     * Clears progress when the session references an invalid page and returns
     * the user to the start of the flow if possible.
     */
    private async resetToInitialPage(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
    ): Promise<void> {
        const initialPage = this.pageNavigator.resolveInitialPage();
        if (!initialPage) {
            session.pageId = undefined;
            await this.sessionManager.saveSession(chatId, session);
            const { database } = await this.prepareContext({
                chatId,
                session,
            });
            await this.persistenceGateway.updateStepStateCurrentPage(
                database.stepState,
                undefined,
            );
            return;
        }

        session.pageId = initialPage.id;
        await this.sessionManager.saveSession(chatId, session);

        const { buildContext } = await this.prepareContext({
            chatId,
            session,
            pageId: initialPage.id,
        });

        await this.pageNavigator.renderPage(initialPage, buildContext());
    }

    /**
     * Materializes a full builder context object used by handlers and
     * middlewares.
     */
    private createContext(options: IBuilderContextOptions): IBotBuilderContext {
        const user =
            options.user ?? options.message?.from ?? options.session.user;

        return {
            botId: this.id,
            bot: this.bot,
            chatId: options.chatId,
            message: options.message,
            metadata: options.metadata,
            session: options.session.data,
            user,
            prisma: this.persistenceGateway.prisma,
            db: options.database,
            services: this.helperServices,
        };
    }
}
