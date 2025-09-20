import {
    IBotSessionState,
    IBotStorage,
    IBotStorageEnsureOptions,
    IBotStorageSaveProgressOptions,
    IBotStorageState,
    IBotStorageStepState,
    IBotStorageUpdateCurrentPageOptions,
    IBotStorageUser,
    IBotStepHistoryEntry,
    TPrismaJsonValue,
} from '../app.interface';

interface IStoredState extends IBotStorageState {
    stepState?: IBotStorageStepStateInternal;
}

interface IBotStorageStepStateInternal extends IBotStorageStepState {
    answers: Record<string, TPrismaJsonValue | null>;
    history: IBotStepHistoryEntry[];
}

export class MemoryStorage implements IBotStorage {
    private readonly users = new Map<string, IBotStorageUser>();
    private readonly stepStates = new Map<string, IBotStorageStepStateInternal>();
    private readonly formEntries = new Map<string, Map<string, TPrismaJsonValue | null>>();
    private userIdSequence = 1;
    private stepStateIdSequence = 1;

    public async ensureState(
        options: IBotStorageEnsureOptions,
    ): Promise<IBotStorageState> {
        const telegramId = this.normalizeTelegramId(options.telegramUser.id);
        const user = this.ensureUser(telegramId, options);
        const stepState = this.ensureStepState(user, options);

        return this.cloneState({ user, stepState });
    }

    public async saveStepProgress(
        options: IBotStorageSaveProgressOptions,
    ): Promise<IBotStorageStepState | undefined> {
        const key = this.getStepStateKey(options.stepState.userId, options.stepState.slug);
        const stored = this.stepStates.get(key);
        if (!stored) {
            return undefined;
        }

        stored.answers = this.cloneValue(options.answers ?? {});
        stored.history = this.cloneValue(options.history ?? []);

        const formEntries = this.ensureFormEntriesCollection(key);
        formEntries.set(options.pageId, options.value ?? null);

        return this.cloneStepState(stored);
    }

    public async updateCurrentPage(
        options: IBotStorageUpdateCurrentPageOptions,
    ): Promise<IBotStorageStepState | undefined> {
        const key = this.getStepStateKey(options.stepState.userId, options.stepState.slug);
        const stored = this.stepStates.get(key);
        if (!stored) {
            return undefined;
        }

        stored.currentPage = options.pageId ?? undefined;
        return this.cloneStepState(stored);
    }

    private ensureUser(
        telegramId: string,
        options: IBotStorageEnsureOptions,
    ): IBotStorageUser {
        const existing = this.users.get(telegramId);
        const next: IBotStorageUser = existing
            ? { ...existing }
            : {
                  id: this.userIdSequence++,
                  telegramId,
                  chatId: null,
                  username: null,
                  firstName: null,
                  lastName: null,
                  languageCode: null,
              };

        next.chatId = options.chatId;
        next.username = options.telegramUser.username ?? null;
        next.firstName = options.telegramUser.first_name ?? null;
        next.lastName = options.telegramUser.last_name ?? null;
        next.languageCode = options.telegramUser.language_code ?? null;

        this.users.set(telegramId, next);
        return next;
    }

    private ensureStepState(
        user: IBotStorageUser,
        options: IBotStorageEnsureOptions,
    ): IBotStorageStepStateInternal {
        const key = this.getStepStateKey(user.id, options.slug);
        const targetPageId = options.currentPageId ?? null;
        const existing = this.stepStates.get(key);

        if (!existing) {
            const stepState: IBotStorageStepStateInternal = {
                id: this.stepStateIdSequence++,
                userId: user.id,
                chatId: options.chatId,
                slug: options.slug,
                currentPage: targetPageId ?? undefined,
                answers: this.normalizeSessionState(options.sessionState ?? {}),
                history: [],
            };

            this.stepStates.set(key, stepState);
            return stepState;
        }

        existing.chatId = options.chatId;

        if (options.currentPageId !== undefined) {
            existing.currentPage = targetPageId ?? undefined;
        }

        return existing;
    }

    private ensureFormEntriesCollection(
        key: string,
    ): Map<string, TPrismaJsonValue | null> {
        let collection = this.formEntries.get(key);
        if (!collection) {
            collection = new Map();
            this.formEntries.set(key, collection);
        }

        return collection;
    }

    private getStepStateKey(userId: number | string, slug: string): string {
        return `${String(userId)}:${slug}`;
    }

    private normalizeTelegramId(id: number | string): string {
        return typeof id === 'string' ? id : id.toString();
    }

    private cloneState(state: IStoredState): IBotStorageState {
        return {
            user: state.user ? this.cloneValue(state.user) : undefined,
            stepState: state.stepState ? this.cloneStepState(state.stepState) : undefined,
        };
    }

    private cloneStepState(
        stepState: IBotStorageStepStateInternal,
    ): IBotStorageStepState {
        return {
            ...stepState,
            answers: this.cloneValue(stepState.answers),
            history: this.cloneValue(stepState.history),
        };
    }

    private cloneValue<T>(value: T): T {
        try {
            return structuredClone(value);
        } catch {
            return value;
        }
    }

    private normalizeSessionState(
        state: IBotSessionState,
    ): Record<string, TPrismaJsonValue | null> {
        if (!state || typeof state !== 'object') {
            return {};
        }

        const normalized: Record<string, TPrismaJsonValue | null> = {};
        for (const [key, value] of Object.entries(state)) {
            normalized[key] = this.normalizeValue(value);
        }

        return normalized;
    }

    private normalizeValue(value: unknown): TPrismaJsonValue | null {
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
            return value.map((item) => this.normalizeValue(item)) as TPrismaJsonValue;
        }

        if (typeof value === 'object') {
            const normalized: Record<string, TPrismaJsonValue | null> = {};
            for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
                normalized[key] = this.normalizeValue(item);
            }

            return normalized as TPrismaJsonValue;
        }

        return null;
    }
}
