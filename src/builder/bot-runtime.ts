import { ValidationError } from 'yup';
import {
    IBotBuilderContext,
    IBotBuilderOptions,
    IBotKeyboardConfig,
    IBotPageNavigationOptions,
    IBotPageMiddlewareConfig,
    IBotPage,
    IBotPageMiddlewareResult,
    IBotSessionState,
    IBotSessionStorage,
    IBotStepHistoryEntry,
    IBotStorage,
    IBotStorageState,
    IBotStorageStepState,
    IBotStorageUser,
    TBotKeyboardMarkup,
    TBotPageContent,
    TBotPageContentResult,
    TBotPageIdentifier,
    TBotPageMiddlewareHandlerResult,
    TPrismaJsonValue,
} from '../app.interface';
import { PublisherService } from 'otostogan-nest-logger';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaStorage } from '../prisma/prisma.storage';
import { MemoryStorage } from '../storage/memory.storage';
import TelegramBot = require('node-telegram-bot-api');

const DEFAULT_PAGE_MIDDLEWARE_REJECTION_MESSAGE =
    'Доступ к этой странице запрещён.';

interface IChatSessionState {
    pageId?: TBotPageIdentifier;
    data: IBotSessionState;
    user?: TelegramBot.User;
}

interface IBuilderContextOptions {
    chatId: TelegramBot.ChatId;
    session: IChatSessionState;
    message?: TelegramBot.Message;
    metadata?: TelegramBot.Metadata;
    user?: TelegramBot.User;
    database?: IContextDatabaseState;
}

type IContextDatabaseState = IBotStorageState;

type IStepHistoryEntry = IBotStepHistoryEntry;

interface IValidationResult {
    valid: boolean;
    errorMessage?: string;
}

export interface IBotRuntimeOptions extends IBotBuilderOptions {
    id: string;
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

export class BotRuntime {
    public readonly id: string;
    public readonly token: string;
    public readonly bot: TelegramBot;

    private readonly pages: IBotPage[];
    private readonly pagesMap: Map<TBotPageIdentifier, IBotPage>;
    private readonly keyboardsMap: Map<string, IBotKeyboardConfig>;
    private readonly persistentKeyboards: IBotKeyboardConfig[];
    private readonly pageMiddlewaresMap: Map<string, IBotPageMiddlewareConfig>;
    private initialPageId?: TBotPageIdentifier;
    private readonly sessionStorage: IBotSessionStorage<IChatSessionState>;
    private readonly sessionCache: Map<string, IChatSessionState> = new Map();
    private readonly prisma?: PrismaService;
    private readonly storage?: IBotStorage;
    private readonly slug: string;
    private readonly helperServices: Record<string, unknown>;

    constructor(
        options: IBotRuntimeOptions,
        private readonly logger: PublisherService,
        prismaService?: PrismaService,
    ) {
        this.id = options.id;
        this.token = options.TG_BOT_TOKEN;
        this.bot = new TelegramBot(this.token, { polling: true });

        this.pages = [];
        this.pagesMap = new Map();
        this.initialPageId = options.initialPageId;
        this.registerPages(options.pages ?? []);

        const keyboards = options.keyboards ?? [];
        this.keyboardsMap = new Map(
            keyboards
                .filter((keyboard) => !keyboard.persistent)
                .map((keyboard) => [keyboard.id, keyboard]),
        );
        this.persistentKeyboards = keyboards.filter(
            (keyboard) => keyboard.persistent,
        );

        const pageMiddlewares = options.pageMiddlewares ?? [];
        this.pageMiddlewaresMap = new Map(
            pageMiddlewares
                .filter(
                    (
                        middleware,
                    ): middleware is IBotPageMiddlewareConfig & {
                        name: string;
                    } =>
                        typeof middleware.name === 'string' &&
                        middleware.name.length > 0,
                )
                .map((middleware) => [middleware.name, middleware]),
        );

        this.prisma = options.prisma ?? prismaService;
        if (Object.prototype.hasOwnProperty.call(options, 'storage')) {
            this.storage = options.storage ?? undefined;
        } else if (this.prisma) {
            this.storage = new PrismaStorage(this.prisma);
        } else {
            this.storage = new MemoryStorage();
        }
        this.slug = options.slug ?? 'default';
        this.helperServices = options.services ?? {};

        const providedSessionStorage = options.sessionStorage as unknown as
            | IBotSessionStorage<IChatSessionState>
            | undefined;

        this.sessionStorage =
            providedSessionStorage ?? this.createDefaultSessionStorage();

        this.logger.info(`BotBuilder runtime "${this.id}" initialized`);

        this.registerHandlers();
    }

