import TelegramBot = require('node-telegram-bot-api');
import { SessionManager, IChatSessionState } from '../../src';
import { IBotSessionState } from '../../src';
import { createInMemorySessionStorage } from '../mocks/session-storage';

describe('SessionManager', () => {
    const chatId = 12345;

    it('normalizes missing session into an empty state and caches the result', async () => {
        const storage = createInMemorySessionStorage<
            IChatSessionState | IBotSessionState
        >();
        const manager = new SessionManager({ sessionStorage: storage });

        const session = await manager.getSession(chatId);

        expect(session).toEqual({ pageId: undefined, data: {} });
        expect(storage.get).toHaveBeenCalledTimes(1);

        const cached = await manager.getSession(chatId);

        expect(cached).toBe(session);
        expect(storage.get).toHaveBeenCalledTimes(1);
    });

    it('wraps legacy session data and caches the normalized result', async () => {
        const legacyState: IBotSessionState = { foo: 'bar' };
        const storage = createInMemorySessionStorage<
            IChatSessionState | IBotSessionState
        >({
            [chatId.toString()]: legacyState,
        });
        const manager = new SessionManager({ sessionStorage: storage });

        const session = await manager.getSession(chatId);

        expect(session).toEqual({ pageId: undefined, data: legacyState });
        expect(session.data).toBe(legacyState);
        expect(storage.get).toHaveBeenCalledTimes(1);

        const cached = await manager.getSession(chatId);

        expect(cached).toBe(session);
        expect(storage.get).toHaveBeenCalledTimes(1);
    });

    it('ensures chat session state includes data and caches the patched value', async () => {
        const user = {
            id: 1,
            is_bot: false,
            first_name: 'Tester',
        } as TelegramBot.User;
        const stored = {
            pageId: 'page-1',
            data: undefined,
            user,
        } as unknown as IChatSessionState;
        const storage = createInMemorySessionStorage<
            IChatSessionState | IBotSessionState
        >({
            [chatId.toString()]: stored,
        });
        const manager = new SessionManager({ sessionStorage: storage });

        const session = await manager.getSession(chatId);

        expect(session.pageId).toBe('page-1');
        expect(session.user).toBe(user);
        expect(session.data).toEqual({});
        expect(storage.get).toHaveBeenCalledTimes(1);

        const cached = await manager.getSession(chatId);

        expect(cached).toBe(session);
        expect(storage.get).toHaveBeenCalledTimes(1);
    });

    it('updates cache and storage when saving a session', async () => {
        const storage = createInMemorySessionStorage<
            IChatSessionState | IBotSessionState
        >();
        const manager = new SessionManager({ sessionStorage: storage });

        const session: IChatSessionState = {
            pageId: 'page-2',
            data: { answer: 42 },
        };

        await manager.saveSession(chatId, session);

        expect(storage.set).toHaveBeenCalledTimes(1);
        expect(storage.set).toHaveBeenCalledWith(chatId, session);

        const cached = await manager.getSession(chatId);

        expect(cached).toBe(session);
        expect(storage.get).not.toHaveBeenCalled();
    });
});
