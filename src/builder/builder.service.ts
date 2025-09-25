import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import TelegramBot = require('node-telegram-bot-api');
import { IBotBuilderOptions } from '../app.interface';
import {
    BotRuntime,
    IBotRuntimeOptions,
    normalizeBotOptions,
} from './bot-runtime';
import { BOT_BUILDER_PRISMA } from '../app.constants';
import type { PrismaClient } from '@prisma/client/extension';

@Injectable()
export class BuilderService {
    private logger = new Logger(BuilderService.name);
    private readonly bots = new Map<string, BotRuntime>();
    private readonly botInstances = new Map<string, TelegramBot>();
    private readonly botOptions = new Map<string, IBotRuntimeOptions>();
    private readonly tokenToBotId = new Map<string, string>();

    /**
     * Creates a builder instance that keeps track of registered runtimes and
     * optional Prisma dependencies injected from the Nest container.
     */
    constructor(
        @Optional()
        @Inject(BOT_BUILDER_PRISMA)
        private readonly prismaService?: PrismaClient,
    ) {}

    /**
     * Registers one or multiple bots described by the given options and returns
     * the resolved bot identifiers in registration order.
     */
    public registerBots(
        options: IBotBuilderOptions | IBotBuilderOptions[] = [],
    ): string[] {
        const list = Array.isArray(options) ? options : [options];
        return list.map((option, index) => this.registerBot(option, index));
    }

    /**
     * Normalizes builder options for a single bot and registers the
     * corresponding runtime instance.
     */
    public registerBot(options: IBotBuilderOptions, index?: number): string {
        const normalized = normalizeBotOptions(options, index);
        return this.registerNormalizedBot(normalized);
    }

    /**
     * Registers a bot runtime using already normalized options, replacing any
     * previously running runtime that shares the same id or token.
     */
    public registerNormalizedBot(options: IBotRuntimeOptions): string {
        const botId = options.id;

        const existingById = this.bots.get(botId);
        if (existingById) {
            this.logger.warn(
                `Bot with id "${botId}" already registered. Replacing instance.`,
            );
            this.removeBot(botId);
        }

        const existingByToken = this.tokenToBotId.get(options.TG_BOT_TOKEN);
        if (existingByToken && existingByToken !== botId) {
            this.logger.warn(
                `Bot token already in use by "${existingByToken}". Replacing the existing bot.`,
            );
            this.removeBot(existingByToken);
        }

        const runtime = new BotRuntime(
            options,
            this.logger,
            this.prismaService,
        );
        this.bots.set(botId, runtime);
        this.botInstances.set(botId, runtime.bot);
        this.botOptions.set(botId, options);
        this.tokenToBotId.set(runtime.token, botId);

        return botId;
    }

    /**
     * Returns shallow clones of the runtime options for every registered bot,
     * preserving array references to avoid accidental external mutations.
     */
    public listRegisteredBots(): IBotRuntimeOptions[] {
        return Array.from(this.botOptions.values()).map((options) =>
            this.cloneRuntimeOptions(options),
        );
    }

    /**
     * Retrieves a cloned snapshot of the runtime options for the requested bot
     * id, or undefined when the bot is not registered.
     */
    public getBotOptions(botId: string): IBotRuntimeOptions | undefined {
        const options = this.botOptions.get(botId);
        return options ? this.cloneRuntimeOptions(options) : undefined;
    }

    /**
     * Returns the Telegram runtime bound to the provided bot identifier if it
     * is currently active.
     */
    public getBotRuntime(botId: string): BotRuntime | undefined {
        return this.bots.get(botId);
    }

    /**
     * Exposes the live Telegram bot instance associated with the identifier so
     * callers can invoke node-telegram-bot-api methods directly.
     */
    public getBotInstance(botId: string): TelegramBot | undefined {
        return this.botInstances.get(botId);
    }

    /**
     * Lists the identifiers for all currently registered bot runtimes.
     */
    public getRegisteredBotIds(): string[] {
        return Array.from(this.bots.keys());
    }

    /**
     * Stops and removes the runtime associated with the provided bot id if it
     * is currently registered.
     */
    private removeBot(botId: string): void {
        const runtime = this.bots.get(botId);
        if (!runtime) {
            return;
        }

        this.detachBot(botId, runtime);

        try {
            void runtime.bot.stopPolling();
        } catch (error) {
            const message =
                error instanceof Error
                    ? `Failed to stop polling for bot "${botId}": ${error.message}`
                    : `Failed to stop polling for bot "${botId}"`;
            this.logger.warn(message);
        }
    }

    /**
     * Cleans internal caches and token associations for the specified bot
     * runtime.
     */
    private detachBot(botId: string, runtime: BotRuntime): void {
        const options = this.botOptions.get(botId);
        const token = options?.TG_BOT_TOKEN ?? runtime.token;

        this.bots.delete(botId);
        this.botInstances.delete(botId);
        this.botOptions.delete(botId);

        this.clearTokenMapping(token, botId);
    }

    /**
     * Removes the token-to-bot mapping when it is no longer associated with the
     * provided bot id.
     */
    private clearTokenMapping(token?: string, botId?: string): void {
        if (!token) {
            return;
        }

        if (botId) {
            const registeredBotId = this.tokenToBotId.get(token);
            if (registeredBotId !== botId) {
                return;
            }
        }

        this.tokenToBotId.delete(token);
    }

    private cloneRuntimeOptions(
        options: IBotRuntimeOptions,
    ): IBotRuntimeOptions {
        return {
            ...options,
            pages: [...(options.pages ?? [])],
            handlers: [...(options.handlers ?? [])],
            middlewares: [...(options.middlewares ?? [])],
            keyboards: [...(options.keyboards ?? [])],
            services: { ...(options.services ?? {}) },
            pageMiddlewares: [...(options.pageMiddlewares ?? [])],
            dependencies: options.dependencies
                ? { ...options.dependencies }
                : undefined,
        };
    }
}
