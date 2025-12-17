const fs = require('fs');
const vm = require('vm');

// Minimal fake DOM implementation sufficient for scan-manager's usage
function createFakeDOM() {
  const elements = new Map();

  function makeEl(tag = 'div', id) {
    const el = {
      tagName: tag.toUpperCase(),
      id: id || '',
      children: [],
      style: {},
      value: '',
      textContent: '',
      dataset: {},
      attributes: {},
      parent: null,
      appendChild(child) { this.children.push(child); child.parent = this; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(c=>c!==this); },
      querySelector(sel) {
        if (!sel) return null;
        if (sel.startsWith('#')) return getById(sel.slice(1));
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          // search direct children first
          for (const ch of el.children) {
            if (ch.classList && ch.classList._set && ch.classList._set.has(cls)) return ch;
            if (typeof ch.innerHTML === 'string' && ch.innerHTML.includes(`class="${cls}"`)) return ch;
          }
          // fallback to global class search
          return getByClass(cls)[0] || null;
        }
        // fallback id or class match
        return getById(sel) || getByClass(sel)[0] || null;
      },
      querySelectorAll(sel) {
        if (!sel) return [];
        if (sel.startsWith('#')) return [getById(sel.slice(1))].filter(Boolean);
        if (sel.startsWith('.')) return getByClass(sel.slice(1));
        return [];
      },
      classList: {
        _set: new Set(),
        add(cls) { this._set.add(cls); },
        remove(cls) { this._set.delete(cls); },
        contains(cls) { return this._set.has(cls); },
        toString() { return Array.from(this._set).join(' '); }
      }
    };
    // Bind classList methods to element for compatibility
    el.classList.add = el.classList.add.bind(el.classList);
    el.classList.remove = el.classList.remove.bind(el.classList);
    el.classList.contains = el.classList.contains.bind(el.classList);
    // Provide a className property that syncs with classList
    Object.defineProperty(el, 'className', {
      get() { return Array.from(el.classList._set).join(' '); },
      set(v) { el.classList._set = new Set(String(v||'').split(/\s+/).filter(Boolean)); }
    });
    return el;
  }

  function getById(id) { return elements.get(id) || null; }
  function getByClass(cls) { return Array.from(elements.values()).filter(e=>String(e.classList && e.classList._set && Array.from(e.classList._set)).includes(cls) || (e.classList && e.classList._set && e.classList._set.has && e.classList._set.has(cls))); }

  const document = {
    createElement(tag) { return makeEl(tag); },
    getElementById(id) {
      if (!elements.has(id)) {
        const el = makeEl('div', id);
        elements.set(id, el);
      }
      return elements.get(id);
    },
    body: makeEl('body', 'body'),
    querySelector(sel) {
      if (!sel) return null;
      // simple id selector
      if (sel.startsWith('#') && !sel.includes(' ')) return this.getElementById(sel.slice(1));
      // handle compound selectors like '#multi-scan-list .multi-scan-item[data-field-id="field_a"]'
      const m = sel.match(/^#([^\s]+)\s+\.([^\[]+)(?:\[data-field-id=\"([^\"]+)\"\])?/);
      if (m) {
        const parentId = m[1];
        const cls = m[2];
        const fid = m[3];
        const parent = this.getElementById(parentId);
        if (!parent) return null;
        for (const ch of parent.children) {
          if (ch.dataset && fid && ch.dataset.fieldId === fid) return ch;
          if (ch.classList && ch.classList._set && ch.classList._set.has(cls)) return ch;
          // fallback inspect innerHTML for dataset attribute
          if (typeof ch.innerHTML === 'string' && fid) {
            if (ch.innerHTML.includes(`data-field-id=\"${fid}\"`) || ch.innerHTML.includes(`data-field-id='${fid}'`)) return ch;
          }
        }
        return null;
      }
      return null;
    }
  };

  // Precreate some common elements
  ['status-section','scan-data-value','scan-status-value','part-code-status-value','pass-status','scan-qty','scan-by','blink-overlay','error-sound'].forEach(id=>{
    const e = makeEl('div', id);
    elements.set(id, e);
  });

  return { document, elements, makeEl };
}

