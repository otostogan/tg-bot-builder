export class PrismaClient {
    user = {
        upsert: jest.fn().mockResolvedValue(undefined),
    };

    stepState = {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
    };

    formEntry = {
        upsert: jest.fn().mockResolvedValue(undefined),
    };

    async $connect(): Promise<void> {
        return Promise.resolve();
    }

    async $disconnect(): Promise<void> {
        return Promise.resolve();
    }
}
