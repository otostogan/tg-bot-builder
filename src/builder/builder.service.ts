import { Inject, Injectable, Optional } from '@nestjs/common';
import TelegramBot = require('node-telegram-bot-api');
import { PublisherService } from 'otostogan-nest-logger';
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
    private readonly bots = new Map<string, BotRuntime>();
    private readonly botInstances = new Map<string, TelegramBot>();
    private readonly botOptions = new Map<string, IBotRuntimeOptions>();
    private readonly tokenToBotId = new Map<string, string>();

    constructor(
        private readonly logger: PublisherService,
        @Optional()
        @Inject(BOT_BUILDER_PRISMA)
        private readonly prismaService?: PrismaClient,
    ) {}

    public registerBots(
        options: IBotBuilderOptions | IBotBuilderOptions[] = [],
    ): string[] {
        const list = Array.isArray(options) ? options : [options];
        return list.map((option, index) => this.registerBot(option, index));
    }

    public registerBot(options: IBotBuilderOptions, index?: number): string {
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

    private detachBot(botId: string, runtime: BotRuntime): void {
        const options = this.botOptions.get(botId);
        const token = options?.TG_BOT_TOKEN ?? runtime.token;

        this.bots.delete(botId);
        this.botInstances.delete(botId);
        this.botOptions.delete(botId);

        this.clearTokenMapping(token, botId);
    }

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
}
