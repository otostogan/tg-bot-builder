import { Prisma, PrismaClient } from '@prisma/client';
import {
    IBotStorage,
    IBotStorageEnsureOptions,
    IBotStorageSaveProgressOptions,
    IBotStorageState,
    IBotStorageStepState,
    IBotStorageUpdateCurrentPageOptions,
    IBotStorageUser,
    TPrismaJsonValue,
} from '../app.interface';

export class PrismaStorage implements IBotStorage {
    private isConnected = false;

    constructor(private readonly prisma: PrismaClient) {}

    public async ensureState(
        options: IBotStorageEnsureOptions,
    ): Promise<IBotStorageState> {
        await this.ensureConnected();

        const telegramId = this.normalizeTelegramId(options.telegramUser.id);

        const user = (await this.prisma.user.upsert({
            where: { telegramId },
            update: {
                chatId: options.chatId,
                username: options.telegramUser.username ?? undefined,
                firstName: options.telegramUser.first_name ?? undefined,
                lastName: options.telegramUser.last_name ?? undefined,
                languageCode: options.telegramUser.language_code ?? undefined,
            },
            create: {
                telegramId,
                chatId: options.chatId,
                username: options.telegramUser.username,
                firstName: options.telegramUser.first_name,
                lastName: options.telegramUser.last_name,
                languageCode: options.telegramUser.language_code,
            },
        })) as unknown as IBotStorageUser;

        const targetPageId = options.currentPageId ?? null;

        let stepState = (await this.prisma.stepState.findUnique({
            where: {
                userId_slug: {
                    userId: this.toNumber(user.id),
                    slug: options.slug,
                },
            },
        })) as unknown as IBotStorageStepState | null;

        if (!stepState) {
            stepState = (await this.prisma.stepState.create({
                data: {
                    userId: this.toNumber(user.id),
                    chatId: options.chatId,
                    slug: options.slug,
                    currentPage: targetPageId,
                    answers: this.serializeValue(options.sessionState ?? {}),
                    history: [] as Prisma.InputJsonValue,
                },
            })) as unknown as IBotStorageStepState;
        } else {
            const updates: Record<string, unknown> = {};

            if (stepState.chatId !== options.chatId) {
                updates.chatId = options.chatId;
            }

            if (
                options.currentPageId !== undefined &&
                stepState.currentPage !== targetPageId
            ) {
                updates.currentPage = targetPageId;
            }

            if (Object.keys(updates).length > 0) {
                stepState = (await this.prisma.stepState.update({
                    where: { id: this.toNumber(stepState.id) },
                    data: updates,
                })) as unknown as IBotStorageStepState;
            }
        }

        return { user, stepState };
    }

    public async saveStepProgress(
        options: IBotStorageSaveProgressOptions,
    ): Promise<IBotStorageStepState | undefined> {
        await this.ensureConnected();

        const historyValue = (this.serializeValue(options.history) ?? []) as Prisma.InputJsonValue;

        const updatedStepState = (await this.prisma.stepState.update({
            where: { id: this.toNumber(options.stepState.id) },
            data: {
                answers: options.answers,
                history: historyValue,
            },
        })) as unknown as IBotStorageStepState;

        await this.prisma.formEntry.upsert({
            where: {
                stepStateId_pageId: {
                    stepStateId: this.toNumber(updatedStepState.id),
                    pageId: options.pageId,
                },
            },
            update: {
                payload: options.value,
            },
            create: {
                userId: this.toNumber(updatedStepState.userId),
                stepStateId: this.toNumber(updatedStepState.id),
                slug: updatedStepState.slug,
                pageId: options.pageId,
                payload: options.value,
            },
        });

        return updatedStepState;
    }

    public async updateCurrentPage(
        options: IBotStorageUpdateCurrentPageOptions,
    ): Promise<IBotStorageStepState | undefined> {
        await this.ensureConnected();

        return (await this.prisma.stepState.update({
            where: { id: this.toNumber(options.stepState.id) },
            data: {
                currentPage: options.pageId ?? null,
            },
        })) as unknown as IBotStorageStepState;
    }

    private async ensureConnected(): Promise<void> {
        if (this.isConnected) {
            return;
        }

        await this.prisma.$connect();
        this.isConnected = true;
    }

    private normalizeTelegramId(id: number | string): bigint {
        return typeof id === 'string' ? BigInt(id) : BigInt(id);
    }

    private toNumber(value: number | string): number {
        return typeof value === 'string' ? Number(value) : value;
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
            return value.map((item) => this.serializeValue(item)) as TPrismaJsonValue;
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
}
