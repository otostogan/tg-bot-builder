import TelegramBot = require('node-telegram-bot-api');
import type { PrismaClient } from '@prisma/client/extension';
import {
    IBotSessionState,
    IPrismaStepState,
    IPrismaUser,
} from '../../app.interface';
import { IChatSessionState } from './session-manager';
import {
    normalizeAnswers,
    normalizeHistory,
    serializeValue,
} from '../utils/serialization';
import { isDeepStrictEqual } from 'util';

export interface IContextDatabaseState {
    user?: IPrismaUser;
    stepState?: IPrismaStepState;
}

export interface PersistenceGatewayFactoryOptions {
    prisma?: PrismaClient;
    slug: string;
}

export interface IPersistenceGateway {
    readonly prisma?: PrismaClient;
    ensureDatabaseState(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
        message?: TelegramBot.Message,
        currentPageId?: string,
    ): Promise<IContextDatabaseState>;
    persistStepProgress(
        stepState: IPrismaStepState | undefined,
        pageId: string,
        value: unknown,
    ): Promise<IPrismaStepState | undefined>;
    updateStepStateCurrentPage(
        stepState: IPrismaStepState | undefined,
        pageId: string | undefined,
    ): Promise<IPrismaStepState | undefined>;
    syncSessionState(
        stepState: IPrismaStepState | undefined,
        sessionData: IBotSessionState,
    ): Promise<IPrismaStepState | undefined>;
}

class NoopPersistenceGateway implements IPersistenceGateway {
    public readonly prisma = undefined;

    /**
     * Provides an empty database state when persistence is not configured.
     */
    public async ensureDatabaseState(): Promise<IContextDatabaseState> {
        return {};
    }

    /**
     * Skips persistence updates while mirroring the provided state.
     */
    public async persistStepProgress(
        stepState: IPrismaStepState | undefined,
    ): Promise<IPrismaStepState | undefined> {
        return stepState;
    }

    /**
     * Leaves the tracked page unchanged when persistence is disabled.
     */
    public async updateStepStateCurrentPage(
        stepState: IPrismaStepState | undefined,
    ): Promise<IPrismaStepState | undefined> {
        return stepState;
    }

    /**
     * Skips session synchronisation when persistence is disabled.
     */
    public async syncSessionState(
        stepState: IPrismaStepState | undefined,
        _sessionData: IBotSessionState,
    ): Promise<IPrismaStepState | undefined> {
        return stepState;
    }
}

export interface PrismaPersistenceGatewayOptions {
    prisma: PrismaClient;
    slug: string;
}

export class PrismaPersistenceGateway implements IPersistenceGateway {
    public readonly prisma: PrismaClient;
    private readonly slug: string;

    /**
     * Stores the Prisma client and slug used to segregate builder data.
     */
    constructor(options: PrismaPersistenceGatewayOptions) {
        this.prisma = options.prisma;
        this.slug = options.slug;
    }

    /**
     * Ensures user and step state records exist for the chat, creating or
     * updating them based on the latest Telegram payload.
     */
    public async ensureDatabaseState(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
        message?: TelegramBot.Message,
        currentPageId?: string,
    ): Promise<IContextDatabaseState> {
        const telegramUser = message?.from ?? session.user;
        if (!telegramUser) {
            return {};
        }

        const telegramId = this.normalizeTelegramId(telegramUser.id);
        const chatIdentifier = this.normalizeChatId(chatId);

        const user = (await this.prisma.user.upsert({
            where: { telegramId },
            update: {
                chatId: chatIdentifier,
                username: telegramUser.username ?? undefined,
                firstName: telegramUser.first_name ?? undefined,
                lastName: telegramUser.last_name ?? undefined,
                languageCode: telegramUser.language_code ?? undefined,
            },
            create: {
                telegramId,
                chatId: chatIdentifier,
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                lastName: telegramUser.last_name,
                languageCode: telegramUser.language_code,
            },
        })) as unknown as IPrismaUser;

        const targetPageId = currentPageId ?? session.pageId;

        let stepState = (await this.prisma.stepState.findUnique({
            where: {
                userId_slug: {
                    userId: user.id,
                    slug: this.slug,
                },
            },
        })) as unknown as IPrismaStepState | null;

        if (!stepState) {
            stepState = (await this.prisma.stepState.create({
                data: {
                    userId: user.id,
                    chatId: chatIdentifier,
                    slug: this.slug,
                    currentPage: targetPageId ?? null,
                    answers: serializeValue(session.data ?? {}),
                    history: serializeValue([]),
                },
            })) as unknown as IPrismaStepState;
        } else {
            const updates: Record<string, unknown> = {};

            if (stepState.chatId !== chatIdentifier) {
                updates.chatId = chatIdentifier;
            }

            if (
                targetPageId !== undefined &&
                stepState.currentPage !== targetPageId
            ) {
                updates.currentPage = targetPageId;
            }

            if (Object.keys(updates).length > 0) {
                stepState = (await this.prisma.stepState.update({
                    where: { id: stepState.id },
                    data: updates,
                })) as unknown as IPrismaStepState;
            }
        }

        return {
            user,
            stepState,
        };
    }

