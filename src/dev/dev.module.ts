import { Module } from '@nestjs/common';
import { BotBuilder } from '../';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as process from 'node:process';
import { LogModule } from 'otostogan-nest-logger';
import { BOT_BUILDER_MODULE_OPTIONS } from '../app.constants';

@Module({
    imports: [
        ConfigModule.forRoot({
            envFilePath: `.env`,
            isGlobal: true,
        }),
        BotBuilder.forRootAsync({
            inject: [ConfigService],
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
                TG_BOT_TOKEN: configService.get('TG_BOT_TOKEN'),
            }),
        }),
        LogModule.forRootAsync({
            inject: [BOT_BUILDER_MODULE_OPTIONS],
            useFactory: () => ({
                APP_NAME: 'BotBuilder',
                LOG_PATH: `${process.cwd()}/publisher`,
            }),
        }),
    ],
})
export class DevModule {}
