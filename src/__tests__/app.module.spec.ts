import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PublisherService } from 'otostogan-nest-logger';
import { BotBuilder } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { BuilderService } from '../builder/builder.service';

jest.mock('node-telegram-bot-api', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        sendMessage: jest.fn().mockResolvedValue(undefined),
        stopPolling: jest.fn().mockResolvedValue(undefined),
    }));
});

const loggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

@Global()
@Module({
    providers: [
        {
            provide: PublisherService,
            useValue: loggerMock,
        },
    ],
    exports: [PublisherService],
})
class LoggerMockModule {}

describe('BotBuilder module', () => {
    it('creates module without explicit imports', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                LoggerMockModule,
                BotBuilder.forRootAsync({
                    useFactory: async () => ({
                        TG_BOT_TOKEN: 'test-token',
                    }),
                }),
            ],
        })
            .overrideProvider(PrismaService)
            .useValue({
                $connect: jest.fn(),
                $disconnect: jest.fn(),
            })
            .compile();

        expect(moduleRef).toBeDefined();
        expect(moduleRef.get(BuilderService)).toBeInstanceOf(BuilderService);

        await moduleRef.close();
    });
});
