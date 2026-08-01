/**
 * On-device persistence for the room being worked on.
 *
 * Nothing is uploaded anywhere, so this is the only copy — it is what makes
 * "come back tomorrow and your room is still there" work without an account.
 *
 * localStorage would not do: it holds a few megabytes of strings, and a single
 * room photo exceeds that. IndexedDB stores the pixel buffers directly.
 */

const DB_NAME = "wallcast";
const DB_VERSION = 1;
const STORE = "rooms";
const CURRENT = "current";

export interface StoredRoom {
  photo: { data: Uint8ClampedArray; width: number; height: number };
  /** One byte per pixel, non-zero = wall. Null before a selection exists. */
  mask: Uint8Array | null;
  topColorId: number | null;
  bottomColorId: number | null;
  splitPosition: number;
  straighten: number;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Storage is a convenience, never a correctness requirement — private-mode
 * browsers and quota-exhausted profiles both reject writes, and the app has to
 * keep working when they do.
 */
export async function saveRoom(room: StoredRoom): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(room, CURRENT));
  } catch {
    // Ignored on purpose: the session in memory is still perfectly usable.
  }
}

export async function loadRoom(): Promise<StoredRoom | null> {
  try {
    const room = await withStore<StoredRoom | undefined>("readonly", (s) => s.get(CURRENT));
    if (!room?.photo?.data || !room.photo.width) return null;
    return room;
  } catch {
    return null;
  }
}

export async function clearRoom(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(CURRENT));
  } catch {
    // Nothing useful to do; the caller is discarding state either way.
  }
}
