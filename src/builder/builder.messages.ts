import type {
    IBotRuntimeMessages,
    TBotRuntimeMessageOverrides,
} from '../app.interface';

const DEFAULT_MESSAGES: IBotRuntimeMessages = {
    runtimeInitialized: ({ id }) => `BotBuilder runtime "${id}" initialized`,
    botIdResolutionFailed: () => 'Bot identifier could not be resolved',
    invalidHandler: () => 'Attempted to register an invalid handler',
    handlerMissingListener: ({ event }) =>
        `Handler for event "${event}" does not provide a listener`,
    pageNotFound: ({ pageId, chatId }) =>
        `Page with id "${String(pageId)}" not found for chat ${String(chatId)}`,
    nextPageNotFound: ({ pageId, chatId }) =>
        `Next page with id "${String(pageId)}" not found for chat ${String(chatId)}`,
    messageHandlingError: ({ error }) =>
        error instanceof Error
            ? `Error during message handling: ${error.message}`
            : 'Error during message handling',
    middlewareError: ({ event, error }) => {
        const eventName = String(event);
        if (error instanceof Error) {
            return `Error in middleware pipeline for event "${eventName}": ${error.message}`;
        }
        return `Error in middleware pipeline for event "${eventName}"`;
    },
    noInitialPage: () => 'No initial page configured',
    validationFailed: () => 'Incorrect data entered, please try again.',
};

export const DEFAULT_BOT_RUNTIME_MESSAGES: IBotRuntimeMessages = Object.freeze(
    DEFAULT_MESSAGES,
) as IBotRuntimeMessages;

export type BotRuntimeMessageFactory = (
    overrides?: TBotRuntimeMessageOverrides,
) => IBotRuntimeMessages;

export const createBotRuntimeMessages: BotRuntimeMessageFactory = (
    overrides = {},
) => ({
    ...DEFAULT_BOT_RUNTIME_MESSAGES,
    ...overrides,
});
