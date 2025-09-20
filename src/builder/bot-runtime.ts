import {
    IBotBuilderContext,
    IBotBuilderOptions,
    IBotPage,
    IBotPageNavigationOptions,
    IBotSessionState,
    IBotSessionStorage,
    TBotPageIdentifier,
} from '../app.interface';
import { PublisherService } from 'otostogan-nest-logger';
import TelegramBot = require('node-telegram-bot-api');
import type { PrismaClient } from '@prisma/client/extension';
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
    PersistenceGateway,
    PersistenceGatewayFactoryOptions,
} from './runtime/persistence-gateway';
import { createPageNavigator } from './runtime/page-navigator';
import { createSessionManager } from './runtime/session-manager';
import { createPersistenceGateway } from './runtime/persistence-gateway';

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
    ) => PersistenceGateway;
}

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
        throw new Error('Bot identifier could not be resolved');
    }

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
    } as IBotRuntimeOptions;
}

interface IBuilderContextOptions {
    chatId: TelegramBot.ChatId;
    session: IChatSessionState;
    message?: TelegramBot.Message;
    metadata?: TelegramBot.Metadata;
    user?: TelegramBot.User;
    database?: IContextDatabaseState;
}

export class BotRuntime {
    public readonly id: string;
    public readonly token: string;
    public readonly bot: TelegramBot;

    private readonly logger: PublisherService;
    private readonly pageNavigator: PageNavigator;
    private readonly sessionManager: SessionManager;
    private readonly persistenceGateway: PersistenceGateway;
    private readonly helperServices: Record<string, unknown>;

    constructor(
        options: IBotRuntimeOptions,
        logger: PublisherService,
        prismaService?: PrismaClient,
        dependencies: BotRuntimeDependencies = {},
    ) {
        this.id = options.id;
        this.token = options.TG_BOT_TOKEN;
        this.bot = new TelegramBot(this.token, { polling: true });
        this.logger = logger;

        this.helperServices = options.services ?? {};

        const providedSessionStorage = options.sessionStorage as
            | IBotSessionStorage<IChatSessionState | IBotSessionState>
            | undefined;

        const sessionManagerFactory =
            dependencies.sessionManagerFactory ?? createSessionManager;
        this.sessionManager = sessionManagerFactory({
            sessionStorage: providedSessionStorage,
        });

        const prisma = options.prisma ?? prismaService;
        const persistenceGatewayFactory =
            dependencies.persistenceGatewayFactory ?? createPersistenceGateway;
        this.persistenceGateway = persistenceGatewayFactory({
            prisma,
            slug: options.slug ?? 'default',
        });

        const pageNavigatorFactory =
            dependencies.pageNavigatorFactory ?? createPageNavigator;
        this.pageNavigator = pageNavigatorFactory({
            bot: this.bot,
            logger: this.logger,
            initialPageId: options.initialPageId,
            keyboards: options.keyboards ?? [],
            pageMiddlewares: options.pageMiddlewares ?? [],
        });

        this.pageNavigator.registerPages(options.pages ?? []);

        this.logger.info(`BotBuilder runtime "${this.id}" initialized`);

        this.registerHandlers();
    }

    public registerPages(pages: IBotPage[]): void {
        this.pageNavigator.registerPages(pages);
    }

    public async goToPage(
        chatId: TelegramBot.ChatId,
        pageId: TBotPageIdentifier,
        options?: IBotPageNavigationOptions,
    ): Promise<void> {
        const page = this.pageNavigator.resolvePage(pageId);
        if (!page) {
            this.logger.warn(
                `Page with id "${pageId}" not found for chat ${chatId}`,
            );
            return;
        }

        const session = await this.sessionManager.getSession(chatId);

        if (options?.resetState) {
            session.data = {};
        }

        if (options?.state) {
            session.data = options.state;
        }

        session.data = session.data ?? {};

        if (options?.user) {
            session.user = options.user;
        } else if (options?.message?.from) {
            session.user = options.message.from;
        }

        session.pageId = page.id;
        await this.sessionManager.saveSession(chatId, session);

        const database = await this.persistenceGateway.ensureDatabaseState(
            chatId,
            session,
            options?.message,
            page.id,
        );

        const context = this.createContext({
            chatId,
            session,
            message: options?.message,
            metadata: options?.metadata,
            user: options?.user,
            database,
        });

        await this.pageNavigator.renderPage(page, context);
    }

