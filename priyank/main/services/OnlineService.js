const axios = require('axios');

class OnlineService {
  constructor() {
    this.cache = new Map();
  }

  async fetchMetadata(apiUrl, headers = {}) {
    try {
      const response = await axios.get(apiUrl, { headers });
      const data = response.data;

      // Detect metadata from response
      const metadata = this.extractMetadata(data);
      
      return {
        success: true,
        metadata,
        sample: Array.isArray(data) ? data[0] : data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  extractMetadata(data) {
    const sample = Array.isArray(data) ? data[0] : data;
    
    if (!sample) {
      return { fields: [] };
    }

    const fields = Object.keys(sample).map(key => ({
      name: key,
      type: this.detectFieldType(sample[key]),
      label: this.formatLabel(key)
    }));

    return { fields };
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

  async fetchData(module) {
    try {
      const response = await axios.get(
        module.config.apiEndpoints.list,
        { headers: module.config.headers }
      );

      return {
        success: true,
        data: Array.isArray(response.data) ? response.data : [response.data]
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async createRecord(module, data) {
    try {
      const response = await axios.post(
        module.config.apiEndpoints.create,
        data,
        { headers: module.config.headers }
      );

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateRecord(module, recordId, data) {
    try {
      const url = module.config.apiEndpoints.update.replace('{id}', recordId);
      const response = await axios.put(
        url,
        data,
        { headers: module.config.headers }
      );

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async deleteRecord(module, recordId) {
    try {
      const url = module.config.apiEndpoints.delete.replace('{id}', recordId);
      const response = await axios.delete(url, {
        headers: module.config.headers
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = OnlineService;
