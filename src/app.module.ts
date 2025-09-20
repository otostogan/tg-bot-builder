import { DynamicModule, Module, Provider } from '@nestjs/common';
import {
    IBotBuilderModuleAsyncOptions,
    IBotBuilderOptions,
} from './app.interface';
import {
    BOT_BUILDER_MODULE_OPTIONS,
    BOT_BUILDER_PRISMA,
} from './app.constants';
import { BuilderService } from './builder/builder.service';
import { IBotRuntimeOptions, normalizeBotOptions } from './builder/bot-runtime';

const BOT_BUILDER_BOTS_REGISTRATION = Symbol('BOT_BUILDER_BOTS_REGISTRATION');

@Module({})
export class BotBuilder {
    /**
     * Configures the builder module for asynchronous initialization, wiring
     * factories that register bots once dependencies resolve.
     */
    static forRootAsync(options: IBotBuilderModuleAsyncOptions): DynamicModule {
        const asyncOptions = this.createAsyncOptionsProvider(options);
        const botsRegistration = this.createBotsRegistrationProvider();
        const prismaProvider = this.createPrismaProvider();

        return {
            module: BotBuilder,
            imports: options.imports ?? [],
            providers: [
                asyncOptions,
                BuilderService,
                botsRegistration,
                prismaProvider,
            ],
            exports: [
                BotBuilder,
                BuilderService,
                BOT_BUILDER_MODULE_OPTIONS,
                BOT_BUILDER_PRISMA,
            ],
        };
    }

    /**
     * Registers additional bot configurations in feature modules using the
     * shared builder service.
     */
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

    /**
     * Creates a provider that resolves module options through the consumer's
     * asynchronous factory.
     */
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

    /**
     * Sets up a provider responsible for bootstrapping bot runtimes once the
     * builder service and configuration are available.
     */
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

    /**
     * Supplies the Prisma client from whichever bot configuration declares it,
     * allowing downstream injections to reuse the instance.
     */
    private static createPrismaProvider(): Provider {
        return {
            provide: BOT_BUILDER_PRISMA,
            useFactory: (options: IBotRuntimeOptions[]) =>
                options.find((option) => option.prisma)?.prisma,
            inject: [BOT_BUILDER_MODULE_OPTIONS],
        };
    }

    /**
     * Normalizes incoming builder options, accepting both builder and runtime
     * shapes while ensuring each entry has resolved defaults.
     */
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
