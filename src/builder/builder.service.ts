import { Inject, Injectable } from '@nestjs/common';
import { ValidationError } from 'yup';
import { BOT_BUILDER_MODULE_OPTIONS } from '../app.constants';
import {
    IBotBuilderContext,
    IBotBuilderOptions,
    IBotKeyboardConfig,
    IBotPage,
    IBotSessionState,
    IBotSessionStorage,
    TBotKeyboardMarkup,
    TBotPageContent,
    TBotPageContentResult,
    TBotPageIdentifier,
} from '../app.interface';
import { PublisherService } from 'otostogan-nest-logger';
import TelegramBot = require('node-telegram-bot-api');

interface IChatSessionState {
    pageId?: TBotPageIdentifier;
    data: IBotSessionState;
}

interface IBuilderContextOptions {
    chatId: TelegramBot.ChatId;
    session: IChatSessionState;
    message?: TelegramBot.Message;
    metadata?: TelegramBot.Metadata;
}

interface IValidationResult {
    valid: boolean;
    errorMessage?: string;
}

@Injectable()
export class BuilderService {
    public TG_BOT_TOKEN: string;
    public TG_BOT: TelegramBot;

    private readonly pages: IBotPage[];
    private readonly pagesMap: Map<TBotPageIdentifier, IBotPage>;
    private readonly keyboardsMap: Map<string, IBotKeyboardConfig>;
    private readonly persistentKeyboards: IBotKeyboardConfig[];
    private readonly initialPageId?: TBotPageIdentifier;
    private readonly sessionStorage: IBotSessionStorage<IChatSessionState>;
    private readonly sessionCache: Map<string, IChatSessionState> = new Map();

    constructor(
        @Inject(BOT_BUILDER_MODULE_OPTIONS)
        private readonly options: IBotBuilderOptions,
        private readonly logger: PublisherService,
    ) {
        this.TG_BOT_TOKEN = options.TG_BOT_TOKEN;
        this.TG_BOT = new TelegramBot(this.TG_BOT_TOKEN, { polling: true });

        this.pages = options.pages ?? [];
        this.pagesMap = new Map(this.pages.map((page) => [page.id, page]));
        this.initialPageId = options.initialPageId ?? this.pages[0]?.id;

        const keyboards = options.keyboards ?? [];
        this.keyboardsMap = new Map(
            keyboards
                .filter((keyboard) => !keyboard.persistent)
                .map((keyboard) => [keyboard.id, keyboard]),
        );
        this.persistentKeyboards = keyboards.filter(
            (keyboard) => keyboard.persistent,
        );

        const providedSessionStorage = options.sessionStorage as unknown as
            | IBotSessionStorage<IChatSessionState>
            | undefined;

        this.sessionStorage =
            providedSessionStorage ?? this.createDefaultSessionStorage();

        this.logger.info('BotBuilder initialized');

        this.registerHandlers();
    }

    private registerHandlers(): void {
        this.TG_BOT.on('message', this.handleMessage);
    }

    private readonly handleMessage = async (
        message: TelegramBot.Message,
        metadata?: TelegramBot.Metadata,
    ): Promise<void> => {
        try {
            const chatId = message.chat.id;
            const session = await this.getSession(chatId);
            const context = this.createContext({
                chatId,
                session,
                message,
                metadata,
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
                await this.renderPage(
                    initialPage,
                    this.createContext({
                        chatId,
                        session,
                    }),
                );
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
                await this.TG_BOT.sendMessage(chatId, errorMessage);
                await this.renderPage(
                    currentPage,
                    this.createContext({ chatId, session }),
                );
                return;
            }

            session.data[currentPage.id] = value;

            if (currentPage.onValid) {
                await currentPage.onValid(context);
            }

            const nextPageId = await this.resolveNextPageId(
                currentPage,
                context,
            );

            if (!nextPageId) {
                session.pageId = undefined;
                await this.saveSession(chatId, session);
                return;
            }

            const nextPage = this.pagesMap.get(nextPageId);
            if (!nextPage) {
                this.logger.warn(
                    `Next page with id "${nextPageId}" not found for chat ${chatId}`,
                );
                session.pageId = undefined;
                await this.saveSession(chatId, session);
                return;
            }

            session.pageId = nextPage.id;
            await this.saveSession(chatId, session);

            await this.renderPage(
                nextPage,
                this.createContext({ chatId, session }),
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
            return;
        }

        session.pageId = initialPage.id;
        await this.saveSession(chatId, session);
        await this.renderPage(
            initialPage,
            this.createContext({ chatId, session }),
        );
    }

    private resolveInitialPage(): IBotPage | undefined {
        if (!this.initialPageId) {
            return undefined;
        }

        return this.pagesMap.get(this.initialPageId);
    }

    private createContext(options: IBuilderContextOptions): IBotBuilderContext {
        return {
            bot: this.TG_BOT,
            chatId: options.chatId,
            message: options.message,
            metadata: options.metadata,
            session: options.session.data,
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

    private async renderPage(
        page: IBotPage,
        context: IBotBuilderContext,
    ): Promise<void> {
        const payload = await this.resolvePageContent(page.content, context);
        const keyboard = await this.resolveKeyboard(page.id, context);

        const options: TelegramBot.SendMessageOptions = {
            ...(payload.options ?? {}),
        };

        if (keyboard && !options.reply_markup) {
            options.reply_markup = keyboard;
        }

        await this.TG_BOT.sendMessage(context.chatId, payload.text, options);
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
