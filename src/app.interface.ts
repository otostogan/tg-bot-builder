import { ModuleMetadata } from '@nestjs/common';

export interface IBotBuilderOptions {
    TG_BOT_TOKEN: string;
}

export interface IBotBuilderModuleAsyncOptions
    extends Pick<ModuleMetadata, 'imports'> {
    useFactory: (
        ...args: any[]
    ) => Promise<IBotBuilderOptions> | IBotBuilderOptions;
    inject?: any[];
}
