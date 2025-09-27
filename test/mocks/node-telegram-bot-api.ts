import type { TelegramEvents } from 'node-telegram-bot-api';

type EventKey = keyof TelegramEvents;

type EventListener<TEvent extends EventKey> = TelegramEvents[TEvent];

export class NodeTelegramBotApiMock {
    public readonly token: string;
    public readonly options?: Record<string, unknown>;

    public on = jest.fn(
        <TEvent extends EventKey>(
            event: TEvent,
            listener: EventListener<TEvent>,
        ) => {
            return this;
        },
    );

    public sendMessage = jest.fn(async () => undefined);

    public stopPolling = jest.fn(async () => undefined);

    constructor(token: string, options?: Record<string, unknown>) {
        this.token = token;
        this.options = options;
    }
}
export default NodeTelegramBotApiMock;
