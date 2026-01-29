const userLocks: Map<string, Promise<void>> = new Map();

export async function acquireLock(key: string): Promise<() => void> {
    while (userLocks.has(key)) {
        const p = userLocks.get(key);
        try {
            await p;
        } catch (e) {
            console.error('Previous lock promise rejected for key', key, e);
        }
    }

    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
        resolveLock = resolve;
    });

    userLocks.set(key, lockPromise);

    return () => {
        try {
            resolveLock();
        } catch (e) {
            console.error('Error resolving lock for key', key, e);
        } finally {
            if (userLocks.get(key) === lockPromise) userLocks.delete(key);
        }
    };
};

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (userLocks.has(key)) {
        try {
            await userLocks.get(key);
        } catch { }
    }

    let resolve!: () => void;
    const p = new Promise<void>(r => (resolve = r));
    userLocks.set(key, p);

    try {
        return await fn();
    } finally {
        userLocks.delete(key);
        resolve();
    }
    ;
};
