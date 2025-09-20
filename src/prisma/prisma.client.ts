export type PrismaClientOptions = Record<string, unknown> & {
    datasources?: Record<string, { url?: string }>;
    datasourceUrl?: string;
};

export type PrismaDelegate = {
    [method: string]: (...args: any[]) => Promise<unknown>;
};

export interface IPrismaClient {
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $executeRawUnsafe(query: string, ...params: unknown[]): Promise<unknown>;
    user: PrismaDelegate;
    stepState: PrismaDelegate;
    formEntry: PrismaDelegate;
    [key: string]: unknown;
}

export type PrismaClientConstructor = new (
    options?: PrismaClientOptions,
) => IPrismaClient;

let cachedConstructor: PrismaClientConstructor | null | undefined;

export function getPrismaClientConstructor(): PrismaClientConstructor | null {
    if (cachedConstructor !== undefined) {
        return cachedConstructor;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const prismaModule = require('@prisma/client');
        const PrismaClient = prismaModule?.PrismaClient;

        if (typeof PrismaClient === 'function') {
            cachedConstructor = PrismaClient as PrismaClientConstructor;
        } else {
            cachedConstructor = null;
        }
    } catch (error) {
        cachedConstructor = null;
    }

    return cachedConstructor;
}

export function assertPrismaClientConstructor(): PrismaClientConstructor {
    const PrismaClient = getPrismaClientConstructor();
    if (!PrismaClient) {
        throw new Error(
            'PrismaClient is not available. Ensure @prisma/client is installed and prisma generate has been executed in the consuming project.',
        );
    }

    return PrismaClient;
}

export function isPrismaClient(value: unknown): value is IPrismaClient {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as IPrismaClient).$connect === 'function' &&
        typeof (value as IPrismaClient).$disconnect === 'function'
    );
}
