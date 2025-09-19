declare module '@prisma/client' {
    export class PrismaClient {
        $connect(): Promise<void>;
        $disconnect(): Promise<void>;
        user: {
            upsert(args: unknown): Promise<unknown>;
        };
        stepState: {
            findUnique(args: unknown): Promise<unknown>;
            create(args: unknown): Promise<unknown>;
            update(args: unknown): Promise<unknown>;
        };
        formEntry: {
            upsert(args: unknown): Promise<unknown>;
        };
    }
}
