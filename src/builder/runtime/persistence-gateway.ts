import TelegramBot = require('node-telegram-bot-api');
import type { PrismaClient } from '@prisma/client/extension';
import {
    IPrismaStepState,
    IPrismaUser,
    TPrismaJsonValue,
} from '../../app.interface';
import { IChatSessionState } from './session-manager';

interface IStepHistoryEntry {
    pageId: string;
    value: TPrismaJsonValue | null;
    timestamp: string;
}

export interface IContextDatabaseState {
    user?: IPrismaUser;
    stepState?: IPrismaStepState;
}

export interface PersistenceGatewayOptions {
    prisma?: PrismaClient;
    slug: string;
}

export class PersistenceGateway {
    constructor(private readonly options: PersistenceGatewayOptions) {}

    public get prisma(): PrismaClient | undefined {
        return this.options.prisma;
    }

    public async ensureDatabaseState(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
        message?: TelegramBot.Message,
        currentPageId?: string,
    ): Promise<IContextDatabaseState> {
        const prisma = this.options.prisma;
        if (!prisma) {
            return {};
        }

        const telegramUser = message?.from ?? session.user;
        if (!telegramUser) {
            return {};
        }

        const telegramId = this.normalizeTelegramId(telegramUser.id);
        const chatIdentifier = this.normalizeChatId(chatId);

        const user = (await prisma.user.upsert({
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

        let stepState = (await prisma.stepState.findUnique({
            where: {
                userId_slug: {
                    userId: user.id,
                    slug: this.options.slug,
                },
            },
        })) as unknown as IPrismaStepState | null;

        if (!stepState) {
            stepState = (await prisma.stepState.create({
                data: {
                    userId: user.id,
                    chatId: chatIdentifier,
                    slug: this.options.slug,
                    currentPage: targetPageId ?? null,
                    answers: this.serializeValue(session.data ?? {}),
                    history: this.serializeValue([]),
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
                stepState = (await prisma.stepState.update({
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

    public async persistStepProgress(
        stepState: IPrismaStepState | undefined,
        pageId: string,
        value: unknown,
    ): Promise<IPrismaStepState | undefined> {
        const prisma = this.options.prisma;
        if (!prisma || !stepState) {
            return stepState;
        }

        const serializedValue = this.serializeValue(value);
        const answers = this.normalizeAnswers(stepState.answers);
        answers[pageId] = serializedValue;

        const history = this.normalizeHistory(stepState.history);
        history.push({
            pageId,
            value: serializedValue,
            timestamp: new Date().toISOString(),
        });

        const updatedStepState = (await prisma.stepState.update({
            where: { id: stepState.id },
            data: {
                answers,
                history: JSON.stringify(history),
            },
        })) as unknown as IPrismaStepState;

        await prisma.formEntry.upsert({
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

    public async updateStepStateCurrentPage(
        stepState: IPrismaStepState | undefined,
        pageId: string | undefined,
    ): Promise<IPrismaStepState | undefined> {
        const prisma = this.options.prisma;
        if (!prisma || !stepState) {
            return stepState;
        }

        const targetPage = pageId ?? null;
        if (stepState.currentPage === targetPage) {
            return stepState;
        }

        return (await prisma.stepState.update({
            where: { id: stepState.id },
            data: {
                currentPage: targetPage,
            },
        })) as unknown as IPrismaStepState;
    }

    private normalizeAnswers(
        answers: unknown,
    ): Record<string, TPrismaJsonValue | null> {
        if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
            return {};
        }

        return {
            ...(answers as Record<string, TPrismaJsonValue | null>),
        };
    }

    private normalizeHistory(history: unknown): IStepHistoryEntry[] {
        if (!Array.isArray(history)) {
            return [];
        }

        return history
            .map((entry) =>
                typeof entry === 'object' && entry !== null
                    ? (entry as Record<string, unknown>)
                    : undefined,
            )
            .filter((entry): entry is Record<string, unknown> => Boolean(entry))
            .map((entry) => {
                const pageIdValue = entry.pageId;
                const timestampValue = entry.timestamp;

                const pageId =
                    typeof pageIdValue === 'string'
                        ? pageIdValue
                        : String(pageIdValue ?? '');
                const timestamp =
                    typeof timestampValue === 'string'
                        ? timestampValue
                        : new Date().toISOString();

                return {
                    pageId,
                    timestamp,
                    value: this.serializeValue(entry.value),
                };
            });
    }

    private serializeValue(value: unknown): TPrismaJsonValue | null {
        if (value === undefined) {
            return null;
        }

        if (
            value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return value as TPrismaJsonValue;
        }

        if (typeof value === 'bigint') {
            return value.toString();
        }

        if (Array.isArray(value)) {
            return value.map((item) =>
                this.serializeValue(item),
            ) as TPrismaJsonValue;
        }

        if (typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>);
            const normalized: Record<string, TPrismaJsonValue | null> = {};
            for (const [key, item] of entries) {
                normalized[key] = this.serializeValue(item);
            }
            return normalized as TPrismaJsonValue;
        }

        return null;
    }

    private normalizeChatId(chatId: TelegramBot.ChatId): string {
        return typeof chatId === 'string' ? chatId : chatId.toString();
    }

    private normalizeTelegramId(id: number | string): bigint {
        return typeof id === 'string' ? BigInt(id) : BigInt(id);
    }
}

export interface PersistenceGatewayFactoryOptions
    extends PersistenceGatewayOptions {}

export const createPersistenceGateway = (
    options: PersistenceGatewayFactoryOptions,
): PersistenceGateway => new PersistenceGateway(options);
