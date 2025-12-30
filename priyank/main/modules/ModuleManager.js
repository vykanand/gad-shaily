const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ModuleManager {
  constructor(dbClient) {
    this.dbClient = dbClient;
    this._init();
  }

  _init() {
    // modules table stores module metadata, config stored as JSON text
    this.dbClient.exec(`CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      name TEXT,
      mode TEXT,
      config TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );`);

    // Ensure records table exists
    this.dbClient.exec(`CREATE TABLE IF NOT EXISTS records (
      moduleId TEXT,
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );`);

    // Migrate legacy modules.json if present alongside DB
    try {
      const maybeModulesFile = path.join(path.dirname(this.dbClientPath || ''), 'modules.json');
      if (maybeModulesFile && fsSync.existsSync(maybeModulesFile)) {
        const raw = fsSync.readFileSync(maybeModulesFile, 'utf-8');
        const parsed = JSON.parse(raw || '{}');
        const modules = parsed.modules || [];
        for (const m of modules) {
          const id = m.id || uuidv4();
          const now = m.createdAt || new Date().toISOString();
          this.dbClient.run('INSERT OR REPLACE INTO modules (id,name,mode,config,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?)', [id, m.name || 'Untitled', m.mode || 'offline', JSON.stringify(m.config || {}), now, m.updatedAt || now]);
        }
        try { fsSync.unlinkSync(maybeModulesFile); } catch (e) {}
      }
    } catch (e) {
      // migration failure is non-fatal
      console.warn('Module migration failed:', e?.message);
    }
  }

  getAllModules() {
    const rows = this.dbClient.all('SELECT id,name,mode,config,createdAt,updatedAt FROM modules ORDER BY createdAt DESC', []);
    return rows.map(r => ({ id: r.id, name: r.name, mode: r.mode, config: JSON.parse(r.config || '{}'), createdAt: r.createdAt, updatedAt: r.updatedAt }));
  }

  getModule(moduleId) {
    const r = this.dbClient.get('SELECT id,name,mode,config,createdAt,updatedAt FROM modules WHERE id = ?', [moduleId]);
    if (!r) return null;
    return { id: r.id, name: r.name, mode: r.mode, config: JSON.parse(r.config || '{}'), createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  createModule(moduleData) {
    const id = uuidv4();
    const now = new Date().toISOString();
    const config = moduleData.config || {};
    this.dbClient.run('INSERT INTO modules (id,name,mode,config,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?)', [id, moduleData.name || 'Untitled', moduleData.mode || 'offline', JSON.stringify(config), now, now]);
    return { id, name: moduleData.name, mode: moduleData.mode, config, createdAt: now, updatedAt: now };
  }

  updateModule(moduleId, moduleData) {
    const now = new Date().toISOString();
    const existing = this.getModule(moduleId);
    if (!existing) throw new Error('Module not found');
    const newModule = { ...existing, ...moduleData, updatedAt: now };
    this.dbClient.run('UPDATE modules SET name = ?, mode = ?, config = ?, updatedAt = ? WHERE id = ?', [newModule.name, newModule.mode, JSON.stringify(newModule.config || {}), newModule.updatedAt, moduleId]);
    return newModule;
  }

  deleteModule(moduleId) {
    const existing = this.getModule(moduleId);
    if (!existing) throw new Error('Module not found');
    try { this.dbClient.run('DELETE FROM records WHERE moduleId = ?', [moduleId]); } catch (e) { console.warn('Failed to delete module records', e?.message); }
    this.dbClient.run('DELETE FROM modules WHERE id = ?', [moduleId]);
    return { success: true };
  }
}

module.exports = ModuleManager;