(async function run() {
  const { document, elements, makeEl } = createFakeDOM();

  // Build context where `window` is a defined global object
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // base64 helpers
    atob: (s)=> Buffer.from(s, 'base64').toString('binary'),
    btoa: (s)=> Buffer.from(s, 'binary').toString('base64'),
    location: { search: '' },
  };

  // create a proper `window` object inside context and attach document
  ctx.window = {
    document
  };
  ctx.document = document;

  // Provide minimal app helper functions and settings on window
  ctx.window.settings = {
    fields: [ { id: 'field_a', label: 'Field A' }, { id: 'field_b', label: 'Field B' } ],
    primaryFields: ['field_a','field_b'],
    scanOperation: 'equals'
  };

  ctx.window.getPrimaryFieldId = () => (ctx.window.settings.primaryFields && ctx.window.settings.primaryFields[0]) || '';
  ctx.window.getValueFromRow = (row, fieldId) => row && row[fieldId] ? String(row[fieldId]) : '';
  ctx.window.currentSelectedRow = { field_a: 'VAL1', field_b: 'VAL2' };

  // Logging save stubs
  ctx.window.saveScanLogRealtime = async (log) => { console.log('[LOG SAVED]', log); };
  ctx.window.saveErrorScanLogRealtime = async (log) => { console.log('[ERROR LOG SAVED]', log); };
  ctx.window.showPinVerification = async () => { console.log('[PIN] verification invoked'); return true; };

  // Expose required globals
  const context = vm.createContext(ctx);

  // Load scan-manager.js source
  const scanMgrSrc = fs.readFileSync('scan-manager.js','utf8');
  try {
    vm.runInContext(scanMgrSrc, context, { filename: 'scan-manager.js' });
    console.log('scan-manager loaded into test context.');
  } catch (e) {
    console.error('Failed to evaluate scan-manager.js:', e);
    process.exit(1);
  }

  // Create input elements for fields
  const fieldA = document.getElementById('field_a'); fieldA.value = ctx.window.getValueFromRow(ctx.window.currentSelectedRow,'field_a');
  const fieldB = document.getElementById('field_b'); fieldB.value = ctx.window.getValueFromRow(ctx.window.currentSelectedRow,'field_b');

  // Ensure scan-by exists
  document.getElementById('scan-by').value = 'TEST_SCANNER';

  // Start session
  try {
    ctx.window.scanManager.startSessionForCurrentPart();
    console.log('Session started. Required fields:', Array.from(ctx.window.scanManager.scanSession.requiredFields || []));
  } catch (e) { console.error('startSession error', e); }

  // Helper to print panel state
  function dumpPanel() {
    const panel = document.getElementById('multi-scan-panel');
    if (!panel) { console.log('No panel present'); return; }
    const list = panel.querySelector('#multi-scan-list');
    if (!list) { console.log('Panel present but no list'); return; }
    console.log('--- PANEL ITEMS ---');
    list.children.forEach((item)=>{
      const fid = item.dataset.fieldId;
      let state = 'UNKNOWN';
      try {
        const q = item.querySelector && item.querySelector('.multi-scan-state');
        if (q && q.textContent) state = q.textContent;
        else if (typeof item.innerHTML === 'string') {
          const m = item.innerHTML.match(/class=\"multi-scan-state\"[^>]*>([^<]*)</);
          if (m && m[1]) state = m[1];
        }
      } catch (e) {}
      console.log(fid, '->', state);
    });
    const overall = panel.querySelector('#multi-scan-overall');
    if (overall) console.log('Overall:', overall.textContent);
    const progFill = panel.querySelector('#multi-scan-progress-fill');
    if (progFill) console.log('Progress width:', progFill.style.width);
  }

  // Simulate correct first field scan
  console.log('\nSimulating scan for first field (expected VAL1)...');
  await ctx.window.scanManager.handleScan('VAL1');
  console.log('Matched fields now:', Array.from(ctx.window.scanManager.scanSession.matchedFields || []));
  // Force update panel (debug)
  try { ctx.window.scanManager._updatePanelStatus(); } catch(e) { console.error('_updatePanelStatus call error', e); }
  dumpPanel();

  // Simulate correct second field scan
  console.log('\nSimulating scan for second field (expected VAL2)...');
  await ctx.window.scanManager.handleScan('VAL2');
  console.log('Matched fields now:', Array.from(ctx.window.scanManager.scanSession.matchedFields || []));
  try { ctx.window.scanManager._updatePanelStatus(); } catch(e) { console.error('_updatePanelStatus call error', e); }
  dumpPanel();

  // Now simulate a failing sequence
  ctx.window.currentSelectedRow = { field_a: 'ABC', field_b: 'DEF' };
  // update inputs
  document.getElementById('field_a').value = 'ABC';
  document.getElementById('field_b').value = 'DEF';
  ctx.window.scanManager.startSessionForCurrentPart();
  console.log('New session required fields:', Array.from(ctx.window.scanManager.scanSession.requiredFields || []));
  console.log('\nSimulating failing scan for first field (sending WRONG)...');
  await ctx.window.scanManager.handleScan('WRONG');
  console.log('Matched fields after fail:', Array.from(ctx.window.scanManager.scanSession.matchedFields || []));
  dumpPanel();

  console.log('\nTest complete.');
})();
