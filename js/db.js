/*
 * Moneta storage
 * IndexedDB with explicit schema versions and migrations.
 *
 * v1  journal, settings and import-history stores
 * v2  meta store + one-time migration from the old localStorage model
 * v3  import-batch index for grouped imports
 */
(function (root) {
  'use strict';

  const core = root.MonetaCore;
  const DB_NAME = 'moneta-journal';
  const DB_VERSION = 3;
  const STORES = {
    transactions: 'transactions',
    settings: 'settings',
    imports: 'imports',
    meta: 'meta'
  };
  const SETTINGS_KEY = 'preferences';

  let connection = null;
  let opening = null;

  function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Storage request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Storage transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Storage transaction was cancelled'));
    });
  }

  function readLocalStorage(key) {
    try {
      return root.localStorage ? root.localStorage.getItem(key) : null;
    } catch (error) {
      return null;
    }
  }

  function createStore(db, transaction, name, options, indexes) {
    let store;
    if (!db.objectStoreNames.contains(name)) {
      store = db.createObjectStore(name, options);
    } else {
      store = transaction.objectStore(name);
    }
    for (const index of indexes || []) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, index.options || {});
      }
    }
    return store;
  }

  function migrateLegacyData(db, transaction) {
    let legacy = [];
    try {
      legacy = JSON.parse(readLocalStorage('moneta-txs') || '[]');
    } catch (error) {
      legacy = [];
    }
    if (Array.isArray(legacy) && legacy.length) {
      const store = transaction.objectStore(STORES.transactions);
      const seen = new Set();
      const converted = [];
      legacy.forEach((item, index) => {
        const transactionRecord = core.transactionFromLegacy(item, index);
        if (!transactionRecord) return;
        while (seen.has(transactionRecord.id)) {
          transactionRecord.id = core.newId('legacy');
        }
        seen.add(transactionRecord.id);
        converted.push(transactionRecord);
      });
      converted.forEach((record) => store.put(record));
      const meta = transaction.objectStore(STORES.meta);
      meta.put({
        key: 'legacy-migration',
        at: new Date().toISOString(),
        source: 'localStorage:moneta-txs',
        converted: converted.length,
        skipped: legacy.length - converted.length
      });
    }

    const settingsStore = transaction.objectStore(STORES.settings);
    const settingsRequest = settingsStore.get(SETTINGS_KEY);
    settingsRequest.onsuccess = () => {
      if (settingsRequest.result && settingsRequest.result.value) return;
      const legacyCurrency = readLocalStorage('moneta-currency');
      const legacyTheme = readLocalStorage('moneta-theme');
      const migrated = core.normalizeSettings({
        currency: legacyCurrency || undefined,
        theme: legacyTheme === 'light' ? 'light' : legacyTheme === 'dark' ? 'dark' : undefined
      }).settings;
      settingsStore.put({
        key: SETTINGS_KEY,
        value: migrated,
        updatedAt: new Date().toISOString()
      });
    };
  }

  function upgrade(db, transaction, oldVersion) {
    if (oldVersion < 1) {
      createStore(db, transaction, STORES.transactions, { keyPath: 'id' }, [
        { name: 'byDate', keyPath: 'date' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
      ]);
      createStore(db, transaction, STORES.settings, { keyPath: 'key' }, []);
      createStore(db, transaction, STORES.imports, { keyPath: 'id' }, [
        { name: 'byImportedAt', keyPath: 'at' }
      ]);
    }
    if (oldVersion < 2) {
      createStore(db, transaction, STORES.meta, { keyPath: 'key' }, []);
      createStore(db, transaction, STORES.imports, { keyPath: 'id' }, [
        { name: 'byImportedAt', keyPath: 'at' }
      ]);
      migrateLegacyData(db, transaction);
    }
    if (oldVersion < 3) {
      const store = createStore(db, transaction, STORES.transactions, { keyPath: 'id' }, [
        { name: 'byDate', keyPath: 'date' },
        { name: 'byCreatedAt', keyPath: 'createdAt' }
      ]);
      if (!store.indexNames.contains('byImportBatch')) {
        store.createIndex('byImportBatch', 'importBatchId', { unique: false });
      }
    }
    // Any future migration belongs here:
    // if (oldVersion < 4) { ... }
  }

  function openDatabase() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    if (!root.indexedDB) {
      return Promise.reject(new Error('This browser does not support offline storage (IndexedDB).'));
    }
    opening = new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        upgrade(request.result, request.transaction, event.oldVersion || 0);
      };
      request.onsuccess = () => {
        connection = request.result;
        connection.onversionchange = () => {
          connection.close();
          connection = null;
          opening = null;
        };
        connection.onclose = () => {
          connection = null;
          opening = null;
        };
        opening = null;
        resolve(connection);
      };
      request.onerror = () => {
        opening = null;
        reject(request.error || new Error('Could not open the local database.'));
      };
      request.onblocked = () => {
        opening = null;
        reject(new Error('The database is open in another Moneta tab. Close the other tab and try again.'));
      };
    });
    return opening;
  }

  async function ensureSettings(db) {
    const read = db.transaction(STORES.settings, 'readonly');
    const existing = await requestAsPromise(read.objectStore(STORES.settings).get(SETTINGS_KEY));
    if (existing && existing.value) return existing.value;
    const settings = { ...core.DEFAULT_SETTINGS };
    const write = db.transaction(STORES.settings, 'readwrite');
    write.objectStore(STORES.settings).put({
      key: SETTINGS_KEY,
      value: settings,
      updatedAt: new Date().toISOString()
    });
    await transactionDone(write);
    return settings;
  }

  async function getAllTransactions() {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.transactions, 'readonly');
    const rows = await requestAsPromise(transaction.objectStore(STORES.transactions).getAll());
    return (rows || []).sort((a, b) => {
      const date = String(b.date).localeCompare(String(a.date));
      if (date !== 0) return date;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  async function getSettings() {
    const db = await openDatabase();
    return ensureSettings(db);
  }

  async function saveSettings(settingsInput) {
    const db = await openDatabase();
    const current = await ensureSettings(db);
    const result = core.normalizeSettings({ ...current, ...settingsInput });
    const transaction = db.transaction(STORES.settings, 'readwrite');
    transaction.objectStore(STORES.settings).put({
      key: SETTINGS_KEY,
      value: result.settings,
      updatedAt: new Date().toISOString()
    });
    await transactionDone(transaction);
    return result.settings;
  }

  async function saveTransaction(transactionRecord) {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.transactions, 'readwrite');
    transaction.objectStore(STORES.transactions).put(transactionRecord);
    await transactionDone(transaction);
    return transactionRecord;
  }

  async function saveTransactions(records) {
    if (!records || !records.length) return 0;
    const db = await openDatabase();
    const transaction = db.transaction(STORES.transactions, 'readwrite');
    const store = transaction.objectStore(STORES.transactions);
    for (const record of records) store.put(record);
    await transactionDone(transaction);
    return records.length;
  }

  async function deleteTransaction(id) {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.transactions, 'readwrite');
    transaction.objectStore(STORES.transactions).delete(id);
    await transactionDone(transaction);
  }

  async function clearTransactions() {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.transactions, 'readwrite');
    transaction.objectStore(STORES.transactions).clear();
    await transactionDone(transaction);
  }

  async function getImports() {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.imports, 'readonly');
    const rows = await requestAsPromise(transaction.objectStore(STORES.imports).getAll());
    return (rows || []).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  async function addImport(record) {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.imports, 'readwrite');
    transaction.objectStore(STORES.imports).put(record);
    await transactionDone(transaction);
    return record;
  }

  async function deleteImport(id) {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.imports, 'readwrite');
    transaction.objectStore(STORES.imports).delete(id);
    await transactionDone(transaction);
  }

  async function clearImports() {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.imports, 'readwrite');
    transaction.objectStore(STORES.imports).clear();
    await transactionDone(transaction);
  }

  async function getMeta(key) {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.meta, 'readonly');
    return requestAsPromise(transaction.objectStore(STORES.meta).get(key));
  }

  async function replaceAll(input) {
    const db = await openDatabase();
    const data = input || {};
    const transaction = db.transaction(
      [STORES.transactions, STORES.settings, STORES.imports, STORES.meta],
      'readwrite'
    );
    const txStore = transaction.objectStore(STORES.transactions);
    const settingsStore = transaction.objectStore(STORES.settings);
    const importStore = transaction.objectStore(STORES.imports);
    txStore.clear();
    importStore.clear();
    settingsStore.clear();
    for (const record of data.transactions || []) txStore.put(record);
    for (const record of data.imports || []) importStore.put(record);
    settingsStore.put({
      key: SETTINGS_KEY,
      value: core.normalizeSettings(data.settings).settings,
      updatedAt: new Date().toISOString()
    });
    transaction.objectStore(STORES.meta).put({
      key: 'last-restore',
      at: new Date().toISOString(),
      entries: (data.transactions || []).length
    });
    await transactionDone(transaction);
  }

  async function clearAll() {
    const db = await openDatabase();
    const transaction = db.transaction(
      [STORES.transactions, STORES.settings, STORES.imports, STORES.meta],
      'readwrite'
    );
    transaction.objectStore(STORES.transactions).clear();
    transaction.objectStore(STORES.imports).clear();
    transaction.objectStore(STORES.settings).clear();
    transaction.objectStore(STORES.meta).clear();
    transaction.objectStore(STORES.settings).put({
      key: SETTINGS_KEY,
      value: { ...core.DEFAULT_SETTINGS },
      updatedAt: new Date().toISOString()
    });
    await transactionDone(transaction);
    return { ...core.DEFAULT_SETTINGS };
  }

  async function countTransactions() {
    const db = await openDatabase();
    const transaction = db.transaction(STORES.transactions, 'readonly');
    return requestAsPromise(transaction.objectStore(STORES.transactions).count());
  }

  async function storageEstimate() {
    if (!root.navigator || !root.navigator.storage || !root.navigator.storage.estimate) return null;
    try {
      return await root.navigator.storage.estimate();
    } catch (error) {
      return null;
    }
  }

  root.MonetaDB = {
    DB_NAME,
    DB_VERSION,
    STORES,
    openDatabase,
    getAllTransactions,
    getSettings,
    saveSettings,
    saveTransaction,
    saveTransactions,
    deleteTransaction,
    clearTransactions,
    getImports,
    addImport,
    deleteImport,
    clearImports,
    getMeta,
    replaceAll,
    clearAll,
    countTransactions,
    storageEstimate
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
