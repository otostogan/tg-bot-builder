import type { IBotRuntimeOptions } from '../../src';
import { BuilderService } from '../../src';

jest.mock('../../src/builder/bot-runtime', () => {
    const actual = jest.requireActual('../../src/builder/bot-runtime');

    class TestBotRuntime {
        public static instances: MockBotRuntimeInstance[] = [];
        public readonly id: string;
        public readonly token: string;
        public readonly bot: { stopPolling: jest.Mock };
        public readonly options: IBotRuntimeOptions;

        constructor(
            options: IBotRuntimeOptions,
            _logger: unknown,
            _dependencies?: unknown,
        ) {
            this.id = options.id;
            this.token = options.TG_BOT_TOKEN;
            this.options = options;
            this.bot = { stopPolling: jest.fn() };

            TestBotRuntime.instances.push(this);
        }
    }

    return {
        __esModule: true,
        ...actual,
        BotRuntime: TestBotRuntime,
    };
});

jest.mock('./bot-runtime', () =>
    jest.requireMock('../../src/builder/bot-runtime'),
);

const runtimeModule = jest.requireMock('../../src/builder/bot-runtime') as {
    BotRuntime: { instances: MockBotRuntimeInstance[] };
};

type MockBotRuntimeInstance = {
    id: string;
    token: string;
    bot: { stopPolling: jest.Mock };
    options: IBotRuntimeOptions;
};

