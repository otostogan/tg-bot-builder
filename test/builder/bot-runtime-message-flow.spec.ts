import { BotRuntime, IBotRuntimeOptions } from '../../src/builder/bot-runtime';
import { IBotPage, IPrismaStepState } from '../../src/app.interface';
import { Logger } from '@nestjs/common';
import TelegramBot = require('node-telegram-bot-api');
import {
    IChatSessionState,
    SessionManager,
} from '../../src/builder/runtime/session-manager';
import { PageNavigator } from '../../src/builder/runtime/page-navigator';
import { IPersistenceGateway } from '../../src/builder/runtime/persistence-gateway';

describe('BotRuntime message flow', () => {
    const createLoggerMock = (): Logger =>
        ({
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            verbose: jest.fn(),
            debug: jest.fn(),
            setContext: jest.fn(),
        } as unknown as Logger);

    const createMessage = (
        overrides: Partial<TelegramBot.Message> = {},
    ): TelegramBot.Message => ({
        message_id: 1,
        date: 0,
        chat: { id: 123, type: 'private' },
        from: { id: 321, is_bot: false, first_name: 'Tester' },
        text: 'input',
        ...overrides,
    }) as TelegramBot.Message;

    const createStepState = (
        overrides: Partial<IPrismaStepState> = {},
    ): IPrismaStepState => ({
        id: overrides.id ?? 1,
        userId: overrides.userId ?? 1,
        chatId: overrides.chatId ?? 'chat-id',
        slug: overrides.slug ?? 'slug',
        currentPage: Object.prototype.hasOwnProperty.call(overrides, 'currentPage')
            ? (overrides.currentPage as IPrismaStepState['currentPage'])
            : 'start',
        answers: overrides.answers ?? {},
        history: overrides.history ?? [],
    });

    const createRuntime = (options: Partial<IBotRuntimeOptions> = {}) => {
        const initialPage: IBotPage = { id: 'start', content: 'Start page' };

        const pageNavigator = {
            registerPages: jest.fn(),
            resolveInitialPage: jest.fn(() => initialPage),
            resolvePage: jest.fn(() => initialPage),
            extractMessageValue: jest.fn(),
            validatePageValue: jest.fn(),
            resolveNextPageId: jest.fn(),
            renderPage: jest.fn(),
        } as unknown as jest.Mocked<PageNavigator>;

        const sessionManager = {
            getSession: jest.fn<Promise<IChatSessionState>, [TelegramBot.ChatId]>(),
            saveSession: jest.fn<Promise<void>, [TelegramBot.ChatId, IChatSessionState]>(),
        } as unknown as jest.Mocked<SessionManager>;

        const persistenceGateway = {
            ensureDatabaseState: jest.fn<
                Promise<{ stepState?: IPrismaStepState }>,
                [
                    TelegramBot.ChatId,
                    IChatSessionState,
                    TelegramBot.Message?,
                    TelegramBot.Metadata?,
                    string?
                ]
            >(() => Promise.resolve({})),
            persistStepProgress: jest.fn<
                Promise<IPrismaStepState | undefined>,
                [IPrismaStepState | undefined, string, unknown]
            >(() => Promise.resolve(undefined)),
            updateStepStateCurrentPage: jest.fn<
                Promise<IPrismaStepState | undefined>,
                [IPrismaStepState | undefined, string | undefined]
            >(() => Promise.resolve(undefined)),
            syncSessionState: jest.fn<
                Promise<IPrismaStepState | undefined>,
                [IPrismaStepState | undefined, Record<string, unknown>]
            >(() => Promise.resolve(undefined)),
            prisma: {},
        } as unknown as jest.Mocked<IPersistenceGateway> & { prisma: Record<string, unknown> };

        const runtimeOptions: IBotRuntimeOptions = {
            id: 'bot-id',
            TG_BOT_TOKEN: 'token',
            pages: [initialPage],
            handlers: [],
            middlewares: [],
            keyboards: [],
            pageMiddlewares: [],
            services: {},
            ...options,
        } as IBotRuntimeOptions;

        const dependencies = {
            pageNavigatorFactory: () => pageNavigator as unknown as PageNavigator,
            sessionManagerFactory: () => sessionManager as unknown as SessionManager,
            persistenceGatewayFactory: () =>
                persistenceGateway as unknown as IPersistenceGateway,
        };

        const runtime = new BotRuntime(runtimeOptions, createLoggerMock(), dependencies);

        return {
            runtime,
            initialPage,
            pageNavigator,
            sessionManager,
            persistenceGateway,
            createStepState,
        };
    };

    it('starts from the initial page when the session has no pageId', async () => {
        const { runtime, initialPage, pageNavigator, sessionManager, persistenceGateway, createStepState } =
            createRuntime();

        const chatId = 777 as TelegramBot.ChatId;
        const session = { pageId: undefined, data: {} } as IChatSessionState;
        const stepState = createStepState({ currentPage: null });

        sessionManager.getSession.mockResolvedValue(session);
        persistenceGateway.ensureDatabaseState.mockResolvedValue({
            stepState,
        });

        const message = createMessage({ chat: { id: chatId, type: 'private' } });

        await (runtime as unknown as { handleMessage: Function }).handleMessage(message);

        expect(sessionManager.saveSession).toHaveBeenCalledWith(
            chatId,
            expect.objectContaining({
                pageId: initialPage.id,
                data: {},
            }),
        );
        expect(
            persistenceGateway.updateStepStateCurrentPage,
        ).toHaveBeenCalledWith(stepState, initialPage.id);
        expect(pageNavigator.renderPage).toHaveBeenCalledWith(
            initialPage,
            expect.objectContaining({ chatId }),
        );
    });

    it('re-renders the same page with an error message when validation fails', async () => {
        const { runtime, initialPage, pageNavigator, sessionManager, persistenceGateway } =
            createRuntime();

        const chatId = 111 as TelegramBot.ChatId;
        const session = { pageId: initialPage.id, data: {} } as IChatSessionState;

        sessionManager.getSession.mockResolvedValue(session);
        persistenceGateway.ensureDatabaseState.mockResolvedValue({});
        pageNavigator.resolvePage.mockReturnValue(initialPage);
        pageNavigator.extractMessageValue.mockReturnValue('bad value');
        pageNavigator.validatePageValue.mockResolvedValue({
            valid: false,
            errorMessage: 'Invalid input',
        });

        const message = createMessage({
            chat: { id: chatId, type: 'private' },
            text: 'bad value',
        });

        await (runtime as unknown as { handleMessage: Function }).handleMessage(message);

        expect(runtime.bot.sendMessage).toHaveBeenCalledWith(chatId, 'Invalid input');
        expect(pageNavigator.renderPage).toHaveBeenCalledTimes(1);
        expect(pageNavigator.renderPage).toHaveBeenCalledWith(
            initialPage,
            expect.objectContaining({ chatId }),
        );
        expect(persistenceGateway.persistStepProgress).not.toHaveBeenCalled();
        expect(pageNavigator.resolveNextPageId).not.toHaveBeenCalled();
        expect(session.pageId).toBe(initialPage.id);
    });

    it('clears progress and skips rendering when no next page is resolved', async () => {
        const { runtime, initialPage, pageNavigator, sessionManager, persistenceGateway, createStepState } =
            createRuntime();

        const chatId = 222 as TelegramBot.ChatId;
        const session = { pageId: initialPage.id, data: {} } as IChatSessionState;
        const originalStepState = createStepState({ currentPage: initialPage.id });
        const updatedStepState = createStepState({ currentPage: initialPage.id, answers: {} });

        sessionManager.getSession.mockResolvedValue(session);
        persistenceGateway.ensureDatabaseState.mockResolvedValue({
            stepState: originalStepState,
        });
        pageNavigator.resolvePage.mockReturnValue(initialPage);
        pageNavigator.extractMessageValue.mockReturnValue('next value');
        pageNavigator.validatePageValue.mockResolvedValue({ valid: true });
        persistenceGateway.persistStepProgress.mockResolvedValue(updatedStepState);
        persistenceGateway.syncSessionState.mockResolvedValue(undefined);
        pageNavigator.resolveNextPageId.mockResolvedValue('');

        const message = createMessage({
            chat: { id: chatId, type: 'private' },
            text: 'next value',
        });

        await (runtime as unknown as { handleMessage: Function }).handleMessage(message);

        expect(persistenceGateway.persistStepProgress).toHaveBeenCalledWith(
            originalStepState,
            initialPage.id,
            'next value',
        );
        expect(persistenceGateway.syncSessionState).toHaveBeenCalledWith(
            updatedStepState,
            { [initialPage.id]: 'next value' },
        );
        expect(pageNavigator.resolveNextPageId).toHaveBeenCalledWith(
            initialPage,
            expect.objectContaining({ chatId }),
        );
        expect(sessionManager.saveSession).toHaveBeenCalledWith(
            chatId,
            expect.objectContaining({ pageId: undefined }),
        );
        expect(
            persistenceGateway.updateStepStateCurrentPage,
        ).toHaveBeenCalledWith(updatedStepState, undefined);
        expect(pageNavigator.renderPage).not.toHaveBeenCalled();
    });
});
