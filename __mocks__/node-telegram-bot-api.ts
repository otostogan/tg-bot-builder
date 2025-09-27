import NodeTelegramBotApiMock from '../test/mocks/node-telegram-bot-api';

type MockClass = typeof NodeTelegramBotApiMock & {
  default?: typeof NodeTelegramBotApiMock;
};

const mockClass: MockClass = NodeTelegramBotApiMock;
mockClass.default = NodeTelegramBotApiMock;

export = mockClass;
