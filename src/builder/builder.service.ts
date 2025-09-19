import { Inject, Injectable } from '@nestjs/common';
import { BOT_BUILDER_MODULE_OPTIONS } from '../app.constants';
import { IBotBuilderOptions } from '../app.interface';
import { PublisherService } from 'otostogan-nest-logger';
import TelegramBot = require('node-telegram-bot-api');

@Injectable()
export class BuilderService {
    public TG_BOT_TOKEN: string;
    public TG_BOT: TelegramBot;

    constructor(
        @Inject(BOT_BUILDER_MODULE_OPTIONS) options: IBotBuilderOptions,
        private readonly logger: PublisherService,
    ) {
        this.TG_BOT_TOKEN = options.TG_BOT_TOKEN;
        this.TG_BOT = new TelegramBot(this.TG_BOT_TOKEN, { polling: true });
        this.logger.info('BotBuilder initialized');
    }
}