    public registerPages(pages: IBotPage[]): void {
        if (!Array.isArray(pages) || pages.length === 0) {
            return;
        }

        for (const page of pages) {
            if (!page || typeof page.id !== 'string' || page.id.length === 0) {
                this.logger.warn(
                    'Attempted to register a page without a valid identifier',
                );
                continue;
            }

            const existingIndex = this.pages.findIndex(
                (registeredPage) => registeredPage.id === page.id,
            );

            if (existingIndex >= 0) {
                this.pages[existingIndex] = page;
            } else {
                this.pages.push(page);
            }

            this.pagesMap.set(page.id, page);
        }

        if (!this.initialPageId && this.pages.length > 0) {
            this.initialPageId = this.pages[0].id;
        }

        if (this.initialPageId && !this.pagesMap.has(this.initialPageId)) {
            this.logger.warn(
                `Initial page with id "${this.initialPageId}" not found among registered pages`,
            );
        }
    }

    public async goToPage(
        chatId: TelegramBot.ChatId,
        pageId: TBotPageIdentifier,
        options?: IBotPageNavigationOptions,
    ): Promise<void> {
        const page = this.pagesMap.get(pageId);
        if (!page) {
            this.logger.warn(
                `Page with id "${pageId}" not found for chat ${chatId}`,
            );
            return;
        }

        const session = await this.getSession(chatId);

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
        await this.saveSession(chatId, session);

        const database = await this.ensureDatabaseState(
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

        await this.renderPage(page, context);
    }

    public async goToInitialPage(
        chatId: TelegramBot.ChatId,
        options?: IBotPageNavigationOptions,
    ): Promise<void> {
        const initialPage = this.resolveInitialPage();
        if (!initialPage) {
            this.logger.warn('No initial page configured');
            return;
        }

        const navigationOptions: IBotPageNavigationOptions = {
            ...options,
        };

        if (
            navigationOptions.resetState === undefined &&
            navigationOptions.state === undefined
        ) {
            navigationOptions.resetState = true;
        }

        await this.goToPage(chatId, initialPage.id, navigationOptions);
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
            const session = await this.getSession(chatId);
            if (message.from) {
                session.user = message.from;
            }
            let database = await this.ensureDatabaseState(
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
                const initialPage = this.resolveInitialPage();
                if (!initialPage) {
                    this.logger.warn('No initial page configured');
                    return;
                }

                session.pageId = initialPage.id;
                session.data = session.data ?? {};
                await this.saveSession(chatId, session);
                database = await this.ensureDatabaseState(
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
                await this.renderPage(initialPage, context);
                return;
            }

            const currentPage = this.pagesMap.get(session.pageId);
            if (!currentPage) {
                this.logger.warn(
                    `Page with id "${session.pageId}" not found for chat ${chatId}`,
                );
                await this.resetToInitialPage(chatId, session);
                return;
            }

            const value = this.extractMessageValue(message);
            const validationResult = await this.validatePageValue(
                currentPage,
                value,
                context,
            );

            if (!validationResult.valid) {
                const errorMessage =
                    validationResult.errorMessage ??
                    'Введены некорректные данные, попробуйте ещё раз.';
                await this.bot.sendMessage(chatId, errorMessage);
                await this.renderPage(
                    currentPage,
                    this.createContext({ chatId, session, database }),
                );
                return;
            }

            session.data[currentPage.id] = value;

            const updatedStepState = await this.persistStepProgress(
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

            const nextPageId = await this.resolveNextPageId(
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
                await this.saveSession(chatId, session);
                await this.updateStepStateCurrentPage(
                    database.stepState,
                    undefined,
                );
                return;
            }

            const nextPage = this.pagesMap.get(nextPageId);
            if (!nextPage) {
                this.logger.warn(
                    `Next page with id "${nextPageId}" not found for chat ${chatId}`,
                );
                session.pageId = undefined;
                await this.saveSession(chatId, session);
                await this.updateStepStateCurrentPage(
                    database.stepState,
                    undefined,
                );
                return;
            }

            session.pageId = nextPage.id;
            await this.saveSession(chatId, session);

            const nextStepState = await this.updateStepStateCurrentPage(
                database.stepState,
                nextPage.id,
            );
            if (nextStepState) {
                database.stepState = nextStepState;
            }

            await this.renderPage(
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

    private async getSession(
        chatId: TelegramBot.ChatId,
    ): Promise<IChatSessionState> {
        const key = chatId.toString();
        const cached = this.sessionCache.get(key);
        if (cached) {
            return cached;
        }

        const stored = await this.sessionStorage.get(chatId);
        const session = this.normalizeSessionState(stored) ?? {
            pageId: undefined,
            data: {},
        };

        this.sessionCache.set(key, session);
        return session;
    }

    private normalizeSessionState(
        stored?: IChatSessionState | IBotSessionState | null,
    ): IChatSessionState | undefined {
        if (!stored) {
            return undefined;
        }

        if (this.isChatSessionState(stored)) {
            stored.data = stored.data ?? {};
            return stored;
        }

        if (this.isSessionState(stored)) {
            return {
                pageId: undefined,
                data: stored,
            };
        }

        return undefined;
    }

    private isChatSessionState(value: unknown): value is IChatSessionState {
        return (
            typeof value === 'object' &&
            value !== null &&
            'data' in value &&
            !Array.isArray((value as { data?: unknown }).data)
        );
    }

    private isSessionState(value: unknown): value is IBotSessionState {
        return (
            typeof value === 'object' && value !== null && !Array.isArray(value)
        );
    }

    private async saveSession(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
    ): Promise<void> {
        const key = chatId.toString();
        this.sessionCache.set(key, session);
        await this.sessionStorage.set(chatId, session);
    }

    private async resetToInitialPage(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
    ): Promise<void> {
        const initialPage = this.resolveInitialPage();
        if (!initialPage) {
            session.pageId = undefined;
            await this.saveSession(chatId, session);
            const database = await this.ensureDatabaseState(chatId, session);
            await this.updateStepStateCurrentPage(
                database.stepState,
                undefined,
            );
            return;
        }

        session.pageId = initialPage.id;
        await this.saveSession(chatId, session);

        const database = await this.ensureDatabaseState(
            chatId,
            session,
            undefined,
            initialPage.id,
        );

        await this.renderPage(
            initialPage,
            this.createContext({ chatId, session, database }),
        );
    }

    private resolveInitialPage(): IBotPage | undefined {
        if (this.initialPageId) {
            const initialPage = this.pagesMap.get(this.initialPageId);
            if (initialPage) {
                return initialPage;
            }

            this.logger.warn(
                `Initial page with id "${this.initialPageId}" not found among registered pages`,
            );
        }

        return this.pages[0];
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
            prisma: this.prisma,
            storage: this.storage,
            db: options.database,
            services: this.helperServices,
        };
    }

    private extractMessageValue(message: TelegramBot.Message): unknown {
        if (typeof message.text === 'string') {
            return message.text;
        }

        if (typeof message.caption === 'string') {
            return message.caption;
        }

        if (message.contact) {
            return message.contact;
        }

        if (message.location) {
            return message.location;
        }

        if (message.photo) {
            return message.photo;
        }

        if (message.document) {
            return message.document;
        }

        return message;
    }

    private async validatePageValue(
        page: IBotPage,
        value: unknown,
        context: IBotBuilderContext,
    ): Promise<IValidationResult> {
        if (page.yup) {
            try {
                await page.yup.validate(value, { context });
            } catch (error) {
                if (error instanceof ValidationError) {
                    return { valid: false, errorMessage: error.message };
                }

                return {
                    valid: false,
                    errorMessage: 'Ошибка проверки данных, попробуйте ещё раз.',
                };
            }
        }

        if (page.validate) {
            try {
                const isValid = await page.validate(value, context);
                if (!isValid) {
                    return {
                        valid: false,
                        errorMessage:
                            'Введены некорректные данные, попробуйте ещё раз.',
                    };
                }
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Ошибка проверки данных, попробуйте ещё раз.';
                return { valid: false, errorMessage: message };
            }
        }

        return { valid: true };
    }

    private async resolveNextPageId(
        currentPage: IBotPage,
        context: IBotBuilderContext,
    ): Promise<TBotPageIdentifier | undefined> {
        if (currentPage.next) {
            const resolved = await currentPage.next(context);
            if (resolved) {
                return resolved;
            }
        }

        const currentIndex = this.pages.findIndex(
            (page) => page.id === currentPage.id,
        );
        if (currentIndex >= 0 && currentIndex + 1 < this.pages.length) {
            return this.pages[currentIndex + 1].id;
        }

        return undefined;
    }

    private async ensureDatabaseState(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
        message?: TelegramBot.Message,
        currentPageId?: string,
    ): Promise<IContextDatabaseState> {
        if (!this.storage) {
            return {};
        }

        const telegramUser = message?.from ?? session.user;
        if (!telegramUser) {
            return {};
        }

        const chatIdentifier = this.normalizeChatId(chatId);
        const targetPageId = currentPageId ?? session.pageId;
        const state = await this.storage.ensureState({
            chatId: chatIdentifier,
            slug: this.slug,
            currentPageId: targetPageId,
            sessionState: session.data ?? {},
            telegramUser,
        });

        return state ?? {};
    }

    private async persistStepProgress(
        stepState: IBotStorageStepState | undefined,
        pageId: string,
        value: unknown,
    ): Promise<IBotStorageStepState | undefined> {
        if (!this.storage || !stepState) {
            return stepState;
        }

        const serializedValue = this.serializeValue(value);
        const answers = this.normalizeAnswers(stepState.answers);
        answers[pageId] = serializedValue;

        const history = this.normalizeHistory(stepState.history);
        history.push({
            pageId,
            value: serializedValue,
            timestamp: new Date().toISOString(),
        });

        return await this.storage.saveStepProgress({
            stepState,
            pageId,
            value: serializedValue,
            answers,
            history,
        });
    }

    private async updateStepStateCurrentPage(
        stepState: IBotStorageStepState | undefined,
        pageId: string | undefined,
    ): Promise<IBotStorageStepState | undefined> {
        if (!this.storage || !stepState) {
            return stepState;
        }

        const targetPage = pageId ?? null;
        if (stepState.currentPage === targetPage) {
            return stepState;
        }

        return await this.storage.updateCurrentPage({
            stepState,
            pageId,
        });
    }

    private normalizeAnswers(
        answers: unknown,
    ): Record<string, TPrismaJsonValue | null> {
        if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
            return {};
        }

        return {
            ...(answers as Record<string, TPrismaJsonValue | null>),
        };
    }

    private normalizeHistory(history: unknown): IStepHistoryEntry[] {
        let source = history;

        if (typeof source === 'string') {
            try {
                source = JSON.parse(source) as unknown;
            } catch {
                return [];
            }
        }

        if (!Array.isArray(source)) {
            return [];
        }

        return source
            .map((entry) =>
                typeof entry === 'object' && entry !== null
                    ? (entry as Record<string, unknown>)
                    : undefined,
            )
            .filter((entry): entry is Record<string, unknown> => Boolean(entry))
            .map((entry) => {
                const pageIdValue = entry.pageId;
                const timestampValue = entry.timestamp;

                const pageId =
                    typeof pageIdValue === 'string'
                        ? pageIdValue
                        : String(pageIdValue ?? '');
                const timestamp =
                    typeof timestampValue === 'string'
                        ? timestampValue
                        : new Date().toISOString();

                return {
                    pageId,
                    timestamp,
                    value: this.serializeValue(entry.value),
                };
            });
    }

    private serializeValue(value: unknown): TPrismaJsonValue | null {
        if (value === undefined) {
            return null;
        }

        if (
            value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return value as TPrismaJsonValue;
        }

        if (typeof value === 'bigint') {
            return value.toString();
        }

        if (Array.isArray(value)) {
            return value.map((item) =>
                this.serializeValue(item),
            ) as TPrismaJsonValue;
        }

        if (typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>);
            const normalized: Record<string, TPrismaJsonValue | null> = {};
            for (const [key, item] of entries) {
                normalized[key] = this.serializeValue(item);
            }
            return normalized as TPrismaJsonValue;
        }

        return null;
    }

    private normalizeChatId(chatId: TelegramBot.ChatId): string {
        return typeof chatId === 'string' ? chatId : chatId.toString();
    }

    private async renderPage(
        page: IBotPage,
        context: IBotBuilderContext,
    ): Promise<void> {
        const middlewareResult = await this.executePageMiddlewares(
            page,
            context,
        );

        if (!middlewareResult.allow) {
            const message =
                middlewareResult.message ??
                DEFAULT_PAGE_MIDDLEWARE_REJECTION_MESSAGE;

            this.logger.warn(
                `Page middlewares prevented rendering of "${page.id}" for chat ${context.chatId}`,
            );

            await this.bot.sendMessage(context.chatId, message);
            return;
        }

        const payload = await this.resolvePageContent(page.content, context);
        const keyboard = await this.resolveKeyboard(page.id, context);

        const options: TelegramBot.SendMessageOptions = {
            ...(payload.options ?? {}),
        };

        if (keyboard && !options.reply_markup) {
            options.reply_markup = keyboard;
        }

        await this.bot.sendMessage(context.chatId, payload.text, options);
    }

    private async executePageMiddlewares(
        page: IBotPage,
        context: IBotBuilderContext,
    ): Promise<IBotPageMiddlewareResult> {
        const middlewares = this.resolvePageMiddlewares(page);
        if (middlewares.length === 0) {
            return { allow: true };
        }

        for (const middleware of middlewares) {
            try {
                const result = await middleware.handler(context, page);
                const normalized = this.normalizePageMiddlewareResult(result);

                if (!normalized.allow) {
                    return normalized;
                }
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : undefined;
                return { allow: false, message };
            }
        }

        return { allow: true };
    }

    private resolvePageMiddlewares(page: IBotPage): IBotPageMiddlewareConfig[] {
        if (!page.middlewares || page.middlewares.length === 0) {
            return [];
        }

        const resolved: IBotPageMiddlewareConfig[] = [];

        for (const middleware of page.middlewares) {
            if (typeof middleware === 'string') {
                const registered = this.pageMiddlewaresMap.get(middleware);
                if (!registered) {
                    this.logger.warn(
                        `Page middleware "${middleware}" not found for page "${page.id}"`,
                    );
                    continue;
                }

                resolved.push(registered);
                continue;
            }

            resolved.push(middleware);
        }

        return resolved.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }

    private normalizePageMiddlewareResult(
        result: TBotPageMiddlewareHandlerResult,
    ): IBotPageMiddlewareResult {
        if (typeof result === 'boolean') {
            return { allow: result };
        }

        if (result && typeof result === 'object' && 'allow' in result) {
            return {
                allow: Boolean(result.allow),
                message:
                    typeof result.message === 'string'
                        ? result.message
                        : undefined,
            };
        }

        return { allow: true };
    }

    private async resolvePageContent(
        content: TBotPageContent,
        context: IBotBuilderContext,
    ): Promise<{ text: string; options?: TelegramBot.SendMessageOptions }> {
        const result = await this.normalizePageContent(content, context);

        if (typeof result === 'string') {
            return { text: result };
        }

        return result;
    }

    private async normalizePageContent(
        content: TBotPageContent,
        context: IBotBuilderContext,
    ): Promise<TBotPageContentResult> {
        if (typeof content === 'function') {
            return await content(context);
        }

        return content;
    }

    private async resolveKeyboard(
        pageId: TBotPageIdentifier,
        context: IBotBuilderContext,
    ): Promise<TBotKeyboardMarkup | undefined> {
        const keyboard = this.keyboardsMap.get(pageId);
        if (keyboard) {
            const markup = await keyboard.resolve(context);
            if (markup) {
                return markup;
            }
        }

        for (const persistentKeyboard of this.persistentKeyboards) {
            const markup = await persistentKeyboard.resolve(context);
            if (markup) {
                return markup;
            }
        }

        return undefined;
    }

    private createDefaultSessionStorage(): IBotSessionStorage<IChatSessionState> {
        const store = new Map<string, IChatSessionState>();
        return {
            get: (chatId: TelegramBot.ChatId) => store.get(chatId.toString()),
            set: (chatId: TelegramBot.ChatId, state: IChatSessionState) => {
                store.set(chatId.toString(), state);
            },
            delete: (chatId: TelegramBot.ChatId) => {
                store.delete(chatId.toString());
            },
        };
    }
}
