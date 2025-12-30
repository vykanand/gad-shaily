const fs = require('fs');
const path = require('path');

async function createDbClient(dbPath) {
  // lazy require to avoid loading when not needed
  const initSqlJs = require('sql.js');
  // determine base path for sql.js distribution files. `require.resolve('sql.js')` often points
  // into the package's `dist` folder; use its dirname as the base for locateFile so we don't
  // produce duplicated `dist/dist` paths.
  const sqljsResolved = require.resolve('sql.js');
  const sqljsBase = path.dirname(sqljsResolved);
  const SQL = await initSqlJs({ locateFile: (file) => path.join(sqljsBase, file) });

  let buffer = null;
  try {
    if (fs.existsSync(dbPath)) {
      buffer = fs.readFileSync(dbPath);
      // If the file is empty, treat as no DB
      if (!buffer || buffer.length === 0) buffer = null;
    }
  } catch (e) {
    buffer = null;
  }

  const db = buffer ? new SQL.Database(new Uint8Array(buffer)) : new SQL.Database();

  function save() {
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch (e) {
      console.warn('Failed to persist sqlite wasm DB:', e && e.message ? e.message : e);
    }
  }

  function all(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      if (params && params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function get(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      if (params && params.length) stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return null;
    } finally {
      stmt.free();
    }
  }

  function run(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      if (params && params.length) stmt.bind(params);
      const result = stmt.run();
      // persist after any write
      save();
      return result;
    } finally {
      stmt.free();
    }
  }

  function exec(sql) {
    const res = db.exec(sql);
    // persist schema changes
    save();
    return res;
  }

  // Run a callback inside a transaction. Commits on success, rolls back on error.
  // Support transactions with nested savepoints to avoid "no transaction is active" errors
  let _txDepth = 0;
  let _txCounter = 0;
  function transaction(cb) {
    const isTop = _txDepth === 0;
    const saveName = `sp_${++_txCounter}`;
    try {
      if (isTop) {
        console.debug(`[sqlite] BEGIN tx (depth=${_txDepth})`);
        db.exec('BEGIN');
      } else {
        console.debug(`[sqlite] SAVEPOINT ${saveName} (depth=${_txDepth})`);
        db.exec(`SAVEPOINT ${saveName}`);
      }

      _txDepth++;
      const result = cb();

      // If callback returned a Promise, wait for it before committing
      if (result && typeof result.then === 'function') {
        return result.then(res => {
          _txDepth--;
          if (isTop) {
            try {
              console.debug(`[sqlite] COMMIT tx (depth after=${_txDepth})`);
              db.exec('COMMIT');
            } catch (commitErr) {
              console.error('[sqlite] COMMIT failed', commitErr && commitErr.message ? commitErr.message : commitErr);
              throw commitErr;
            }
          } else {
            try {
              console.debug(`[sqlite] RELEASE ${saveName} (depth after=${_txDepth})`);
              db.exec(`RELEASE ${saveName}`);
            } catch (releaseErr) {
              console.error('[sqlite] RELEASE savepoint failed', releaseErr && releaseErr.message ? releaseErr.message : releaseErr);
              throw releaseErr;
            }
          }
          save();
          return res;
        }).catch(err => {
          // rollback for async cb
          _txDepth = Math.max(0, _txDepth - 1);
          try {
            if (isTop) {
              try { db.exec('ROLLBACK'); } catch (rbErr) { console.error('[sqlite] async ROLLBACK failed', rbErr && rbErr.message ? rbErr.message : rbErr); }
            } else {
              try { db.exec(`ROLLBACK TO ${saveName}`); } catch (rbToErr) { console.error('[sqlite] async ROLLBACK TO failed', rbToErr && rbToErr.message ? rbToErr.message : rbToErr); }
              try { db.exec(`RELEASE ${saveName}`); } catch (relErr) { console.error('[sqlite] async RELEASE after rollback failed', relErr && relErr.message ? relErr.message : relErr); }
            }
          } catch (_) {}
          throw err;
        });
      }

      // sync callback path
      _txDepth--;
      if (isTop) {
        try {
          console.debug(`[sqlite] COMMIT tx (depth after=${_txDepth})`);
          db.exec('COMMIT');
        } catch (commitErr) {
          console.error('[sqlite] COMMIT failed', commitErr && commitErr.message ? commitErr.message : commitErr);
          throw commitErr;
        }
      } else {
        try {
          console.debug(`[sqlite] RELEASE ${saveName} (depth after=${_txDepth})`);
          db.exec(`RELEASE ${saveName}`);
        } catch (releaseErr) {
          console.error('[sqlite] RELEASE savepoint failed', releaseErr && releaseErr.message ? releaseErr.message : releaseErr);
          throw releaseErr;
        }
      }

      // persist after transaction
      save();
      return result;
    } catch (e) {
      // attempt to rollback appropriately
      try {
        _txDepth = Math.max(0, _txDepth - 1);
        if (isTop) {
          try {
            console.debug('[sqlite] ROLLBACK top-level transaction');
            db.exec('ROLLBACK');
          } catch (rbErr) {
            console.error('[sqlite] ROLLBACK failed', rbErr && rbErr.message ? rbErr.message : rbErr);
          }
        } else {
          try {
            console.debug(`[sqlite] ROLLBACK TO ${saveName}`);
            db.exec(`ROLLBACK TO ${saveName}`);
          } catch (rbToErr) {
            console.error('[sqlite] ROLLBACK TO savepoint failed', rbToErr && rbToErr.message ? rbToErr.message : rbToErr);
          }
          try {
            console.debug(`[sqlite] RELEASE ${saveName} after rollback`);
            db.exec(`RELEASE ${saveName}`);
          } catch (relErr) {
            console.error('[sqlite] RELEASE after rollback failed', relErr && relErr.message ? relErr.message : relErr);
          }
        }
      } catch (_) {}
      throw e;
    }
  }

  return {
    db,
    all,
    get,
    run,
    exec,
    transaction,
    save,
    export: () => db.export(),
    close: () => { db.close(); },
    // expose the db file path for callers that need it (e.g. migrations)
    dbPath
  };
}

module.exports = { createDbClient };
