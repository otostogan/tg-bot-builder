import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { IBotBuilderModuleAsyncOptions, IBotBuilderOptions } from './app.interface';
import { BOT_BUILDER_MODULE_OPTIONS } from './app.constants';
import { BuilderService } from './builder/builder.service';

@Global()
@Module({})
export class BotBuilder {
    static forRootAsync(options: IBotBuilderModuleAsyncOptions): DynamicModule {
        const asyncOptions = this.createAsyncOptionsProvider(options);

        return {
            module: BotBuilder,
            imports: options.imports ?? [],
            providers: [asyncOptions, BuilderService],
            exports: [BotBuilder, BuilderService, BOT_BUILDER_MODULE_OPTIONS],
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

    private static normalizeOptions(options: IBotBuilderOptions): IBotBuilderOptions {
        return {
            ...options,
            pages: options.pages ?? [],
            handlers: options.handlers ?? [],
            middlewares: options.middlewares ?? [],
            keyboards: options.keyboards ?? [],
        };
    }
}
