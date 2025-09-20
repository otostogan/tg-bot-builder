import { BuilderService } from '../builder.service';
import type { IBotRuntimeOptions } from '../bot-runtime';
import type { PublisherService } from 'otostogan-nest-logger';

interface RuntimeMock {
    id: string;
    token: string;
    bot: {
        stopPolling: jest.Mock;
    };
}

const runtimeMocks: RuntimeMock[] = [];

jest.mock('../bot-runtime', () => {
    const actual = jest.requireActual('../bot-runtime');

    const BotRuntimeMock = jest
        .fn()
        .mockImplementation((options: IBotRuntimeOptions) => {
            const stopPolling = jest.fn().mockResolvedValue(undefined);
            const runtime: RuntimeMock = {
                id: options.id,
                token: options.TG_BOT_TOKEN,
                bot: {
                    stopPolling,
                },
            };
            runtimeMocks.push(runtime);
            return runtime;
        });

    return {
        ...actual,
        BotRuntime: BotRuntimeMock,
    };
});

const createOptions = (
    overrides: Pick<IBotRuntimeOptions, 'id' | 'TG_BOT_TOKEN'> &
        Partial<Omit<IBotRuntimeOptions, 'id' | 'TG_BOT_TOKEN'>>,
): IBotRuntimeOptions => ({
    id: overrides.id,
    TG_BOT_TOKEN: overrides.TG_BOT_TOKEN,
    pages: [],
    handlers: [],
    middlewares: [],
    keyboards: [],
    services: {},
    pageMiddlewares: [],
    slug: 'default',
    ...overrides,
});

describe('BuilderService', () => {
    let service: BuilderService;
    let logger: jest.Mocked<PublisherService>;

    beforeEach(() => {
        runtimeMocks.length = 0;
        const { BotRuntime } = jest.requireMock('../bot-runtime') as {
            BotRuntime: jest.Mock;
        };
        BotRuntime.mockClear();

        logger = {
            info: jest.fn(),
            warn: jest.fn(),
        } as unknown as jest.Mocked<PublisherService>;

        service = new BuilderService(logger);
    });

    it('clears token mapping when re-registering a bot', () => {
        service.registerNormalizedBot(
            createOptions({ id: 'bot-1', TG_BOT_TOKEN: 'token-1' }),
        );

        const tokenMap = (
            service as unknown as { tokenToBotId: Map<string, string> }
        ).tokenToBotId;
        expect(tokenMap.get('token-1')).toBe('bot-1');

        service.registerNormalizedBot(
            createOptions({ id: 'bot-1', TG_BOT_TOKEN: 'token-2' }),
        );

        expect(tokenMap.get('token-1')).toBeUndefined();
        expect(tokenMap.get('token-2')).toBe('bot-1');
        expect(tokenMap.size).toBe(1);
        expect(runtimeMocks).toHaveLength(2);
        expect(runtimeMocks[0].bot.stopPolling).toHaveBeenCalledTimes(1);
    });

    it('clears token mapping when stopPolling throws during replacement', () => {
        service.registerNormalizedBot(
            createOptions({ id: 'bot-2', TG_BOT_TOKEN: 'token-old' }),
        );

        (runtimeMocks[0].bot.stopPolling as jest.Mock).mockImplementation(
            () => {
                throw new Error('stop failed');
            },
        );

        service.registerNormalizedBot(
            createOptions({ id: 'bot-2', TG_BOT_TOKEN: 'token-new' }),
        );

        const tokenMap = (
            service as unknown as { tokenToBotId: Map<string, string> }
        ).tokenToBotId;

        expect(tokenMap.get('token-old')).toBeUndefined();
        expect(tokenMap.get('token-new')).toBe('bot-2');
        expect(tokenMap.size).toBe(1);
        expect(runtimeMocks[0].bot.stopPolling).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining(
                'Failed to stop polling for bot "bot-2": stop failed',
            ),
        );
    });
});
