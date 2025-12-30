const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');

class OfflineService {
  constructor(dbClient) {
    this.dbClient = dbClient;
    this._init();
  }

  _init() {
    this.dbClient.exec(`CREATE TABLE IF NOT EXISTS records (
      moduleId TEXT,
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      createdAt TEXT,
      updatedAt TEXT
    );`);
  }

  async fetchData(module) {
    // Legacy compat: return first page
    return this.fetchRecords(module, 0, 100);
  }

  // Paginated read: return slice and total count
  async fetchRecords(module, offset = 0, limit = 100) {
    try {
      const totalRow = this.dbClient.get('SELECT COUNT(*) as cnt FROM records WHERE moduleId = ?', [module.id]);
      const total = totalRow ? totalRow.cnt : 0;
      const rows = this.dbClient.all('SELECT json FROM records WHERE moduleId = ? ORDER BY rowid LIMIT ? OFFSET ?', [module.id, limit, offset]);
      const data = rows.map(r => JSON.parse(r.json));
      return { success: true, data, total };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async readFromExcel(module) {
    // Import Excel into sqlite for the module
    if (!fsSync.existsSync(module.config.excelFile)) return { success: false, error: 'Excel file not found' };
    const workbook = XLSX.readFile(module.config.excelFile);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    // Bulk insert inside a transaction
    try {
      this.dbClient.transaction(() => {
        for (const it of data) {
          const id = it.id || uuidv4();
          const now = new Date().toISOString();
          this.dbClient.run('INSERT OR REPLACE INTO records (moduleId,id,json,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?)', [module.id, id, JSON.stringify(it), it.createdAt || now, it.updatedAt || now]);
        }
      });
    } catch (e) {
      return { success: false, error: e.message };
    }

    return { success: true, data };
  }

  async writeToJson(module, records) {
    // No-op for primary storage; keep for compatibility
    return { success: true };
  }

  async writeToExcel(module, records) {
    const worksheet = XLSX.utils.json_to_sheet(records);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    XLSX.writeFile(workbook, module.config.excelFile);
  }

  async createRecord(module, data) {
    try {
      const newRecord = { id: uuidv4(), ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      this.dbClient.run('INSERT INTO records (moduleId,id,json,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?)', [module.id, newRecord.id, JSON.stringify(newRecord), newRecord.createdAt, newRecord.updatedAt]);
      return { success: true, data: newRecord };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async updateRecord(module, recordId, data) {
    try {
      const row = this.dbClient.get('SELECT json FROM records WHERE id = ? AND moduleId = ?', [recordId, module.id]);
      if (!row) return { success: false, error: 'Record not found' };
      const existing = JSON.parse(row.json);
      const updated = { ...existing, ...data, id: recordId, updatedAt: new Date().toISOString() };
      this.dbClient.run('UPDATE records SET json = ?, updatedAt = ? WHERE id = ? AND moduleId = ?', [JSON.stringify(updated), updated.updatedAt, recordId, module.id]);
      return { success: true, data: updated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async deleteRecord(module, recordId) {
    try {
      this.dbClient.run('DELETE FROM records WHERE id = ? AND moduleId = ?', [recordId, module.id]);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async addField(module, fieldName, fieldType = 'string') {
    try {
      if (!module.config.fields) module.config.fields = [];
      if (!module.config.fields.find(f => f.name === fieldName)) module.config.fields.push({ name: fieldName, type: fieldType, label: this.formatLabel(fieldName) });

      const defaultValue = this.getDefaultValue(fieldType);
      const rows = this.dbClient.all('SELECT id,json FROM records WHERE moduleId = ?', [module.id]);
      try {
        this.dbClient.transaction(() => {
          for (const r of rows) {
            const obj = JSON.parse(r.json);
            if (obj[fieldName] === undefined) obj[fieldName] = defaultValue;
            obj.updatedAt = new Date().toISOString();
            this.dbClient.run('UPDATE records SET json = ?, updatedAt = ? WHERE id = ? AND moduleId = ?', [JSON.stringify(obj), obj.updatedAt, r.id, module.id]);
          }
        });
      } catch (e) {
        throw e;
      }
      return { success: true, field: { name: fieldName, type: fieldType } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getDefaultValue(fieldType) {
    switch (fieldType) {
      case 'number':
        return 0;
      case 'boolean':
        return false;
      case 'date':
        return new Date().toISOString();
      default:
        return '';
    }
  }

  formatLabel(fieldName) {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }
}

module.exports = OfflineService;
