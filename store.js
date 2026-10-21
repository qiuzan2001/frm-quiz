// store.js — IndexedDB 单表键值
(function (root) {
  "use strict";
  const DB = "frm-quiz", STORE = "kv";
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = db.onversionchange = () => { dbp = null; db.close(); };
        resolve(db);
      };
      req.onerror = () => { dbp = null; reject(req.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      let t, req;
      try {
        t = db.transaction(STORE, mode);
        req = fn(t.objectStore(STORE));
      } catch (e) {
        dbp = null;
        reject(e);
        return;
      }
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  root.FrmStore = {
    get: (k) => tx("readonly", (s) => s.get(k)),
    set: (k, v) => tx("readwrite", (s) => s.put(v, k)),
    del: (k) => tx("readwrite", (s) => s.delete(k)),
    clear: () => tx("readwrite", (s) => s.clear()),
  };
})(self);
