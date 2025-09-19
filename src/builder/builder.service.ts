import { Injectable } from '@nestjs/common';
import TelegramBot = require('node-telegram-bot-api');
import { PublisherService } from 'otostogan-nest-logger';
import {
    IBotBuilderOptions,
    IBotPage,
    IBotPageNavigationOptions,
    TBotPageIdentifier,
} from '../app.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
    BotRuntime,
    IBotRuntimeOptions,
    normalizeBotOptions,
} from './bot-runtime';

@Injectable()
export class BuilderService {
    private readonly bots = new Map<string, BotRuntime>();
    private readonly botInstances = new Map<string, TelegramBot>();
    private readonly botOptions = new Map<string, IBotRuntimeOptions>();
    private readonly tokenToBotId = new Map<string, string>();

    constructor(
        private readonly logger: PublisherService,
        private readonly prismaService: PrismaService,
    ) {}

    public registerBots(
        options: IBotBuilderOptions | IBotBuilderOptions[] = [],
    ): string[] {
        const list = Array.isArray(options) ? options : [options];
        return list.map((option, index) => this.registerBot(option, index));
    }

    public registerBot(
        options: IBotBuilderOptions,
        index?: number,
    ): string {
        const normalized = normalizeBotOptions(options, index);
        return this.registerNormalizedBot(normalized);
    }

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

        const runtime = new BotRuntime(options, this.logger, this.prismaService);
        this.bots.set(botId, runtime);
        this.botInstances.set(botId, runtime.bot);
        this.botOptions.set(botId, options);
        this.tokenToBotId.set(runtime.token, botId);

        return botId;
    }

    public getBot(botId: string): TelegramBot | undefined {
        return this.botInstances.get(botId);
    }

    public getBotIdByToken(token: string): string | undefined {
        return this.tokenToBotId.get(token);
    }

    public getRegisteredBotIds(): string[] {
        return [...this.bots.keys()];
    }

    public getOptions(botId: string): IBotRuntimeOptions | undefined {
        const options = this.botOptions.get(botId);
        return options ? { ...options } : undefined;
    }

    public getAllOptions(): IBotRuntimeOptions[] {
        return [...this.botOptions.values()].map((options) => ({ ...options }));
    }

    public registerPages(botId: string, pages: IBotPage[]): void {
        const runtime = this.bots.get(botId);
        if (!runtime) {
            this.logger.warn(
                `Attempted to register pages for unknown bot "${botId}"`,
            );
            return;
        }

        runtime.registerPages(pages);
    }

    public async goToPage(
        botId: string,
        chatId: TelegramBot.ChatId,
        pageId: TBotPageIdentifier,
        options?: IBotPageNavigationOptions,
    ): Promise<void> {
        const runtime = this.bots.get(botId);
        if (!runtime) {
            this.logger.warn(
                `Cannot navigate to page "${pageId}". Bot "${botId}" is not registered.`,
            );
            return;
        }

        await runtime.goToPage(chatId, pageId, options);
    }

    public async goToInitialPage(
        botId: string,
        chatId: TelegramBot.ChatId,
        options?: IBotPageNavigationOptions,
    ): Promise<void> {
        const runtime = this.bots.get(botId);
        if (!runtime) {
            this.logger.warn(
                `Cannot navigate to initial page. Bot "${botId}" is not registered.`,
            );
            return;
        }

        await runtime.goToInitialPage(chatId, options);
    }

    private removeBot(botId: string): void {
        const runtime = this.bots.get(botId);
        if (!runtime) {
            return;
        }

        this.bots.delete(botId);
        this.botInstances.delete(botId);
        this.botOptions.delete(botId);

        for (const [token, registeredBotId] of this.tokenToBotId.entries()) {
            if (registeredBotId === botId) {
                this.tokenToBotId.delete(token);
            }
        }

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
}
