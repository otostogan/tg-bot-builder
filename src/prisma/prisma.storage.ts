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

export interface IPrismaStorageOptions {
    client?: PrismaClient;
    prismaClientOptions?: Prisma.PrismaClientOptions;
    datasourceUrl?: string;
    autoMigrate?: boolean;
}

function isPrismaClient(value: unknown): value is PrismaClient {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as PrismaClient).$connect === 'function' &&
        typeof (value as PrismaClient).$disconnect === 'function'
    );
}

export class PrismaStorage implements IBotStorage {
    private readonly prisma: PrismaClient;
    private readonly ownsClient: boolean;
    private readonly autoMigrate: boolean;
    private isConnected = false;
    private schemaInitialized = false;
    private schemaInitialization?: Promise<void>;

    constructor(options?: PrismaClient | IPrismaStorageOptions) {
        const normalizedOptions = this.normalizeOptions(options);
        this.autoMigrate = normalizedOptions.autoMigrate ?? true;

        if (normalizedOptions.client) {
            this.prisma = normalizedOptions.client;
            this.ownsClient = false;
        } else {
            const prismaOptions = this.mergePrismaOptions(normalizedOptions);
            this.prisma = new PrismaClient(prismaOptions);
            this.ownsClient = true;
        }
    }

    public async ensureState(
        options: IBotStorageEnsureOptions,
    ): Promise<IBotStorageState> {
        await this.ensureReady();

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
        await this.ensureReady();

        const historyValue = (this.serializeValue(options.history) ?? []) as Prisma.InputJsonValue;
        const answersValue = (this.serializeValue(options.answers) ?? {}) as Prisma.InputJsonValue;

        const updatedStepState = (await this.prisma.stepState.update({
            where: { id: this.toNumber(options.stepState.id) },
            data: {
                answers: answersValue,
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
        await this.ensureReady();

        return (await this.prisma.stepState.update({
            where: { id: this.toNumber(options.stepState.id) },
            data: {
                currentPage: options.pageId ?? null,
            },
        })) as unknown as IBotStorageStepState;
    }

    public async disconnect(): Promise<void> {
        if (!this.ownsClient || !this.isConnected) {
            return;
        }

        await this.prisma.$disconnect();
        this.isConnected = false;
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

    private normalizeOptions(
        options?: PrismaClient | IPrismaStorageOptions,
    ): Required<Omit<IPrismaStorageOptions, 'client'>> & {
        client?: PrismaClient;
    } {
        if (isPrismaClient(options)) {
            return {
                client: options,
                prismaClientOptions: {},
                datasourceUrl: undefined,
                autoMigrate: true,
            };
        }

        const normalized = options ?? {};

        return {
            client: normalized.client,
            prismaClientOptions: normalized.prismaClientOptions ?? {},
            datasourceUrl: normalized.datasourceUrl,
            autoMigrate: normalized.autoMigrate ?? true,
        };
    }

    private mergePrismaOptions(
        options: Required<Omit<IPrismaStorageOptions, 'client'>> & {
            client?: PrismaClient;
        },
    ): Prisma.PrismaClientOptions {
        const prismaOptions = { ...options.prismaClientOptions };

        if (options.datasourceUrl) {
            prismaOptions.datasources = {
                db: { url: options.datasourceUrl },
            } as Prisma.PrismaClientOptions['datasources'];
        }

        return prismaOptions;
    }

    private async ensureReady(): Promise<void> {
        if (!this.isConnected) {
            await this.prisma.$connect();
            this.isConnected = true;
        }

        if (!this.autoMigrate) {
            return;
        }

        if (!this.schemaInitialized) {
            if (!this.schemaInitialization) {
                this.schemaInitialization = this.applyMigrations()
                    .then(() => {
                        this.schemaInitialized = true;
                    })
                    .catch((error) => {
                        this.schemaInitialization = undefined;
                        throw error;
                    });
            }

            await this.schemaInitialization;
        }
    }

    private async applyMigrations(): Promise<void> {
        const statements = [
            `CREATE TABLE IF NOT EXISTS "User" (
                "id" SERIAL PRIMARY KEY,
                "telegramId" BIGINT NOT NULL UNIQUE,
                "chatId" TEXT,
                "username" TEXT,
                "firstName" TEXT,
                "lastName" TEXT,
                "languageCode" TEXT,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS "StepState" (
                "id" SERIAL PRIMARY KEY,
                "userId" INTEGER NOT NULL,
                "chatId" TEXT NOT NULL,
                "slug" TEXT NOT NULL,
                "currentPage" TEXT,
                "answers" JSONB,
                "history" JSONB,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "StepState_userId_fkey"
                    FOREIGN KEY ("userId")
                    REFERENCES "User"("id")
                    ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS "FormEntry" (
                "id" SERIAL PRIMARY KEY,
                "userId" INTEGER NOT NULL,
                "stepStateId" INTEGER NOT NULL,
                "slug" TEXT NOT NULL,
                "pageId" TEXT NOT NULL,
                "payload" JSONB NOT NULL,
                "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "FormEntry_userId_fkey"
                    FOREIGN KEY ("userId")
                    REFERENCES "User"("id")
                    ON DELETE CASCADE,
                CONSTRAINT "FormEntry_stepStateId_fkey"
                    FOREIGN KEY ("stepStateId")
                    REFERENCES "StepState"("id")
                    ON DELETE CASCADE
            )`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "StepState_userId_slug_key"
                ON "StepState" ("userId", "slug")`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "FormEntry_stepStateId_pageId_key"
                ON "FormEntry" ("stepStateId", "pageId")`,
        ];

        for (const statement of statements) {
            await this.prisma.$executeRawUnsafe(statement);
        }
    }
}
