import TelegramBot from 'node-telegram-bot-api';

/**
 * Normalizes chat identifiers to a string for consistent storage.
 */
export const normalizeChatId = (chatId: TelegramBot.ChatId): string => {
    return typeof chatId === 'string' ? chatId : chatId.toString();
};

/**
 * Converts Telegram user identifiers into bigint form accepted by the
 * database schema.
 */
export const normalizeTelegramId = (id: number | string): bigint => {
    return typeof id === 'string' ? BigInt(id) : BigInt(id);
};
