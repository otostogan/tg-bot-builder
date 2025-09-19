import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import {
    IBotBuilderModuleAsyncOptions,
    IBotBuilderOptions,
} from './app.interface';
import { BOT_BUILDER_MODULE_OPTIONS } from './app.constants';
import { BuilderService } from './builder/builder.service';
import { PrismaService } from './prisma/prisma.service';

const BOT_BUILDER_PAGES_REGISTRATION = Symbol('BOT_BUILDER_PAGES_REGISTRATION');

@Global()
@Module({})
export class BotBuilder {
    static forRootAsync(options: IBotBuilderModuleAsyncOptions): DynamicModule {
        const asyncOptions = this.createAsyncOptionsProvider(options);
        const pagesRegistration = this.createPagesRegistrationProvider();

        return {
            module: BotBuilder,
            imports: options.imports ?? [],
            providers: [
                asyncOptions,
                PrismaService,
                BuilderService,
                pagesRegistration,
            ],
            exports: [
                BotBuilder,
                BuilderService,
                PrismaService,
                BOT_BUILDER_MODULE_OPTIONS,
            ],
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

    private static createPagesRegistrationProvider(): Provider {
        return {
            provide: BOT_BUILDER_PAGES_REGISTRATION,
            useFactory: (
                builderService: BuilderService,
                options: IBotBuilderOptions,
            ) => {
                builderService.registerPages(options.pages ?? []);
                return true;
            },
            inject: [BuilderService, BOT_BUILDER_MODULE_OPTIONS],
        };
    }

    private static normalizeOptions(
        options: IBotBuilderOptions,
    ): IBotBuilderOptions {
        return {
            ...options,
            pages: options.pages ?? [],
            handlers: options.handlers ?? [],
            middlewares: options.middlewares ?? [],
            keyboards: options.keyboards ?? [],
            services: options.services ?? {},
            pageMiddlewares: options.pageMiddlewares ?? [],
            slug: options.slug ?? 'default',
        };
    }
}
