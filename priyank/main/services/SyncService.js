const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class SyncService {
  constructor(onlineService, offlineService) {
    this.onlineService = onlineService;
    this.offlineService = offlineService;
    this.syncConfigFile = path.join(require('electron').app.getPath('userData'), 'data', 'sync-configs.json');
    this.initializeSyncFile();
  }

  initializeSyncFile() {
    if (!fsSync.existsSync(this.syncConfigFile)) {
      fsSync.writeFileSync(this.syncConfigFile, JSON.stringify({ configs: [] }, null, 2));
    }
  }

  async detectMappings(sourceModuleId, targetModuleId, moduleManager) {
    try {
      const sourceModule = await moduleManager.getModule(sourceModuleId);
      const targetModule = await moduleManager.getModule(targetModuleId);

      if (!sourceModule || !targetModule) {
        throw new Error('Module not found');
      }

      // Get fields from both modules
      const sourceFields = await this.getModuleFields(sourceModule);
      const targetFields = await this.getModuleFields(targetModule);

      // Detect matching fields
      const mappings = [];
      
      for (const sourceField of sourceFields) {
        for (const targetField of targetFields) {
          const similarity = this.calculateSimilarity(sourceField.name, targetField.name);
          
          if (similarity > 0.7 || sourceField.name.toLowerCase() === targetField.name.toLowerCase()) {
            mappings.push({
              sourceField: sourceField.name,
              targetField: targetField.name,
              sourceType: sourceField.type,
              targetType: targetField.type,
              similarity,
              autoMapped: similarity > 0.9
            });
            break; // Move to next source field
          }
        }
      }

      return {
        success: true,
        sourceModule: {
          id: sourceModule.id,
          name: sourceModule.name,
          mode: sourceModule.mode,
          fields: sourceFields
        },
        targetModule: {
          id: targetModule.id,
          name: targetModule.name,
          mode: targetModule.mode,
          fields: targetFields
        },
        suggestedMappings: mappings
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getModuleFields(module) {
    if (module.mode === 'online') {
      return module.config.metadata?.fields || [];
    } else {
      // Get fields from actual data
      const result = await this.offlineService.fetchData(module);
      if (result.success && result.data.length > 0) {
        const sample = result.data[0];
        return Object.keys(sample).map(key => ({
          name: key,
          type: this.constructor.detectFieldType(sample[key]),
          label: this.constructor.formatLabel(key)
        }));
      }
      return module.config.fields || [];
    }
  }

  detectFieldType(value) {
    if (value === null || value === undefined) return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (value instanceof Date || !isNaN(Date.parse(value))) return 'date';
    return 'string';
  }

  formatLabel(fieldName) {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }

  calculateSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().replace(/[_\s-]/g, '');
    const s2 = str2.toLowerCase().replace(/[_\s-]/g, '');

    if (s1 === s2) return 1.0;

    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1.0;

    const distance = this.levenshteinDistance(s1, s2);
    return 1 - distance / maxLen;
  }

  levenshteinDistance(s1, s2) {
    const matrix = [];

    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[s2.length][s1.length];
  }

  async saveSyncConfig(syncConfig) {
    try {
      const data = await fs.readFile(this.syncConfigFile, 'utf-8');
      const json = JSON.parse(data);

      if (!syncConfig.id) {
        syncConfig.id = uuidv4();
        syncConfig.createdAt = new Date().toISOString();
      }
      
      syncConfig.updatedAt = new Date().toISOString();
      syncConfig.lastSyncAt = null;

      const index = json.configs.findIndex(c => c.id === syncConfig.id);
      if (index >= 0) {
        json.configs[index] = syncConfig;
      } else {
        json.configs.push(syncConfig);
      }

      await fs.writeFile(this.syncConfigFile, JSON.stringify(json, null, 2));

      return {
        success: true,
        config: syncConfig
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getSyncConfigs() {
    try {
      const data = await fs.readFile(this.syncConfigFile, 'utf-8');
      const json = JSON.parse(data);
      return {
        success: true,
        configs: json.configs
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeSync(syncConfigId, moduleManager) {
    try {
      const configResult = await this.getSyncConfigs();
      const config = configResult.configs.find(c => c.id === syncConfigId);

      if (!config) {
        throw new Error('Sync config not found');
      }

      const sourceModule = await moduleManager.getModule(config.sourceModuleId);
      const targetModule = await moduleManager.getModule(config.targetModuleId);

      let syncResults = {
        created: 0,
        updated: 0,
        deleted: 0,
        errors: []
      };

      // Fetch data from source
      const sourceData = await this.fetchModuleData(sourceModule);
      const targetData = await this.fetchModuleData(targetModule);

      // Create lookup maps
      const targetMap = new Map();
      targetData.forEach(record => {
        const key = this.getSyncKey(record, config.mappings, 'target');
        targetMap.set(key, record);
      });

      // Sync from source to target
      for (const sourceRecord of sourceData) {
        try {
          const syncKey = this.getSyncKey(sourceRecord, config.mappings, 'source');
          const targetRecord = targetMap.get(syncKey);

          const mappedData = this.mapRecord(sourceRecord, config.mappings, 'source-to-target');

          if (targetRecord) {
            // Update existing record
            if (this.needsUpdate(sourceRecord, targetRecord, config)) {
              await this.updateModuleRecord(targetModule, targetRecord.id, mappedData);
              syncResults.updated++;
            }
            targetMap.delete(syncKey); // Mark as processed
          } else {
            // Create new record
            await this.createModuleRecord(targetModule, mappedData);
            syncResults.created++;
          }
        } catch (error) {
          syncResults.errors.push({
            record: sourceRecord,
            error: error.message
          });
        }
      }

      // Bidirectional sync: sync from target to source
      if (config.bidirectional) {
        const sourceMap = new Map();
        sourceData.forEach(record => {
          const key = this.getSyncKey(record, config.mappings, 'source');
          sourceMap.set(key, record);
        });

        for (const targetRecord of targetData) {
          try {
            const syncKey = this.getSyncKey(targetRecord, config.mappings, 'target');
            const sourceRecord = sourceMap.get(syncKey);

            if (!sourceRecord) {
              // Create in source
              const mappedData = this.mapRecord(targetRecord, config.mappings, 'target-to-source');
              await this.createModuleRecord(sourceModule, mappedData);
              syncResults.created++;
            }
          } catch (error) {
            syncResults.errors.push({
              record: targetRecord,
              error: error.message
            });
          }
        }
      }

      // Update sync config with last sync time
      config.lastSyncAt = new Date().toISOString();
      await this.saveSyncConfig(config);

      return {
        success: true,
        results: syncResults
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async fetchModuleData(module) {
    if (module.mode === 'online') {
      const result = await this.onlineService.fetchData(module);
      return result.success ? result.data : [];
    } else {
      const result = await this.offlineService.fetchData(module);
      return result.success ? result.data : [];
    }
  }

  async createModuleRecord(module, data) {
    if (module.mode === 'online') {
      return this.onlineService.createRecord(module, data);
    } else {
      return this.offlineService.createRecord(module, data);
    }
  }

  async updateModuleRecord(module, recordId, data) {
    if (module.mode === 'online') {
      return this.onlineService.updateRecord(module, recordId, data);
    } else {
      return this.offlineService.updateRecord(module, recordId, data);
    }
  }

  getSyncKey(record, mappings, side) {
    // Use mapped ID field or first mapped field as sync key
    const idMapping = mappings.find(m => 
      (side === 'source' && m.sourceField.toLowerCase().includes('id')) ||
      (side === 'target' && m.targetField.toLowerCase().includes('id'))
    );

    if (idMapping) {
      const field = side === 'source' ? idMapping.sourceField : idMapping.targetField;
      return String(record[field] || '');
    }

    // Fallback to first mapping
    if (mappings.length > 0) {
      const field = side === 'source' ? mappings[0].sourceField : mappings[0].targetField;
      return String(record[field] || '');
    }

    return record.id || '';
  }

  mapRecord(record, mappings, direction) {
    const mapped = {};
    
    for (const mapping of mappings) {
      if (direction === 'source-to-target') {
        mapped[mapping.targetField] = record[mapping.sourceField];
      } else {
        mapped[mapping.sourceField] = record[mapping.targetField];
      }
    }

    return mapped;
  }

  needsUpdate(sourceRecord, targetRecord, config) {
    // Delta sync: check if source is newer or has changes
    if (sourceRecord.updatedAt && targetRecord.updatedAt) {
      return new Date(sourceRecord.updatedAt) > new Date(targetRecord.updatedAt);
    }

    // Check if mapped fields have different values
    for (const mapping of config.mappings) {
      if (sourceRecord[mapping.sourceField] !== targetRecord[mapping.targetField]) {
        return true;
      }
    }

    return false;
  }

  async getSyncStatus(syncConfigId) {
    try {
      const configResult = await this.getSyncConfigs();
      const config = configResult.configs.find(c => c.id === syncConfigId);

      if (!config) {
        throw new Error('Sync config not found');
      }

      return {
        success: true,
        status: {
          id: config.id,
          name: config.name,
          lastSyncAt: config.lastSyncAt,
          sourceModule: config.sourceModuleId,
          targetModule: config.targetModuleId,
          bidirectional: config.bidirectional
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = SyncService;
