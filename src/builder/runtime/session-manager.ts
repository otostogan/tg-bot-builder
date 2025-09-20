import TelegramBot = require('node-telegram-bot-api');
import {
    IBotSessionState,
    IBotSessionStorage,
    TBotPageIdentifier,
} from '../../app.interface';

export interface IChatSessionState {
    pageId?: TBotPageIdentifier;
    data: IBotSessionState;
    user?: TelegramBot.User;
}

export interface SessionManagerOptions {
    sessionStorage?: IBotSessionStorage<IChatSessionState | IBotSessionState>;
}

export class SessionManager {
    private readonly sessionStorage: IBotSessionStorage<
        IChatSessionState | IBotSessionState
    >;

    private readonly sessionCache = new Map<string, IChatSessionState>();

    constructor(options: SessionManagerOptions = {}) {
        this.sessionStorage =
            options.sessionStorage ??
            (this.createDefaultSessionStorage() as IBotSessionStorage<
                IChatSessionState | IBotSessionState
            >);
    }

    public async getSession(
        chatId: TelegramBot.ChatId,
    ): Promise<IChatSessionState> {
        const key = chatId.toString();
        const cached = this.sessionCache.get(key);
        if (cached) {
            return cached;
        }

        const stored = await this.sessionStorage.get(chatId);
        const session = this.normalizeSessionState(stored) ?? {
            pageId: undefined,
            data: {},
        };

        this.sessionCache.set(key, session);
        return session;
    }

    public async saveSession(
        chatId: TelegramBot.ChatId,
        session: IChatSessionState,
    ): Promise<void> {
        const key = chatId.toString();
        this.sessionCache.set(key, session);
        await this.sessionStorage.set(chatId, session);
    }

    public async deleteSession(chatId: TelegramBot.ChatId): Promise<void> {
        const key = chatId.toString();
        this.sessionCache.delete(key);
        if (this.sessionStorage.delete) {
            await this.sessionStorage.delete(chatId);
        }
    }

    private normalizeSessionState(
        stored?: IChatSessionState | IBotSessionState | null,
    ): IChatSessionState | undefined {
        if (!stored) {
            return undefined;
        }

        if (this.isChatSessionState(stored)) {
            stored.data = stored.data ?? {};
            return stored;
        }

        if (this.isSessionState(stored)) {
            return {
                pageId: undefined,
                data: stored,
            };
        }

        return undefined;
    }

    private isChatSessionState(value: unknown): value is IChatSessionState {
        return (
            typeof value === 'object' &&
            value !== null &&
            'data' in value &&
            !Array.isArray((value as { data?: unknown }).data)
        );
    }

    private isSessionState(value: unknown): value is IBotSessionState {
        return (
            typeof value === 'object' && value !== null && !Array.isArray(value)
        );
    }

    private createDefaultSessionStorage(): IBotSessionStorage<IChatSessionState> {
        const store = new Map<string, IChatSessionState>();
        return {
            get: (chatId: TelegramBot.ChatId) => store.get(chatId.toString()),
            set: (chatId: TelegramBot.ChatId, state: IChatSessionState) => {
                store.set(chatId.toString(), state);
            },
            delete: (chatId: TelegramBot.ChatId) => {
                store.delete(chatId.toString());
            },
        };
    }
}

export interface SessionManagerFactoryOptions extends SessionManagerOptions {}

export const createSessionManager = (
    options: SessionManagerFactoryOptions = {},
): SessionManager => new SessionManager(options);
