import {
    IBotMiddlewareConfig,
    IBotMiddlewareContext,
} from '../../app.interface';

export interface BuildMiddlewarePipelineOptions<TArgs extends unknown[]> {
    event: IBotMiddlewareContext['event'];
    handler: (...args: TArgs) => void | Promise<void>;
    middlewares?: IBotMiddlewareConfig[];
    contextFactory: (
        event: IBotMiddlewareContext['event'],
        args: TArgs,
    ) => IBotMiddlewareContext | Promise<IBotMiddlewareContext>;
    onError?: (error: unknown) => void;
}

/**
 * Returns a new list of middleware configs sorted by descending priority so
 * higher-priority entries execute earlier.
 */
export const sortMiddlewareConfigs = <T extends { priority?: number }>(
    middlewares: T[] = [],
): T[] =>
    [...middlewares].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

/**
 * Merges global and handler-level middleware configurations while preserving
 * relative priority ordering between both sources.
 */
export const mergeMiddlewareConfigs = (
    globalMiddlewares: IBotMiddlewareConfig[] = [],
    handlerMiddlewares: IBotMiddlewareConfig[] = [],
): IBotMiddlewareConfig[] => {
    if (globalMiddlewares.length === 0) {
        return [...handlerMiddlewares];
    }

    if (handlerMiddlewares.length === 0) {
        return [...globalMiddlewares];
    }

    const result: IBotMiddlewareConfig[] = [];
    let globalIndex = 0;
    let handlerIndex = 0;

    while (
        globalIndex < globalMiddlewares.length ||
        handlerIndex < handlerMiddlewares.length
    ) {
        const global = globalMiddlewares[globalIndex];
        const handler = handlerMiddlewares[handlerIndex];

        if (handler === undefined) {
            if (global !== undefined) {
                result.push(global);
                globalIndex += 1;
            }
            continue;
        }

        if (global === undefined) {
            result.push(handler);
            handlerIndex += 1;
            continue;
        }

        if ((global.priority ?? 0) >= (handler.priority ?? 0)) {
            result.push(global);
            globalIndex += 1;
        } else {
            result.push(handler);
            handlerIndex += 1;
        }
    }

    return result;
};

/**
 * Builds an executable pipeline that invokes configured middlewares before the
 * target handler, propagating a shared context and error hook.
 */
export const buildMiddlewarePipeline = <TArgs extends unknown[]>(
    options: BuildMiddlewarePipelineOptions<TArgs>,
) => {
    const sorted = sortMiddlewareConfigs(options.middlewares);

    return async (...args: TArgs): Promise<void> => {
        const context = await options.contextFactory(options.event, args);

        const execute = async (index: number): Promise<void> => {
            if (index >= sorted.length) {
                await options.handler(...args);
                return;
            }

            const current = sorted[index];
            if (!current) {
                await execute(index + 1);
                return;
            }

            let called = false;

            const next = async () => {
                if (called) {
                    return;
                }
                called = true;
                await execute(index + 1);
            };

            await current.handler(context, next);
        };

        try {
            await execute(0);
        } catch (error) {
            if (options.onError) {
                options.onError(error);
            }

            throw error;
        }
    };
};
