import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import {
    IStepHistoryEntry,
    normalizeAnswers,
    normalizeHistory,
    serializeValue,
} from '../serialization';

describe('serializeValue', () => {
    it('returns null for undefined', () => {
        expect(serializeValue(undefined)).toBeNull();
    });

    it('serializes primitives and bigint', () => {
        expect(serializeValue('text')).toBe('text');
        expect(serializeValue(42)).toBe(42);
        expect(serializeValue(true)).toBe(true);
        expect(serializeValue(null)).toBeNull();
        expect(serializeValue(10n)).toBe('10');
    });

    it('serializes nested arrays and objects', () => {
        expect(
            serializeValue({
                nested: ['value', 1n, { empty: undefined, list: [false, 3] }],
            }),
        ).toEqual({
            nested: ['value', '1', { empty: null, list: [false, 3] }],
        });
    });

    it('returns null for unsupported values', () => {
        expect(serializeValue(Symbol('test'))).toBeNull();
    });
});

describe('normalizeAnswers', () => {
    it('creates a shallow clone of valid answers', () => {
        const original = { page: 'value', another: null };
        const normalized = normalizeAnswers(original);

        expect(normalized).toEqual(original);
        expect(normalized).not.toBe(original);
    });

    it('returns empty object for non-record inputs', () => {
        expect(normalizeAnswers(null)).toEqual({});
        expect(normalizeAnswers(undefined)).toEqual({});
        expect(normalizeAnswers(['array'])).toEqual({});
    });
});

describe('normalizeHistory', () => {
    const fixedDate = new Date('2024-12-24T12:00:00.000Z');

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(fixedDate);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('filters invalid entries and serializes payloads', () => {
        const history = normalizeHistory([
            null,
            {
                pageId: 123,
                timestamp: 456,
                value: { nested: [1, 2n, undefined] },
            },
            {
                pageId: 'page-two',
                timestamp: '2020-01-01T00:00:00.000Z',
                value: ['text'],
            },
        ]);

        const expected: IStepHistoryEntry[] = [
            {
                pageId: '123',
                timestamp: fixedDate.toISOString(),
                value: { nested: [1, '2', null] },
            },
            {
                pageId: 'page-two',
                timestamp: '2020-01-01T00:00:00.000Z',
                value: ['text'],
            },
        ];

        expect(history).toEqual(expected);
    });

    it('returns empty array for non-array inputs', () => {
        expect(normalizeHistory(undefined)).toEqual([]);
        expect(normalizeHistory({})).toEqual([]);
    });
});
