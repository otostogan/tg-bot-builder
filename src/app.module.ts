import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { IBotBuilderModuleAsyncOptions } from './app.interface';
import { BOT_BUILDER_MODULE_OPTIONS } from './app.constants';
import { BuilderService } from './builder/builder.service';

@Global()
@Module({})
export class BotBuilder {
    static forRootAsync(options: IBotBuilderModuleAsyncOptions): DynamicModule {
        const asyncOptions = this.createAsyncOptionsProvider(options);

        return {
            module: BotBuilder,
            imports: [...options.imports],
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
                return options.useFactory(...args);
            },
            inject: options.inject || [],
        };
    }
}
