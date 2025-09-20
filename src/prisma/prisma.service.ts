import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
    PrismaClientConstructor,
    getPrismaClientConstructor,
} from './prisma.client';

const PrismaClient = (
    getPrismaClientConstructor() ??
    (class PrismaClientUnavailable {
        constructor() {
            throw new Error(
                'PrismaClient is not available. Install @prisma/client, run prisma generate, or disable PrismaService registration.',
            );
        }

        async $disconnect(): Promise<void> {
            // no-op fallback
        }
    })
) as PrismaClientConstructor;

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleDestroy
{
    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
    }
}