    private registerHandlers(): void {
        this.bot.on('message', this.handleMessage);
    }

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
            let database = await this.persistenceGateway.ensureDatabaseState(
                chatId,
                session,
                message,
                session.pageId,
            );

            let context = this.createContext({
                chatId,
                session,
                message,
                metadata,
                database,
            });

            if (!session.pageId) {
                const initialPage = this.pageNavigator.resolveInitialPage();
                if (!initialPage) {
                    this.logger.warn('No initial page configured');
                    return;
                }

                session.pageId = initialPage.id;
                session.data = session.data ?? {};
                await this.sessionManager.saveSession(chatId, session);
                database = await this.persistenceGateway.ensureDatabaseState(
                    chatId,
                    session,
                    message,
                    session.pageId,
                );
                context = this.createContext({
                    chatId,
                    session,
                    message,
                    metadata,
                    database,
                });
                await this.pageNavigator.renderPage(initialPage, context);
                return;
            }

            const currentPage = this.pageNavigator.resolvePage(session.pageId);
            if (!currentPage) {
                this.logger.warn(
                    `Page with id "${session.pageId}" not found for chat ${chatId}`,
                );
                await this.resetToInitialPage(chatId, session);
                return;
            }

            const value = this.pageNavigator.extractMessageValue(message);
            const validationResult = await this.pageNavigator.validatePageValue(
                currentPage,
                value,
                context,
            );

            if (!validationResult.valid) {
                const errorMessage =
                    validationResult.errorMessage ??
                    'Введены некорректные данные, попробуйте ещё раз.';
                await this.bot.sendMessage(chatId, errorMessage);
                await this.pageNavigator.renderPage(
                    currentPage,
                    this.createContext({ chatId, session, database }),
                );
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
                await currentPage.onValid(
                    this.createContext({
                        chatId,
                        session,
                        message,
                        metadata,
                        database,
                    }),
                );
            }

            const nextPageId = await this.pageNavigator.resolveNextPageId(
                currentPage,
                this.createContext({
                    chatId,
                    session,
                    message,
                    metadata,
                    database,
                }),
            );

            if (!nextPageId) {
                session.pageId = undefined;
                await this.sessionManager.saveSession(chatId, session);
                await this.persistenceGateway.updateStepStateCurrentPage(
                    database.stepState,
                    undefined,
                );
                return;
            }

            const nextPage = this.pageNavigator.resolvePage(nextPageId);
            if (!nextPage) {
                this.logger.warn(
                    `Next page with id "${nextPageId}" not found for chat ${chatId}`,
                );
                session.pageId = undefined;
                await this.sessionManager.saveSession(chatId, session);
                await this.persistenceGateway.updateStepStateCurrentPage(
                    database.stepState,
                    undefined,
                );
                return;
            }

            session.pageId = nextPage.id;
            await this.sessionManager.saveSession(chatId, session);

            const nextStepState =
                await this.persistenceGateway.updateStepStateCurrentPage(
                    database.stepState,
                    nextPage.id,
                );
            if (nextStepState) {
                database.stepState = nextStepState;
            }

            await this.pageNavigator.renderPage(
                nextPage,
                this.createContext({ chatId, session, database }),
            );
        } catch (error) {
            const message =
                error instanceof Error
                    ? `Error during message handling: ${error.message}`
                    : 'Error during message handling';
            this.logger.error(message);
        }
    };

    private async resetToInitialPage(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
    ): Promise<void> {
        const initialPage = this.pageNavigator.resolveInitialPage();
        if (!initialPage) {
            session.pageId = undefined;
            await this.sessionManager.saveSession(chatId, session);
            const database = await this.persistenceGateway.ensureDatabaseState(
                chatId,
                session,
            );
            await this.persistenceGateway.updateStepStateCurrentPage(
                database.stepState,
                undefined,
            );
            return;
        }

        session.pageId = initialPage.id;
        await this.sessionManager.saveSession(chatId, session);

        const database = await this.persistenceGateway.ensureDatabaseState(
            chatId,
            session,
            undefined,
            initialPage.id,
        );

        await this.pageNavigator.renderPage(
            initialPage,
            this.createContext({ chatId, session, database }),
        );
    }

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
