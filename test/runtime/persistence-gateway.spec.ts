import TelegramBot = require('node-telegram-bot-api');
import type { PrismaClient } from '@prisma/client/extension';
import {
    PrismaPersistenceGateway,
    IChatSessionState,
    IBotSessionState,
    IPrismaStepState,
} from '../../src';

describe('PrismaPersistenceGateway', () => {
    const slug = 'test-bot';
    const chatId = 987654321;
    const telegramUser: TelegramBot.User = {
        id: 42,
        is_bot: false,
        first_name: 'Test',
        last_name: 'User',
        username: 'tester',
        language_code: 'en',
    };

    const baseMessage: TelegramBot.Message = {
        message_id: 1,
        date: 0,
        chat: {
            id: chatId,
            type: 'private',
        },
        from: telegramUser,
    } as TelegramBot.Message;

    const createPrismaMock = () => ({
        user: {
            upsert: jest.fn(),
        },
        stepState: {
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        formEntry: {
            upsert: jest.fn(),
        },
    });

    const createGateway = () => {
        const prisma = createPrismaMock();
        const gateway = new PrismaPersistenceGateway({
            prisma: prisma as unknown as PrismaClient,
            slug,
        });

        return { prisma, gateway };
    };

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('ensureDatabaseState', () => {
        it('creates a user and step state when none exist', async () => {
            const { prisma, gateway } = createGateway();
            const session: IChatSessionState = {
                pageId: 'session-page',
                data: { foo: 'bar' },
            };

            const userRecord = {
                id: 10,
                telegramId: BigInt(telegramUser.id),
                chatId: 'initial',
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                lastName: telegramUser.last_name,
                languageCode: telegramUser.language_code,
            };
            const createdStepState: IPrismaStepState = {
                id: 5,
                userId: userRecord.id,
                chatId: chatId.toString(),
                slug,
                currentPage: 'page-1',
                answers: { foo: 'bar' },
                history: [],
            };

            prisma.user.upsert.mockResolvedValue(userRecord);
            prisma.stepState.findUnique.mockResolvedValue(null);
            prisma.stepState.create.mockResolvedValue(createdStepState);

            const result = await gateway.ensureDatabaseState(
                chatId,
                session,
                baseMessage,
                'page-1',
            );

            expect(prisma.user.upsert).toHaveBeenCalledWith({
                where: { telegramId: BigInt(telegramUser.id) },
                update: expect.objectContaining({
                    chatId: chatId.toString(),
                    username: telegramUser.username,
                    firstName: telegramUser.first_name,
                    lastName: telegramUser.last_name,
                    languageCode: telegramUser.language_code,
                }),
                create: expect.objectContaining({
                    telegramId: BigInt(telegramUser.id),
                    chatId: chatId.toString(),
                }),
            });
            expect(prisma.stepState.create).toHaveBeenCalledWith({
                data: {
                    userId: userRecord.id,
                    chatId: chatId.toString(),
                    slug,
                    currentPage: 'page-1',
                    answers: { foo: 'bar' },
                    history: [],
                },
            });
            expect(prisma.stepState.update).not.toHaveBeenCalled();
            expect(result).toEqual({
                user: userRecord,
                stepState: createdStepState,
            });
        });

        it('updates existing step state when chat or page changes', async () => {
            const { prisma, gateway } = createGateway();
            const session: IChatSessionState = {
                pageId: 'session-page',
                data: {},
            };

            const userRecord = {
                id: 7,
                telegramId: BigInt(telegramUser.id),
                chatId: 'old',
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                lastName: telegramUser.last_name,
                languageCode: telegramUser.language_code,
            };
            const existingStepState: IPrismaStepState = {
                id: 3,
                userId: userRecord.id,
                chatId: 'different',
                slug,
                currentPage: 'outdated-page',
                answers: {},
                history: [],
            };
            const updatedStepState: IPrismaStepState = {
                ...existingStepState,
                chatId: chatId.toString(),
                currentPage: 'fresh-page',
            };

            prisma.user.upsert.mockResolvedValue(userRecord);
            prisma.stepState.findUnique.mockResolvedValue(existingStepState);
            prisma.stepState.update.mockResolvedValue(updatedStepState);

            const result = await gateway.ensureDatabaseState(
                chatId,
                session,
                baseMessage,
                'fresh-page',
            );

            expect(prisma.stepState.create).not.toHaveBeenCalled();
            expect(prisma.stepState.update).toHaveBeenCalledWith({
                where: { id: existingStepState.id },
                data: {
                    chatId: chatId.toString(),
                    currentPage: 'fresh-page',
                },
            });
            expect(result).toEqual({
                user: userRecord,
                stepState: updatedStepState,
            });
        });

        it('returns empty state when telegram user cannot be determined', async () => {
            const { prisma, gateway } = createGateway();
            const session: IChatSessionState = {
                pageId: undefined,
                data: {},
            };
            const messageWithoutFrom = {
                ...baseMessage,
                from: undefined,
            } as TelegramBot.Message;

            const result = await gateway.ensureDatabaseState(
                chatId,
                session,
                messageWithoutFrom,
            );

            expect(result).toEqual({});
            expect(prisma.user.upsert).not.toHaveBeenCalled();
            expect(prisma.stepState.findUnique).not.toHaveBeenCalled();
        });
    });

    describe('persistStepProgress', () => {
        it('serializes answers, appends history and upserts form entry', async () => {
            const { prisma, gateway } = createGateway();
            const pageId = 'target-page';
            const formValue = { foo: 'bar', nested: [1, 2] };
            const stepState: IPrismaStepState = {
                id: 11,
                userId: 22,
                chatId: chatId.toString(),
                slug,
                currentPage: 'previous-page',
                answers: { existing: 'value' },
                history: [
                    {
                        pageId: 'previous',
                        timestamp: '2023-01-01T00:00:00.000Z',
                        value: 'old',
                    },
                ],
            };
            const updatedStepState: IPrismaStepState = {
                ...stepState,
                answers: {},
                history: '[]',
            };

            prisma.stepState.update.mockResolvedValue(updatedStepState);

            const fixedDate = new Date('2024-05-15T12:34:56.000Z');
            jest.useFakeTimers();
            jest.setSystemTime(fixedDate);

            const result = await gateway.persistStepProgress(
                stepState,
                pageId,
                formValue,
            );

            expect(prisma.stepState.update).toHaveBeenCalledTimes(1);
            const updateArgs = prisma.stepState.update.mock.calls[0][0];
            expect(updateArgs.where).toEqual({ id: stepState.id });
            expect(updateArgs.data.answers).toEqual({
                existing: 'value',
                [pageId]: { foo: 'bar', nested: [1, 2] },
            });
            const storedHistory = JSON.parse(updateArgs.data.history);
            expect(storedHistory).toEqual([
                {
                    pageId: 'previous',
                    timestamp: '2023-01-01T00:00:00.000Z',
                    value: 'old',
                },
                {
                    pageId,
                    value: { foo: 'bar', nested: [1, 2] },
                    timestamp: fixedDate.toISOString(),
                },
            ]);
            expect(prisma.formEntry.upsert).toHaveBeenCalledWith({
                where: {
                    stepStateId_pageId: {
                        stepStateId: updatedStepState.id,
                        pageId,
                    },
                },
                update: { payload: { foo: 'bar', nested: [1, 2] } },
                create: {
                    userId: updatedStepState.userId,
                    stepStateId: updatedStepState.id,
                    slug: updatedStepState.slug,
                    pageId,
                    payload: { foo: 'bar', nested: [1, 2] },
                },
            });
            expect(result).toBe(updatedStepState);
        });
    });

    describe('syncSessionState', () => {
        it('skips persistence when answers already match session', async () => {
            const { prisma, gateway } = createGateway();
            const stepState: IPrismaStepState = {
                id: 30,
                userId: 40,
                chatId: chatId.toString(),
                slug,
                currentPage: null,
                answers: { foo: 'bar' },
                history: [],
            };
            const sessionData: IBotSessionState = { foo: 'bar' };

            const result = await gateway.syncSessionState(
                stepState,
                sessionData,
            );

            expect(result).toBe(stepState);
            expect(prisma.stepState.update).not.toHaveBeenCalled();
        });

        it('updates stored answers when session data diverges', async () => {
            const { prisma, gateway } = createGateway();
            const stepState: IPrismaStepState = {
                id: 31,
                userId: 41,
                chatId: chatId.toString(),
                slug,
                currentPage: null,
                answers: { foo: 'bar' },
                history: [],
            };
            const sessionData: IBotSessionState = { foo: 'baz' };
            const updated: IPrismaStepState = {
                ...stepState,
                answers: sessionData,
            };

            prisma.stepState.update.mockResolvedValue(updated);

            const result = await gateway.syncSessionState(
                stepState,
                sessionData,
            );

            expect(prisma.stepState.update).toHaveBeenCalledWith({
                where: { id: stepState.id },
                data: { answers: sessionData },
            });
            expect(result).toBe(updated);
        });
    });

    describe('updateStepStateCurrentPage', () => {
        it('returns early when no step state is provided', async () => {
            const { prisma, gateway } = createGateway();

            const result = await gateway.updateStepStateCurrentPage(
                undefined,
                'any-page',
            );

            expect(result).toBeUndefined();
            expect(prisma.stepState.update).not.toHaveBeenCalled();
        });

        it('updates the current page when it changes', async () => {
            const { prisma, gateway } = createGateway();
            const stepState: IPrismaStepState = {
                id: 50,
                userId: 60,
                chatId: chatId.toString(),
                slug,
                currentPage: 'old-page',
                answers: {},
                history: [],
            };
            const updated: IPrismaStepState = {
                ...stepState,
                currentPage: 'new-page',
            };

            prisma.stepState.update.mockResolvedValue(updated);

            const result = await gateway.updateStepStateCurrentPage(
                stepState,
                'new-page',
            );

            expect(prisma.stepState.update).toHaveBeenCalledWith({
                where: { id: stepState.id },
                data: { currentPage: 'new-page' },
            });
            expect(result).toBe(updated);
        });
    });
});
