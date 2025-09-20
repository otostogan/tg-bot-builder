import { Module } from '@nestjs/common';
import { BotBuilder } from '../';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createUrbanMarketBot } from './urban-market.bot';

@Module({
    imports: [
        ConfigModule.forRoot({
            envFilePath: `.env`,
            isGlobal: true,
        }),
        BotBuilder.forRootAsync({
            inject: [ConfigService],
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => {
                const token = configService.get<string>('TG_BOT_TOKEN');
                if (!token) {
                    throw new Error(
                        'TG_BOT_TOKEN is not configured for the dev bot.',
                    );
                }

                return createUrbanMarketBot(token);
            },
        }),
    ],
})
export class DevModule {}
