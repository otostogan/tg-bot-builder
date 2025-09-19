import { ModuleMetadata } from '@nestjs/common';
import type TelegramBot from 'node-telegram-bot-api';
import type { AnySchema } from 'yup';
import type { PrismaService } from './prisma/prisma.service';

export type TPrismaJsonValue =
    | string
    | number
    | boolean
    | null
    | { [key: string]: TPrismaJsonValue | null }
    | (TPrismaJsonValue | null)[];

export interface IPrismaUser {
    id: number;
    telegramId: bigint;
    chatId: string | null;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    languageCode: string | null;
}

export interface IPrismaStepState {
    id: number;
    userId: number;
    chatId: string;
    slug: string;
    currentPage: string | null;
    answers: unknown;
    history: unknown;
}

export type TBotPageIdentifier = string;

export interface IBotSessionState {
    [key: string]: unknown;
}

export interface IBotBuilderContext {
    botId: string;
    bot: TelegramBot;
    chatId: TelegramBot.ChatId;
    message?: TelegramBot.Message;
    metadata?: TelegramBot.Metadata;
    session?: IBotSessionState;
    user?: TelegramBot.User;
    prisma?: PrismaService;
    db?: {
        user?: IPrismaUser;
        stepState?: IPrismaStepState;
    };
    services: Record<string, unknown>;
}

export interface IBotPageContentPayload {
    text: string;
    options?: TelegramBot.SendMessageOptions;
}

export type TBotPageContentResult = string | IBotPageContentPayload;

export type TBotPageContent =
    | TBotPageContentResult
    | ((
          context: IBotBuilderContext,
      ) => TBotPageContentResult | Promise<TBotPageContentResult>);

export type TBotPageOnValid = (
    context: IBotBuilderContext,
) => void | Promise<void>;

export type TBotPageNextResolver = (
    context: IBotBuilderContext,
) =>
    | TBotPageIdentifier
    | null
    | undefined
    | Promise<TBotPageIdentifier | null | undefined>;

export type TBotPageValidateFn = (
    value: unknown,
    context: IBotBuilderContext,
) => boolean | Promise<boolean>;

export interface IBotPage {
    id: TBotPageIdentifier;
    content: TBotPageContent;
    onValid?: TBotPageOnValid;
    next?: TBotPageNextResolver;
    validate?: TBotPageValidateFn;
    yup?: AnySchema;
    middlewares?: TBotPageMiddleware[];
}

export interface IBotPageMiddlewareResult {
    allow: boolean;
    message?: string;
}

export interface IBotPageNavigationOptions {
    message?: TelegramBot.Message;
    metadata?: TelegramBot.Metadata;
    user?: TelegramBot.User;
    state?: IBotSessionState;
    resetState?: boolean;
}

export type TBotPageMiddlewareHandlerResult =
    | void
    | boolean
    | IBotPageMiddlewareResult;

export type TBotPageMiddlewareHandler = (
    context: IBotBuilderContext,
    page: IBotPage,
) => TBotPageMiddlewareHandlerResult | Promise<TBotPageMiddlewareHandlerResult>;

export interface IBotPageMiddlewareConfig {
    name?: string;
    handler: TBotPageMiddlewareHandler;
    priority?: number;
}

export type TBotPageMiddleware = string | IBotPageMiddlewareConfig;

export type TBotKeyboardMarkup =
    | TelegramBot.ReplyKeyboardMarkup
    | TelegramBot.InlineKeyboardMarkup
    | TelegramBot.ReplyKeyboardRemove
    | TelegramBot.ForceReply;

export type TBotKeyboardResolver = (
    context: IBotBuilderContext,
) =>
    | TBotKeyboardMarkup
    | null
    | undefined
    | Promise<TBotKeyboardMarkup | null | undefined>;

export interface IBotKeyboardConfig {
    id: string;
    resolve: TBotKeyboardResolver;
    persistent?: boolean;
}

export interface IBotMiddlewareContext extends IBotBuilderContext {
    event: keyof TelegramBot.TelegramEvents;
    args: unknown[];
}

export type TBotMiddlewareNext = () => Promise<void>;

export type TBotMiddlewareHandler = (
    context: IBotMiddlewareContext,
    next: TBotMiddlewareNext,
) => void | Promise<void>;

export interface IBotMiddlewareConfig {
    name?: string;
    handler: TBotMiddlewareHandler;
    priority?: number;
}

export interface IBotHandler<
    TEvent extends
        keyof TelegramBot.TelegramEvents = keyof TelegramBot.TelegramEvents,
> {
    event: TEvent;
    listener: TelegramBot.TelegramEvents[TEvent];
    middlewares?: IBotMiddlewareConfig[];
}

export interface IBotSessionStorage<TState = IBotSessionState> {
    get(
        chatId: TelegramBot.ChatId,
    ): Promise<TState | undefined> | TState | undefined;
    set(chatId: TelegramBot.ChatId, state: TState): Promise<void> | void;
    delete?(chatId: TelegramBot.ChatId): Promise<void> | void;
}

export interface IBotBuilderOptions {
    TG_BOT_TOKEN: string;
    id?: string;
    pages?: IBotPage[];
    handlers?: IBotHandler[];
    middlewares?: IBotMiddlewareConfig[];
    keyboards?: IBotKeyboardConfig[];
    initialPageId?: TBotPageIdentifier;
    sessionStorage?: IBotSessionStorage;
    prisma?: PrismaService;
    slug?: string;
    services?: Record<string, unknown>;
    pageMiddlewares?: IBotPageMiddlewareConfig[];
}

export interface IBotBuilderModuleAsyncOptions
    extends Pick<ModuleMetadata, 'imports'> {
    useFactory: (
        ...args: any[]
    ) =>
        | Promise<IBotBuilderOptions | IBotBuilderOptions[]>
        | IBotBuilderOptions
        | IBotBuilderOptions[];
    inject?: any[];
}
