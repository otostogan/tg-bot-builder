import { ValidationError } from 'yup';
import TelegramBot = require('node-telegram-bot-api');
import {
    IBotBuilderContext,
    IBotKeyboardConfig,
    IBotPage,
    IBotPageMiddlewareConfig,
    IBotPageMiddlewareResult,
    TBotKeyboardMarkup,
    TBotPageIdentifier,
    TBotPageMiddlewareHandlerResult,
    TBotPageContent,
    TBotPageContentResult,
} from '../../app.interface';
import { PublisherService } from 'otostogan-nest-logger';

const DEFAULT_PAGE_MIDDLEWARE_REJECTION_MESSAGE =
    'Access to this page is denied..';

export interface PageNavigatorOptions {
    bot: TelegramBot;
    logger: PublisherService;
    initialPageId?: TBotPageIdentifier;
    keyboards?: IBotKeyboardConfig[];
    pageMiddlewares?: IBotPageMiddlewareConfig[];
}

export interface IValidationResult {
    valid: boolean;
    errorMessage?: string;
}

export class PageNavigator {
    private readonly pages: IBotPage[] = [];
    private readonly pagesMap = new Map<TBotPageIdentifier, IBotPage>();
    private readonly keyboardsMap = new Map<string, IBotKeyboardConfig>();
    private readonly persistentKeyboards: IBotKeyboardConfig[] = [];
    private readonly pageMiddlewaresMap = new Map<
        string,
        IBotPageMiddlewareConfig
    >();
    private initialPageId?: TBotPageIdentifier;

    constructor(private readonly options: PageNavigatorOptions) {
        this.initialPageId = options.initialPageId;

        const keyboards = options.keyboards ?? [];
        for (const keyboard of keyboards) {
            if (keyboard.persistent) {
                this.persistentKeyboards.push(keyboard);
            } else {
                this.keyboardsMap.set(keyboard.id, keyboard);
            }
        }

        for (const middleware of options.pageMiddlewares ?? []) {
            if (
                middleware.name &&
                typeof middleware.name === 'string' &&
                middleware.name.length > 0
            ) {
                this.pageMiddlewaresMap.set(middleware.name, middleware);
            }
        }
    }

    public registerPages(pages: IBotPage[]): void {
        if (!Array.isArray(pages) || pages.length === 0) {
            return;
        }

        for (const page of pages) {
            if (!page || typeof page.id !== 'string' || page.id.length === 0) {
                this.options.logger.warn(
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
            this.options.logger.warn(
                `Initial page with id "${this.initialPageId}" not found among registered pages`,
            );
        }
    }

    public resolvePage(pageId: TBotPageIdentifier): IBotPage | undefined {
        return this.pagesMap.get(pageId);
    }

    public resolveInitialPage(): IBotPage | undefined {
        if (this.initialPageId) {
            const initialPage = this.pagesMap.get(this.initialPageId);
            if (initialPage) {
                return initialPage;
            }

            this.options.logger.warn(
                `Initial page with id "${this.initialPageId}" not found among registered pages`,
            );
        }

        return this.pages[0];
    }

    public setInitialPage(pageId: TBotPageIdentifier | undefined): void {
        this.initialPageId = pageId;
    }

    public extractMessageValue(message: TelegramBot.Message): unknown {
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

    public async validatePageValue(
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

    public async resolveNextPageId(
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

    public async renderPage(
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

            this.options.logger.warn(
                `Page middlewares prevented rendering of "${page.id}" for chat ${context.chatId}`,
            );

            await this.options.bot.sendMessage(context.chatId, message);
            return;
        }

        const payload = await this.resolvePageContent(page.content, context);
        const keyboard = await this.resolveKeyboard(page.id, context);

        const options: TelegramBot.SendMessageOptions = {
            ...(payload.options ?? {}),
        };

        if (keyboard) {
            options.reply_markup = keyboard;
        }

        await this.options.bot.sendMessage(context.chatId, payload.text, {
            ...options,
        });
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
                    this.options.logger.warn(
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
}

export interface PageNavigatorFactoryOptions extends PageNavigatorOptions {}

export const createPageNavigator = (
    options: PageNavigatorFactoryOptions,
): PageNavigator => new PageNavigator(options);
