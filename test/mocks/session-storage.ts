import TelegramBot = require('node-telegram-bot-api');
import type { IBotSessionStorage } from '../../src/app.interface';

export type BotSessionStorageState<TState> = Record<string, TState>;

export type MockSessionStorage<TState> = IBotSessionStorage<TState> & {
  store: Map<string, TState>;
};

export const createInMemorySessionStorage = <TState>(
  initialState: Partial<BotSessionStorageState<TState>> = {},
): MockSessionStorage<TState> => {
  const store = new Map<string, TState>();
  for (const [key, value] of Object.entries(initialState)) {
    store.set(key, value as TState);
  }

  const storage: MockSessionStorage<TState> = {
    store,
    get: jest.fn(async (chatId: TelegramBot.ChatId) => store.get(chatId.toString())),
    set: jest.fn(async (chatId: TelegramBot.ChatId, state: TState) => {
      store.set(chatId.toString(), state);
    }),
    delete: jest.fn(async (chatId: TelegramBot.ChatId) => {
      store.delete(chatId.toString());
    }),
  };

  return storage;
};
