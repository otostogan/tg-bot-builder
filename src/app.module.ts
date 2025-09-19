import { DynamicModule, Module, Provider } from '@nestjs/common';
import {
    IBotBuilderModuleAsyncOptions,
    IBotBuilderOptions,
} from './app.interface';
import { BOT_BUILDER_MODULE_OPTIONS } from './app.constants';
import { BuilderService } from './builder/builder.service';
import { PrismaService } from './prisma/prisma.service';
import { IBotRuntimeOptions, normalizeBotOptions } from './builder/bot-runtime';

const BOT_BUILDER_BOTS_REGISTRATION = Symbol('BOT_BUILDER_BOTS_REGISTRATION');

@Module({})
export class BotBuilder {
    static forRootAsync(options: IBotBuilderModuleAsyncOptions): DynamicModule {
        const asyncOptions = this.createAsyncOptionsProvider(options);
        const botsRegistration = this.createBotsRegistrationProvider();

        return {
            module: BotBuilder,
            imports: options.imports ?? [],
            providers: [
                asyncOptions,
                PrismaService,
                BuilderService,
                botsRegistration,
            ],
            exports: [
                BotBuilder,
                BuilderService,
                PrismaService,
                BOT_BUILDER_MODULE_OPTIONS,
            ],
        };
    }

    static forFeature(
        options: IBotBuilderOptions | IBotBuilderOptions[],
    ): DynamicModule {
        const normalized = this.normalizeOptions(options);
        const featureToken = Symbol('BOT_BUILDER_FEATURE_REGISTRATION');
        const featureRegistration: Provider = {
            provide: featureToken,
            useFactory: (builderService: BuilderService) => {
                builderService.registerBots(normalized);
                return true;
            },
            inject: [BuilderService],
        };

        return {
            module: BotBuilder,
            providers: [featureRegistration],
            exports: [BuilderService],
        };
    }

    private static createAsyncOptionsProvider(
        options: IBotBuilderModuleAsyncOptions,
    ): Provider {
        return {
            provide: BOT_BUILDER_MODULE_OPTIONS,
            useFactory: async (...args: any[]) => {
                const resolvedOptions = await options.useFactory(...args);
                return BotBuilder.normalizeOptions(resolvedOptions);
            },
            inject: options.inject || [],
        };
    }

    private static createBotsRegistrationProvider(): Provider {
        return {
            provide: BOT_BUILDER_BOTS_REGISTRATION,
            useFactory: (
                builderService: BuilderService,
                options: IBotRuntimeOptions[],
            ) => {
                builderService.registerBots(options);
                return true;
            },
            inject: [BuilderService, BOT_BUILDER_MODULE_OPTIONS],
        };
    }

    private static normalizeOptions(
        options:
            | IBotBuilderOptions
            | IBotBuilderOptions[]
            | IBotRuntimeOptions
            | IBotRuntimeOptions[],
    ): IBotRuntimeOptions[] {
        const list = Array.isArray(options) ? options : [options];
        return list.map((option, index) => normalizeBotOptions(option, index));
    }
}