describe('BuilderService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        runtimeModule.BotRuntime.instances = [];
    });

    const createRuntimeOptions = (
        overrides: Partial<IBotRuntimeOptions> = {},
    ): IBotRuntimeOptions => ({
        id: 'bot-id',
        TG_BOT_TOKEN: 'token-id',
        pages: [],
        handlers: [],
        middlewares: [],
        keyboards: [],
        services: {},
        pageMiddlewares: [],
        ...overrides,
    });

    it('replaces an existing runtime when registering with the same id', () => {
        const service = new BuilderService();

        service.registerNormalizedBot(
            createRuntimeOptions({
                id: 'shared-id',
                TG_BOT_TOKEN: 'first-token',
            }),
        );

        service.registerNormalizedBot(
            createRuntimeOptions({
                id: 'shared-id',
                TG_BOT_TOKEN: 'second-token',
            }),
        );

        const [firstRuntime, secondRuntime] = runtimeModule.BotRuntime.instances;

        expect(firstRuntime.bot.stopPolling).toHaveBeenCalledTimes(1);
        expect(service.getBotRuntime('shared-id')).toBe(secondRuntime);
        expect(service['tokenToBotId'].get('second-token')).toBe('shared-id');
        expect(service['tokenToBotId'].has('first-token')).toBe(false);
    });

    it('detaches a previously registered bot when a new bot reuses its token', () => {
        const service = new BuilderService();

        service.registerNormalizedBot(
            createRuntimeOptions({
                id: 'first-bot',
                TG_BOT_TOKEN: 'shared-token',
            }),
        );

        service.registerNormalizedBot(
            createRuntimeOptions({
                id: 'second-bot',
                TG_BOT_TOKEN: 'shared-token',
            }),
        );

        const [firstRuntime, secondRuntime] = runtimeModule.BotRuntime.instances;

        expect(firstRuntime.bot.stopPolling).toHaveBeenCalledTimes(1);
        expect(service.getBotRuntime('first-bot')).toBeUndefined();
        expect(service.getBotRuntime('second-bot')).toBe(secondRuntime);
        expect(service['tokenToBotId'].get('shared-token')).toBe('second-bot');
    });

    it('returns defensive copies for registered bot options', () => {
        const service = new BuilderService();

        const dependencyFactory = jest.fn();

        service.registerNormalizedBot(
            createRuntimeOptions({
                id: 'copy-bot',
                TG_BOT_TOKEN: 'copy-token',
                pages: ['page-a'] as unknown as IBotRuntimeOptions['pages'],
                handlers: [{ name: 'handler' } as never],
                middlewares: [{ name: 'mw' } as never],
                keyboards: [{ id: 'kb' } as never],
                services: { feature: 'enabled' },
                pageMiddlewares: [{ name: 'pmw' } as never],
                dependencies: { pageNavigatorFactory: dependencyFactory },
            }),
        );

        const optionsSnapshot = service.getBotOptions('copy-bot');
        expect(optionsSnapshot).toBeDefined();

        if (!optionsSnapshot) {
            throw new Error('Expected bot options to be defined');
        }

        optionsSnapshot.pages.push('mutated' as never);
        optionsSnapshot.handlers[0] = { name: 'mutated-handler' } as never;
        optionsSnapshot.middlewares.push({ name: 'mutated-mw' } as never);
        optionsSnapshot.keyboards[0] = { id: 'mutated-kb' } as never;
        optionsSnapshot.services.feature = 'mutated';
        optionsSnapshot.pageMiddlewares[0] = { name: 'mutated-pmw' } as never;
        optionsSnapshot.dependencies!.pageNavigatorFactory = jest.fn();

        const freshSnapshot = service.getBotOptions('copy-bot');

        expect(freshSnapshot).toBeDefined();
        expect(freshSnapshot?.pages).toEqual(['page-a']);
        expect(freshSnapshot?.handlers).toEqual([{ name: 'handler' }]);
        expect(freshSnapshot?.middlewares).toEqual([{ name: 'mw' }]);
        expect(freshSnapshot?.keyboards).toEqual([{ id: 'kb' }]);
        expect(freshSnapshot?.services).toEqual({ feature: 'enabled' });
        expect(freshSnapshot?.pageMiddlewares).toEqual([{ name: 'pmw' }]);
        expect(freshSnapshot?.dependencies?.pageNavigatorFactory).toBe(
            dependencyFactory,
        );

        const registeredBots = service.listRegisteredBots();
        registeredBots[0].pages.push('list-mutated' as never);
        registeredBots[0].handlers[0] = { name: 'list-mutated-handler' } as never;
        registeredBots[0].middlewares.push({ name: 'list-mutated-mw' } as never);
        registeredBots[0].keyboards[0] = { id: 'list-mutated-kb' } as never;
        registeredBots[0].services.feature = 'list-mutated';
        registeredBots[0].pageMiddlewares[0] = { name: 'list-mutated-pmw' } as never;
        registeredBots[0].dependencies!.pageNavigatorFactory = jest.fn();

        const afterListMutation = service.getBotOptions('copy-bot');

        expect(afterListMutation).toBeDefined();
        expect(afterListMutation?.pages).toEqual(['page-a']);
        expect(afterListMutation?.handlers).toEqual([{ name: 'handler' }]);
        expect(afterListMutation?.middlewares).toEqual([{ name: 'mw' }]);
        expect(afterListMutation?.keyboards).toEqual([{ id: 'kb' }]);
        expect(afterListMutation?.services).toEqual({ feature: 'enabled' });
        expect(afterListMutation?.pageMiddlewares).toEqual([{ name: 'pmw' }]);
        expect(afterListMutation?.dependencies?.pageNavigatorFactory).toBe(
            dependencyFactory,
        );
    });

    it('keeps token mapping when the token belongs to a different bot', () => {
        const service = new BuilderService();

        service.registerNormalizedBot(
            createRuntimeOptions({
                id: 'token-bot',
                TG_BOT_TOKEN: 'token-a',
            }),
        );

        (service as unknown as {
            clearTokenMapping(token?: string, botId?: string): void;
        }).clearTokenMapping('token-a', 'other-bot');

        expect(service['tokenToBotId'].get('token-a')).toBe('token-bot');
    });

    it('removes the token mapping when the associated bot is cleared', () => {
        const service = new BuilderService();

        service.registerNormalizedBot(
            createRuntimeOptions({
                id: 'token-bot',
                TG_BOT_TOKEN: 'token-a',
            }),
        );

        (service as unknown as {
            clearTokenMapping(token?: string, botId?: string): void;
        }).clearTokenMapping('token-a', 'token-bot');

        expect(service['tokenToBotId'].has('token-a')).toBe(false);
    });
});
