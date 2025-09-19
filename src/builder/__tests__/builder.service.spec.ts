import TelegramBot = require('node-telegram-bot-api');
import { BuilderService } from '../builder.service';
import type { PublisherService } from 'otostogan-nest-logger';
import type { PrismaService } from '../../prisma/prisma.service';

jest.mock('node-telegram-bot-api', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        sendMessage: jest.fn().mockResolvedValue(undefined),
        stopPolling: jest.fn().mockResolvedValue(undefined),
    }));
});

type TelegramBotMockInstance = {
    on: jest.Mock;
    sendMessage: jest.Mock;
    stopPolling: jest.Mock;
};

describe('BuilderService multi-bot support', () => {
    let service: BuilderService;

    beforeEach(() => {
        const loggerMock = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as unknown as PublisherService;

        service = new BuilderService(
            loggerMock,
            undefined as unknown as PrismaService,
        );
    });

    it('registers multiple bots and routes interactions by identifier', async () => {
        const [firstId, secondId] = service.registerBots([
            {
                id: 'alpha',
                TG_BOT_TOKEN: 'token-1',
                pages: [
                    {
                        id: 'start',
                        content: 'Hello from alpha',
                    },
                ],
            },
            {
                id: 'beta',
                TG_BOT_TOKEN: 'token-2',
                pages: [
                    {
                        id: 'start',
                        content: 'Hello from beta',
                    },
                ],
            },
        ]);

        expect(new Set(service.getRegisteredBotIds())).toEqual(
            new Set(['alpha', 'beta']),
        );
        expect(firstId).toBe('alpha');
        expect(secondId).toBe('beta');
        expect(service.getBotIdByToken('token-1')).toBe('alpha');
        expect(service.getBotIdByToken('token-2')).toBe('beta');
        expect(service.getOptions('alpha')?.id).toBe('alpha');

        const telegramBotMock = TelegramBot as unknown as jest.Mock;
        expect(telegramBotMock).toHaveBeenCalledTimes(2);
        expect(telegramBotMock.mock.instances).toHaveLength(2);

        const alphaInstance = service.getBot(
            'alpha',
        ) as unknown as TelegramBotMockInstance;
        const betaInstance = service.getBot(
            'beta',
        ) as unknown as TelegramBotMockInstance;

        expect(alphaInstance).toBeDefined();
        expect(betaInstance).toBeDefined();
        expect(alphaInstance).not.toBe(betaInstance);

        await service.goToInitialPage('alpha', 1111);
        await service.goToInitialPage('beta', 2222);

        expect(alphaInstance.sendMessage).toHaveBeenCalledWith(
            1111,
            'Hello from alpha',
            {},
        );
        expect(betaInstance.sendMessage).toHaveBeenCalledWith(
            2222,
            'Hello from beta',
            {},
        );

        await service.goToPage('beta', 2222, 'start');

        expect(betaInstance.sendMessage).toHaveBeenCalledTimes(2);
        expect(alphaInstance.sendMessage).toHaveBeenCalledTimes(1);
    });
});
