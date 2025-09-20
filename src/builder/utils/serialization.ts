import { TPrismaJsonValue } from '../../app.interface';

export interface IStepHistoryEntry {
    pageId: string;
    value: TPrismaJsonValue | null;
    timestamp: string;
}

export const serializeValue = (value: unknown): TPrismaJsonValue | null => {
    if (value === undefined) {
        return null;
    }

    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value as TPrismaJsonValue;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeValue(item)) as TPrismaJsonValue;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        const normalized: Record<string, TPrismaJsonValue | null> = {};
        for (const [key, item] of entries) {
            normalized[key] = serializeValue(item);
        }
        return normalized as TPrismaJsonValue;
    }

    return null;
};

export const normalizeAnswers = (
    answers: unknown,
): Record<string, TPrismaJsonValue | null> => {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return {};
    }

    return {
        ...(answers as Record<string, TPrismaJsonValue | null>),
    };
};

export const normalizeHistory = (history: unknown): IStepHistoryEntry[] => {
    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .map((entry) =>
            typeof entry === 'object' && entry !== null
                ? (entry as Record<string, unknown>)
                : undefined,
        )
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => {
            const pageIdValue = entry.pageId;
            const timestampValue = entry.timestamp;

            const pageId =
                typeof pageIdValue === 'string'
                    ? pageIdValue
                    : String(pageIdValue ?? '');
            const timestamp =
                typeof timestampValue === 'string'
                    ? timestampValue
                    : new Date().toISOString();

            return {
                pageId,
                timestamp,
                value: serializeValue(entry.value),
            };
        });
};