    /**
     * Persists answers and history for the provided page submission and keeps
     * per-page form entries in sync.
     */
    public async persistStepProgress(
        stepState: IPrismaStepState | undefined,
        pageId: string,
        value: unknown,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState) {
            return stepState;
        }

        const serializedValue = serializeValue(value);
        const answers = normalizeAnswers(stepState.answers);
        answers[pageId] = serializedValue;

        const history = normalizeHistory(stepState.history);
        history.push({
            pageId,
            value: serializedValue,
            timestamp: new Date().toISOString(),
        });

        const updatedStepState = (await this.prisma.stepState.update({
            where: { id: stepState.id },
            data: {
                answers,
                history: JSON.stringify(history),
            },
        })) as unknown as IPrismaStepState;

        await this.prisma.formEntry.upsert({
            where: {
                stepStateId_pageId: {
                    stepStateId: updatedStepState.id,
                    pageId,
                },
            },
            update: {
                payload: serializedValue,
            },
            create: {
                userId: updatedStepState.userId,
                stepStateId: updatedStepState.id,
                slug: updatedStepState.slug,
                pageId,
                payload: serializedValue,
            },
        });

        return updatedStepState;
    }

    /**
     * Ensures the stored session snapshot mirrors the in-memory session data
     * so derived helpers and summaries survive restarts.
     */
    public async syncSessionState(
        stepState: IPrismaStepState | undefined,
        sessionData: IBotSessionState,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState) {
            return stepState;
        }

        const serializedSession = serializeValue(sessionData ?? {});
        const normalizedSession = normalizeAnswers(serializedSession ?? {});
        const normalizedExisting = normalizeAnswers(stepState.answers);

        if (isDeepStrictEqual(normalizedExisting, normalizedSession)) {
            return stepState;
        }

        return (await this.prisma.stepState.update({
            where: { id: stepState.id },
            data: {
                answers: serializedSession ?? {},
            },
        })) as unknown as IPrismaStepState;
    }

    /**
     * Updates the current page tracked in persistence when the conversation
     * flow advances or resets.
     */
    public async updateStepStateCurrentPage(
        stepState: IPrismaStepState | undefined,
        pageId: string | undefined,
    ): Promise<IPrismaStepState | undefined> {
        if (!stepState) {
            return stepState;
        }

        const targetPage = pageId ?? null;
        if (stepState.currentPage === targetPage) {
            return stepState;
        }

        return (await this.prisma.stepState.update({
            where: { id: stepState.id },
            data: {
                currentPage: targetPage,
            },
        })) as unknown as IPrismaStepState;
    }

    /**
     * Normalizes chat identifiers to a string for consistent storage.
     */
    private normalizeChatId(chatId: TelegramBot.ChatId): string {
        return typeof chatId === 'string' ? chatId : chatId.toString();
    }

    /**
     * Converts Telegram user identifiers into bigint form accepted by the
     * database schema.
     */
    private normalizeTelegramId(id: number | string): bigint {
        return typeof id === 'string' ? BigInt(id) : BigInt(id);
    }
}

/**
 * Factory that selects the appropriate persistence gateway based on Prisma
 * availability.
 */
export const createPersistenceGateway = (
    options: PersistenceGatewayFactoryOptions,
): IPersistenceGateway => {
    if (!options.prisma) {
        return new NoopPersistenceGateway();
    }

    return new PrismaPersistenceGateway({
        prisma: options.prisma,
        slug: options.slug,
    });
};
