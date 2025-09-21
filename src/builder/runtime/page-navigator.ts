import * as yup from 'yup';
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
import { Logger } from '@nestjs/common';

const DEFAULT_PAGE_MIDDLEWARE_REJECTION_MESSAGE =
    'Access to this page is denied..';

export interface PageNavigatorOptions {
    bot: TelegramBot;
    logger: Logger;
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
    private readonly pageMiddlewaresCache = new Map<
        string,
        IBotPageMiddlewareConfig[]
    >();
    private initialPageId?: TBotPageIdentifier;

    /**
     * Initializes lookup tables for pages, keyboards and middlewares using the
     * provided runtime dependencies.
     */
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

    /**
     * Registers or replaces pages and refreshes cached middleware metadata for
     * faster lookup during navigation.
     */
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
            this.cachePageMiddlewares(page);
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

    /**
     * Resolves a page by identifier from the local registry, if present.
     */
    public resolvePage(pageId: TBotPageIdentifier): IBotPage | undefined {
        return this.pagesMap.get(pageId);
    }

    /**
     * Resolves the initial page either from the configured id or by falling
     * back to the first registered page.
     */
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

    /**
     * Updates which page should be treated as the entry point for new chat
     * sessions.
     */
    public setInitialPage(pageId: TBotPageIdentifier | undefined): void {
        this.initialPageId = pageId;
    }

    /**
     * Extracts a user-provided value from a Telegram message, covering common
     * message payload types such as text, contacts, and documents.
     */
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

    /**
     * Validates user input for a page using Yup schemas and optional custom
     * validators, returning a descriptive error when validation fails.
     */
    public async validatePageValue(
        page: IBotPage,
        value: unknown,
        context: IBotBuilderContext,
    ): Promise<IValidationResult> {
        if (page.yup) {
            try {
                await page.yup.validate(value, { context });
            } catch (error: any) {
                error = new yup.ValidationError(error);
                if (error instanceof yup.ValidationError) {
                    return {
                        valid: false,
                        errorMessage: error.errors.join(','),
                    };
                }

                return {
                    valid: false,
                    errorMessage: 'Data validation error, please try again.',
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
                            'Incorrect data entered, please try again.',
                    };
                }
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Data validation error, please try again.';
                return { valid: false, errorMessage: message };
            }
        }

        return { valid: true };
    }

    /**
     * Determines the id of the next page to present, favouring explicit
     * navigation logic before falling back to sequential ordering.
     */
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

    /**
     * Renders the provided page by running middleware guards, preparing
     * content and keyboards, and sending the resulting message to Telegram.
     */
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

    /**
     * Executes page-level middlewares in priority order and reports whether
     * rendering should proceed.
     */
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

    /**
     * Retrieves the cached middleware set for the given page.
     */
    private resolvePageMiddlewares(page: IBotPage): IBotPageMiddlewareConfig[] {
        return this.pageMiddlewaresCache.get(page.id) ?? [];
    }

    /**
     * Normalizes middleware references configured on a page and stores a sorted
     * list for quick access during rendering.
     */
    private cachePageMiddlewares(page: IBotPage): void {
        if (!page.middlewares || page.middlewares.length === 0) {
            this.pageMiddlewaresCache.delete(page.id);
            return;
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

        resolved.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        this.pageMiddlewaresCache.set(page.id, resolved);
    }

    /**
     * Converts middleware handler return values into a consistent format.
     */
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

    /**
     * Resolves page content to a message payload, evaluating lazy factories as
     * needed.
     */
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

    /**
     * Ensures page content handlers produce a structured message definition.
     */
    private async normalizePageContent(
        content: TBotPageContent,
        context: IBotBuilderContext,
    ): Promise<TBotPageContentResult> {
        if (typeof content === 'function') {
            return await content(context);
        }

        return content;
    }

    /**
     * Chooses the most appropriate keyboard for a page, favouring dedicated
     * keyboards but falling back to persistent ones when applicable.
     */
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

/**
 * Factory helper that instantiates the default page navigator implementation.
 */
export const createPageNavigator = (
    options: PageNavigatorFactoryOptions,
): PageNavigator => new PageNavigator(options);
