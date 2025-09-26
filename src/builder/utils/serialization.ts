export interface IStepHistoryEntry<T = unknown> {
    pageId: string;
    timestamp: string;
    value: T | T[];
}

/**
 * Converts arbitrary values into a Prisma JSON-friendly representation while
 * preserving nested structures.
 */
export const serializeValue = <
    T extends string | number | boolean | null | object | unknown[],
>(
    value: unknown,
    nullValue: T,
): T | Extract<T, object> | Extract<T, unknown[]> => {
    if (value === undefined || value === null) {
        return nullValue;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value as T;
    }

    if (typeof value === 'bigint') {
        return value.toString() as T;
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeValue(item, nullValue)) as Extract<
            T,
            unknown[]
        >;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        const normalized: Record<string, T> = {};
        for (const [key, item] of entries) {
            normalized[key] = serializeValue(item, nullValue);
        }
        return normalized as Extract<T, object>;
    }

    return nullValue;
};

/**
 * Produces a shallow copy of stored answers, ensuring the result is a record
 * even when invalid data is received.
 */
export const normalizeAnswers = <T>(answers: unknown, nullValue: T) => {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
        return {};
    }

    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(
        answers as Record<string, unknown>,
    )) {
        result[key] = (value as T) ?? nullValue;
    }

    return result;
};

/**
 * Cleans up persisted history entries to a predictable shape and re-serializes
 * nested values.
 */
export const normalizeHistory = <T>(
    history: unknown,
    nullValue: T,
): IStepHistoryEntry<T>[] => {
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
                // @ts-expect-error - TS2322: Type 'unknown' is not assignable to type 'T | T[]'.
                value: serializeValue<T>(entry.value, nullValue),
            };
        });
};
