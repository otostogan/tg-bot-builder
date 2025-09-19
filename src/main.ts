import { NestFactory } from '@nestjs/core';
import { DevModule } from './dev/dev.module';
import { Logger } from '@nestjs/common';

export async function bootstrap() {
    return NestFactory.create(DevModule);
}

if (require.main === module) {
    bootstrap().catch((err) => {
        Logger.error('Failed to start application', err);
        process.exit(1);
    });
}
