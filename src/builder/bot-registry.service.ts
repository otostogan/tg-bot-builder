import { Injectable } from '@nestjs/common';
import TelegramBot = require('node-telegram-bot-api');
import { IBotRegistryMetadata } from '../app.interface';
import { BotRuntime, IBotRuntimeOptions } from './bot-runtime';
import { BuilderService } from './builder.service';

@Injectable()
export class BotRegistryService {
    constructor(private readonly builderService: BuilderService) {}

    /**
     * Returns metadata describing every registered bot runtime so consumers can
     * surface diagnostic or administrative views.
     */
    public listBots(): IBotRegistryMetadata[] {
        return this.builderService
            .listRegisteredBots()
            .map((options) => this.createMetadata(options));
    }

    /**
     * Resolves metadata for a specific bot identifier, or undefined when the
     * bot has not been registered.
     */
    public getBotMetadata(botId: string): IBotRegistryMetadata | undefined {
        const options = this.builderService.getBotOptions(botId);
        return options ? this.createMetadata(options) : undefined;
    }

    /**
     * Provides direct access to the Telegram client for the requested bot so
     * callers can send broadcasts or perform advanced operations.
     */
    public getTelegramBot(botId: string): TelegramBot | undefined {
        return this.builderService.getBotInstance(botId);
    }

    /**
     * Returns the underlying runtime if it is currently active, exposing
     * helper services and state inspectors.
     */
    public getRuntime(botId: string): BotRuntime | undefined {
        return this.builderService.getBotRuntime(botId);
    }

    private createMetadata(options: IBotRuntimeOptions): IBotRegistryMetadata {
        return {
            id: options.id,
            slug: options.slug,
            tokenPreview: this.obfuscateToken(options.TG_BOT_TOKEN),
            pages: options.pages?.length ?? 0,
            handlers: options.handlers?.length ?? 0,
            middlewares: options.middlewares?.length ?? 0,
            pageMiddlewares: options.pageMiddlewares?.length ?? 0,
            keyboards: options.keyboards?.length ?? 0,
            services: Object.keys(options.services ?? {}),
            hasPersistence: Boolean(options.prisma),
            hasCustomSessionStorage: Boolean(options.sessionStorage),
            respondToGroupMessages: options.respondToGroupMessages,
        };
    }

    private obfuscateToken(token?: string): string | undefined {
        if (!token) {
            return undefined;
        }

        if (token.length <= 4) {
            return token;
        }

        if (token.length <= 8) {
            return `${token.slice(0, 2)}…${token.slice(-2)}`;
        }

        return `${token.slice(0, 4)}…${token.slice(-4)}`;
    }
}
