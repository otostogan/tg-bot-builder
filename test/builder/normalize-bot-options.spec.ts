import {
    normalizeBotOptions,
    DEFAULT_BOT_RUNTIME_MESSAGES,
} from '../../src';
import type {
    IBotBuilderOptions,
    IBotHandler,
    IBotKeyboardConfig,
    IBotMiddlewareConfig,
    IBotPage,
    IBotPageMiddlewareConfig,
} from '../../src/app.interface';
import type { BotRuntimeDependencies } from '../../src/builder/bot-runtime';

describe('normalizeBotOptions', () => {
    it('resolves the identifier from an explicit id', () => {
        const options: IBotBuilderOptions = {
            TG_BOT_TOKEN: 'token-value',
            id: 'explicit-id',
        };

        const normalized = normalizeBotOptions(options);

        expect(normalized.id).toBe('explicit-id');
    });

    it('falls back to the slug when an explicit id is not provided', () => {
        const options: IBotBuilderOptions = {
            TG_BOT_TOKEN: 'token-value',
            slug: 'slug-id',
        };

        const normalized = normalizeBotOptions(options);

        expect(normalized.id).toBe('slug-id');
    });

    it('falls back to the bot token when neither id nor slug are provided', () => {
        const options: IBotBuilderOptions = {
            TG_BOT_TOKEN: 'token-value',
        };

        const normalized = normalizeBotOptions(options);

        expect(normalized.id).toBe('token-value');
    });

    it('uses the provided index when other identifiers are unavailable', () => {
        const options = {
            TG_BOT_TOKEN: undefined,
        } as unknown as IBotBuilderOptions;

        const normalized = normalizeBotOptions(options, 2);

        expect(normalized.id).toBe('bot-2');
    });

    it('throws when no identifier can be resolved', () => {
        const options = {
            TG_BOT_TOKEN: undefined,
        } as unknown as IBotBuilderOptions;

        expect(() => normalizeBotOptions(options)).toThrow(
            DEFAULT_BOT_RUNTIME_MESSAGES.botIdResolutionFailed(),
        );
    });

    it('clones mutable option collections', () => {
        const pages = [{ id: 'page-1' } as unknown as IBotPage];
        const handlers = [{ event: 'message' } as unknown as IBotHandler];
        const middlewares = [
            { event: 'message', handler: jest.fn() } as unknown as IBotMiddlewareConfig,
        ];
        const keyboards = [{ id: 'keyboard-1' } as unknown as IBotKeyboardConfig];
        const services = { foo: 'bar' };
        const pageMiddlewares = [
            {
                page: 'page-1',
                middlewares: [],
            } as unknown as IBotPageMiddlewareConfig,
        ];
        const dependencies: BotRuntimeDependencies = {
            messageFactory: jest.fn(),
        };

        const options: IBotBuilderOptions = {
            TG_BOT_TOKEN: 'token-value',
            pages,
            handlers,
            middlewares,
            keyboards,
            services,
            pageMiddlewares,
            dependencies,
        };

        const normalized = normalizeBotOptions(options);

        const newPage = { id: 'page-2' } as unknown as IBotPage;
        const newHandler = { event: 'edited_message' } as unknown as IBotHandler;
        const newMiddleware = {
            event: 'edited_message',
            handler: jest.fn(),
        } as unknown as IBotMiddlewareConfig;
        const newKeyboard = { id: 'keyboard-2' } as unknown as IBotKeyboardConfig;
        const newPageMiddleware = {
            page: 'page-2',
            middlewares: [],
        } as unknown as IBotPageMiddlewareConfig;
        const replacementFactory = jest.fn();

        normalized.pages.push(newPage);
        normalized.handlers.push(newHandler);
        normalized.middlewares.push(newMiddleware);
        normalized.keyboards.push(newKeyboard);
        normalized.pageMiddlewares.push(newPageMiddleware);
        normalized.services.newService = true;
        normalized.dependencies!.messageFactory = replacementFactory;

        expect(normalized.pages).not.toBe(options.pages);
        expect(normalized.handlers).not.toBe(options.handlers);
        expect(normalized.middlewares).not.toBe(options.middlewares);
        expect(normalized.keyboards).not.toBe(options.keyboards);
        expect(normalized.pageMiddlewares).not.toBe(options.pageMiddlewares);
        expect(normalized.services).not.toBe(options.services);
        expect(normalized.dependencies).not.toBe(options.dependencies);

        expect(options.pages).toHaveLength(1);
        expect(options.handlers).toHaveLength(1);
        expect(options.middlewares).toHaveLength(1);
        expect(options.keyboards).toHaveLength(1);
        expect(options.pageMiddlewares).toHaveLength(1);
        expect(options.services).toEqual({ foo: 'bar' });
        expect(options.dependencies).toBe(dependencies);
        expect(options.dependencies!.messageFactory).toBe(dependencies.messageFactory);
    });
});
