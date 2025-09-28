import TelegramBot = require('node-telegram-bot-api');
import { Logger } from '@nestjs/common';
import { PageNavigator } from '../../src';
import {
    IBotBuilderContext,
    IBotKeyboardConfig,
    IBotPage,
    IBotPageMiddlewareConfig,
} from '../../src';
import { NodeTelegramBotApiMock } from '../mocks/node-telegram-bot-api';

describe('PageNavigator', () => {
    const chatId = 987654321;
    let bot: NodeTelegramBotApiMock;
    let logger: Logger;

    const createContext = (): IBotBuilderContext => ({
        botId: 'test-bot',
        bot: bot as unknown as TelegramBot,
        chatId,
        services: {},
    });

    beforeEach(() => {
        bot = new NodeTelegramBotApiMock('token');
        logger = new Logger('page-navigator-test');

        jest.spyOn(logger, 'log').mockImplementation(() => undefined);
        jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn(logger, 'error').mockImplementation(() => undefined);
        jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
        jest.spyOn(logger, 'verbose').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('sends middleware rejection message and skips rendering when access is denied', async () => {
        const rejectionMessage = 'No entry allowed';
        const middleware: IBotPageMiddlewareConfig = {
            name: 'guard',
            handler: jest
                .fn()
                .mockResolvedValue({ allow: false, message: rejectionMessage }),
        };
        const page: IBotPage = {
            id: 'page-a',
            content: { text: 'Protected content' },
            middlewares: ['guard'],
        };

        const navigator = new PageNavigator({
            bot: bot as unknown as TelegramBot,
            logger,
            pageMiddlewares: [middleware],
        });

        navigator.registerPages([page]);

        await navigator.renderPage(page, createContext());

        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        expect(bot.sendMessage).toHaveBeenCalledWith(chatId, rejectionMessage);
        expect(bot.sendMessage).not.toHaveBeenCalledWith(
            chatId,
            'Protected content',
        );
    });

    it('redirects to another page when middleware denies access with redirect', async () => {
        const redirectMiddleware: IBotPageMiddlewareConfig = {
            name: 'redirect',
            handler: jest
                .fn()
                .mockResolvedValue({ allow: false, redirectTo: 'page-b' }),
        };

        const sourcePage: IBotPage = {
            id: 'page-a',
            content: { text: 'Source page content' },
            middlewares: ['redirect'],
        };

        const destinationPage: IBotPage = {
            id: 'page-b',
            content: {
                text: 'Destination page',
                options: { parse_mode: 'Markdown' },
            },
        };

        const navigator = new PageNavigator({
            bot: bot as unknown as TelegramBot,
            logger,
            pageMiddlewares: [redirectMiddleware],
        });

        navigator.registerPages([sourcePage, destinationPage]);

        await navigator.renderPage(sourcePage, createContext());

        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        expect(bot.sendMessage).toHaveBeenCalledWith(
            chatId,
            'Destination page',
            {
                parse_mode: 'Markdown',
            },
        );
    });

    it('uses page-specific keyboard instead of persistent keyboards when rendering', async () => {
        const persistentMarkup = {
            keyboard: [[{ text: 'Persistent' }]],
        } as TelegramBot.ReplyKeyboardMarkup;
        const pageMarkup = {
            inline_keyboard: [[{ text: 'Action', callback_data: 'do' }]],
        } as TelegramBot.InlineKeyboardMarkup;

        const persistentKeyboard: IBotKeyboardConfig = {
            id: 'persistent',
            persistent: true,
            resolve: jest.fn().mockResolvedValue(persistentMarkup),
        };

        const pageKeyboard: IBotKeyboardConfig = {
            id: 'page-a',
            resolve: jest.fn().mockResolvedValue(pageMarkup),
        };

        const page: IBotPage = {
            id: 'page-a',
            content: {
                text: 'Keyboard page',
                options: { parse_mode: 'HTML', disable_web_page_preview: true },
            },
        };

        const navigator = new PageNavigator({
            bot: bot as unknown as TelegramBot,
            logger,
            keyboards: [persistentKeyboard, pageKeyboard],
        });

        navigator.registerPages([page]);

        await navigator.renderPage(page, createContext());

        expect(pageKeyboard.resolve).toHaveBeenCalledTimes(1);
        expect(persistentKeyboard.resolve).not.toHaveBeenCalled();
        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        expect(bot.sendMessage).toHaveBeenCalledWith(
            chatId,
            'Keyboard page',
            expect.objectContaining({
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: pageMarkup,
            }),
        );
    });

    it('skips sending a message when a page has no content', async () => {
        const page: IBotPage = {
            id: 'silent-page',
        };

        const navigator = new PageNavigator({
            bot: bot as unknown as TelegramBot,
            logger,
        });

        navigator.registerPages([page]);

        await navigator.renderPage(page, createContext());

        expect(bot.sendMessage).not.toHaveBeenCalled();
    });
});
