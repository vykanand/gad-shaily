(function () {
  const scanManager = {
    // Initialize session state
    scanSession: {
      targetPart: null,
      matchedFields: new Set(),
      requiredFields: [],
    },

    startSessionForCurrentPart: function () {
      try {
        this.scanSession.targetPart = window.currentSelectedRow || null;
        // If no explicit selection, try resolve from primary input value
        if (!this.scanSession.targetPart) {
          try {
            const primaryId = (window.getPrimaryFieldId && window.getPrimaryFieldId()) || (window.settings && window.settings.primaryFields && window.settings.primaryFields[0]) || '';
            if (primaryId) {
              const el = document.getElementById(primaryId);
              const primaryVal = el ? (el.value || el.textContent || '') : '';
              if (primaryVal && typeof window.findPartDetails === 'function') {
                const resolved = window.findPartDetails(primaryVal);
                if (resolved) {
                  this.scanSession.targetPart = resolved;
                  // auto-resolved targetPart from primary input (no console output per final-only logging)
                    // Populate input fields from resolved targetPart so UI and logs have values
                    try {
                      const fields = (window.settings && window.settings.fields) || [];
                      fields.forEach(f => {
                        try {
                          const el = document.getElementById(f.id);
                          const val = (typeof window.getValueFromRow === 'function') ? window.getValueFromRow(resolved, f.id) : '';
                          if (el && val) el.value = val;
                        } catch(e){}
                      });
                    } catch(e){}
                }
              }
            }
          } catch (e) { console.warn('scanManager: auto-resolve primary failed', e); }
        }
        this.scanSession.matchedFields = new Set();
        // clear any manual active selection
        this.scanSession._manualActive = null;
        // scan sequence tracking
        this.scanSession._seqCounter = 0;
        this.scanSession._scanSequence = [];
        // Read configured primary fields robustly (support array or comma-separated string).
        // Try multiple places: window.settings.primaryFields, window.settings.primaryField (legacy),
        // finally attempt to read local settings.json file as a last-resort fallback.
        let req = [];
        try {
          const pf = window.settings && window.settings.primaryFields;
          if (Array.isArray(pf) && pf.length > 0) {
            req = pf.slice();
            // primaryFields sourced from window.settings.primaryFields (silent)
          } else if (typeof pf === 'string' && pf.trim()) {
            req = pf.split(',').map(s => s.trim()).filter(Boolean);
            // primaryFields parsed from window.settings.primaryFields (string) (silent)
          } else {
            // Check legacy singular key
            const pfSing = window.settings && (window.settings.primaryField || window.settings.primary_field);
            if (pfSing && typeof pfSing === 'string' && pfSing.trim()) {
              req = [pfSing.trim()];
              // primaryFields derived from legacy window.settings.primaryField (silent)
            }
          }
        } catch (e) {
          req = [];
        }

        // Last resort: try loading settings.json from disk (synchronous XHR) to recover configuration
        if ((!req || req.length === 0) && typeof XMLHttpRequest !== 'undefined') {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'settings.json', false);
            xhr.send(null);
            if (xhr.status === 200) {
              try {
                const parsed = JSON.parse(xhr.responseText || '{}');
                if (Array.isArray(parsed.primaryFields) && parsed.primaryFields.length > 0) {
                  req = parsed.primaryFields.slice();
                  // primaryFields loaded from settings.json fallback (silent)
                } else if (typeof parsed.primaryField === 'string' && parsed.primaryField.trim()) {
                  req = [parsed.primaryField.trim()];
                  // primaryFields derived from settings.json.primaryField (legacy) (silent)
                }
              } catch (e) {
                console.warn && console.warn('scanManager: settings.json parse failed', e);
              }
            }
          } catch (e) {
            // Ignore network/file errors; this is best-effort
          }
        }

        // Ensure settings.fields exists; if missing, try to load settings.json (best-effort) so we can resolve labels
        try {
          let settingFields = window.settings && window.settings.fields;
          if (!Array.isArray(settingFields) || settingFields.length === 0) {
            // Attempt to load settings.json synchronously (best-effort fallback) to populate fields
            if (typeof XMLHttpRequest !== 'undefined') {
              try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', 'settings.json', false);
                xhr.send(null);
                if (xhr.status === 200) {
                  try {
                    const parsed = JSON.parse(xhr.responseText || '{}');
                    if (Array.isArray(parsed.fields) && parsed.fields.length > 0) {
                      window.settings = window.settings || {};
                      window.settings.fields = parsed.fields.slice();
                      settingFields = window.settings.fields;
                      // populated window.settings.fields from settings.json fallback (silent)
                    }
                  } catch (e) {
                    console.warn && console.warn('scanManager: parse settings.json failed', e);
                  }
                }
              } catch (e) {}
            }
          }

          const originalReq = req.slice();
          if (Array.isArray(settingFields) && settingFields.length > 0) {
            const knownIds = settingFields.map((f) => f.id).filter(Boolean);
            // Keep only known IDs. If this removes items, we will report missing DOM/setting entries.
            req = req.filter((id) => knownIds.includes(id));
          } else {
            // No settings.fields metadata available — keep configured list as-is
            req = originalReq.slice();
          }
        } catch (e) {
          console.warn && console.warn('scanManager: primaryFields filtering error', e);
        }

        // Detect missing DOM elements for required fields. If any are missing, mark the session invalid
        try {
          const missing = (req || []).filter(id => !document.getElementById(id));
          if (missing.length > 0) {
            console.error && console.error('scanManager: required primary field DOM elements not found:', missing);
            this.scanSession._hasMissingFields = true;
            this.scanSession._missingFields = missing.slice();
          } else {
            this.scanSession._hasMissingFields = false;
            this.scanSession._missingFields = [];
          }
        } catch(e) {
          this.scanSession._hasMissingFields = false;
          this.scanSession._missingFields = [];
        }

        // Log selected required fields and settings snapshot for diagnostics, including label mapping
        try {
          // primaryFields and settings.fields info suppressed to avoid intermediate logging
          const sf = window.settings && window.settings.fields;
        } catch (e) {}
        this.scanSession.requiredFields = req;
        this._ensurePanelExists();
        // ensure panel is visible for immediate user feedback
        try {
          const p = document.getElementById('multi-scan-panel'); if (p) p.style.display = 'block';
        } catch (e) {}
        this._renderPanel(req);
        this._highlightPendingFields();

        // Attach click handlers to inputs so operator can manually pick active field
        try {
          (req || []).forEach((fid) => {
            const inp = document.getElementById(fid);
            if (!inp) return;
            inp.style.cursor = 'pointer';
            inp.addEventListener('click', (ev) => {
              try { this._setManualActiveField(fid); } catch (e) { console.error('manual active set error', e); }
            });
          });
        } catch (e) {}
      } catch (e) {
        console.error("scanManager.startSessionForCurrentPart error:", e);
      }
    },

    _highlightPendingFields: function () {
      const fields = this.scanSession.requiredFields || [];
      fields.forEach((fid, idx) => {
        const input = document.getElementById(fid);
        if (!input) return;
        input.classList.remove("scan-active", "scan-passed", "scan-failed");
        input.classList.add("scan-pending");
      });
      // If operator manually selected a field, honour that
      const manual = this.scanSession._manualActive;
      if (manual && fields.includes(manual) && !this.scanSession.matchedFields.has(manual)) {
        const mEl = document.getElementById(manual);
        if (mEl) {
          mEl.classList.remove('scan-pending');
          mEl.classList.add('scan-active');
          try { mEl.focus(); } catch (e) {}
        }
        this._updatePanelStatus();
        return;
      }

      // mark first as active
      const first = fields[0];
      if (first) {
        const firstInput = document.getElementById(first);
        if (firstInput) {
          firstInput.classList.remove("scan-pending");
          firstInput.classList.add("scan-active");
          try {
            firstInput.focus();
          } catch (e) {}
        }
      }
      // update panel visuals
      this._updatePanelStatus();
    },

    _advanceToNextField: function () {
      const fields = this.scanSession.requiredFields || [];
      for (const fid of fields) {
        // if manual active is set, skip advancing past it until it's matched
        if (this.scanSession._manualActive && this.scanSession._manualActive !== fid && !this.scanSession.matchedFields.has(this.scanSession._manualActive)) {
          // keep the manual active in place
          return this.scanSession._manualActive;
        }
        if (!this.scanSession.matchedFields.has(fid)) {
          // set this as active
          fields.forEach((f) => {
            const inp = document.getElementById(f);
            if (!inp) return;
            inp.classList.remove("scan-active");
            if (!this.scanSession.matchedFields.has(f)) inp.classList.add("scan-pending");
          });
          const next = document.getElementById(fid);
          if (next) {
            next.classList.remove("scan-pending");
            next.classList.add("scan-active");
            try { next.focus(); } catch (e) {}
          try { const lab = (window.settings && window.settings.fields || []).find(f=>f.id===fid)?.label || fid; /* advanced to active field (silent) */ } catch(e){}
          }
          this._updatePanelStatus();
          return fid;
        }
      }
      this._updatePanelStatus();
      return null;
    },

    _compare: function (cleanedCode, expectedValue) {
      const op = (window.settings && window.settings.scanOperation) || "equals";
      try {
        if (op === "equals") return cleanedCode === expectedValue;
        if (op === "contains") return cleanedCode.includes(expectedValue) || expectedValue.includes(cleanedCode);
        if (op === "startsWith") return cleanedCode.startsWith(expectedValue) || expectedValue.startsWith(cleanedCode);
        if (op === "regex") {
          const re = new RegExp(expectedValue);
          return re.test(cleanedCode);
        }
      } catch (e) {
        console.error("scanManager compare error, falling back to equals", e);
        return cleanedCode === expectedValue;
      }
      return false;
    },

    /********** Panel UI helpers **********/
    _ensurePanelExists: function () {
      try {
        if (document.getElementById('multi-scan-panel')) return;
        const container = document.createElement('div');
        container.id = 'multi-scan-panel';
        container.style.padding = '10px';
        container.style.marginTop = '12px';
        container.style.background = 'linear-gradient(90deg,#002b55, #003b77)';
        container.style.borderRadius = '8px';
        container.style.color = 'white';
        container.style.fontSize = '14px';
        container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
        container.innerHTML = `
          <div id="multi-scan-title" style="font-weight:700; color: #ffd54f; margin-bottom:8px">Multi-field Scan Status</div>
          <div id="multi-scan-list" style="display:flex;flex-direction:column;gap:6px"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
            <div id="multi-scan-progress" style="flex:1;height:8px;background:#07315a;border-radius:6px;margin-right:8px;overflow:hidden">
              <div id="multi-scan-progress-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#00c853,#b2ff59);"></div>
            </div>
            <div id="multi-scan-overall" style="min-width:110px;text-align:center;padding:6px 10px;border-radius:6px;background:#1f4e79;font-weight:700">READY</div>
          </div>`;

        // Try to insert into right-section or fallback to body
        const right = document.getElementById('status-section') || document.getElementById('main-content') || document.body;
        right.appendChild(container);
      } catch (e) {
        console.error('scanManager._ensurePanelExists error', e);
      }
    },

    _renderPanel: function (fields) {
      try {
        this._ensurePanelExists();
        const list = document.getElementById('multi-scan-list');
        if (!list) return;
        list.innerHTML = '';
        (fields || []).forEach((fid) => {
          const label = (window.settings && (window.settings.fields || []).find(f=>f.id===fid)?.label) || fid;
          const item = document.createElement('div');
          item.className = 'multi-scan-item';
          item.dataset.fieldId = fid;
          item.style.display = 'flex';
          item.style.alignItems = 'center';
          item.style.justifyContent = 'space-between';
          item.style.padding = '6px 8px';
          item.style.borderRadius = '6px';
          item.style.background = 'rgba(255,255,255,0.03)';
          item.innerHTML = `<div style="display:flex;gap:10px;align-items:center"><div class="multi-scan-icon" style="width:14px;height:14px;border-radius:50%;background:#ffd54f"></div><div style="font-weight:600">${label}</div></div><div class="multi-scan-state" style="font-weight:700;color:#ffd54f">PENDING</div>`;
          // clicking a panel item manually activates that field for scanning
          try { item.addEventListener('click', () => { this._setManualActiveField(fid); }); } catch(e){}
          list.appendChild(item);
        });
        this._updatePanelStatus();
      } catch (e) {
        console.error('scanManager._renderPanel error', e);
      }
    },

    _setManualActiveField: function (fid) {
      try {
        if (!fid) return;
        // clear any previously active classes
        const fields = this.scanSession.requiredFields || [];
        fields.forEach((f) => {
          const inp = document.getElementById(f);
          if (!inp) return;
          inp.classList.remove('scan-active');
          if (!this.scanSession.matchedFields.has(f)) inp.classList.add('scan-pending');
        });

        // set manual active
        this.scanSession._manualActive = fid;
        const el = document.getElementById(fid);
        if (el) {
          el.classList.remove('scan-pending', 'scan-failed');
          el.classList.add('scan-active');
          try { el.focus(); } catch (e) {}
        }
        try { const lab = (window.settings && window.settings.fields || []).find(f=>f.id===fid)?.label || fid; /* manual active field set (silent) */ } catch(e){}
        // ensure panel reflects manual active
        try { this._updatePanelStatus(); } catch (e) {}
      } catch (e) {
        console.error('scanManager._setManualActiveField error', e);
      }
    },

    _updatePanelStatus: function () {
      try {
        const fields = this.scanSession.requiredFields || [];
        const total = fields.length || 1;
        let passed = 0;
        const allPassed = fields.length > 0 && fields.every((f) => this.scanSession.matchedFields.has(f));
        fields.forEach((fid) => {
          const item = document.querySelector(`#multi-scan-list .multi-scan-item[data-field-id="${fid}"]`);
          const stateEl = item?.querySelector('.multi-scan-state');
          const icon = item?.querySelector('.multi-scan-icon');
          if (!item || !stateEl) return;
          if (this.scanSession.matchedFields.has(fid)) {
            passed++;
            if (allPassed) {
              // Final overall pass - green
              stateEl.textContent = 'PASSED';
              stateEl.style.color = '#022';
              item.style.background = 'rgba(0,200,83,0.12)';
              if (icon) icon.style.background = '#00c853';
            } else {
              // Intermediate per-field pass: show yellow so operator sees progress
              stateEl.textContent = 'PASSED';
              stateEl.style.color = '#000';
              item.style.background = 'rgba(255,213,79,0.16)';
              if (icon) icon.style.background = '#ffd54f';
            }
          } else {
            const inp = document.getElementById(fid);
            if (inp && inp.classList.contains('scan-active')) {
              // Use yellow visual for active scanning (operator-friendly)
              stateEl.textContent = 'SCANNING';
              stateEl.style.color = '#000000';
              item.style.background = 'rgba(255,213,79,0.16)';
              if (icon) icon.style.background = '#ffd54f';
            } else if (inp && inp.classList.contains('scan-failed')) {
              stateEl.textContent = 'FAILED';
              stateEl.style.color = '#fff';
              item.style.background = 'rgba(255,59,48,0.15)';
              if (icon) icon.style.background = '#ff3b30';
            } else {
              stateEl.textContent = 'PENDING';
              stateEl.style.color = '#ffd54f';
              item.style.background = 'rgba(255,255,255,0.03)';
              if (icon) icon.style.background = '#ffd54f';
            }
          }
        });

        const pct = Math.round((passed / total) * 100);
        const fill = document.getElementById('multi-scan-progress-fill');
        if (fill) fill.style.width = pct + '%';

        const overall = document.getElementById('multi-scan-overall');
        if (overall) {
          if (passed === total) {
            overall.textContent = 'All Passed';
            overall.style.background = 'linear-gradient(90deg,#00c853,#66bb6a)';
            overall.style.color = '#022';
          } else if (passed === 0) {
            overall.textContent = 'WAITING';
            overall.style.background = '#1f4e79';
            overall.style.color = '#ffd54f';
          } else {
            overall.textContent = `${passed}/${total}`;
            overall.style.background = 'linear-gradient(90deg,#ffd54f,#ffb300)';
            overall.style.color = '#022';
          }
        }
      } catch (e) {
        console.error('scanManager._updatePanelStatus error', e);
      }
    },

    _clearPanelAfterDelay: function (delayMs) {
      try {
        clearTimeout(this._panelClearTimer);
        this._panelClearTimer = setTimeout(() => {
          const panel = document.getElementById('multi-scan-panel');
          if (panel) panel.style.display = 'none';
        }, delayMs || 1200);
      } catch (e) {
        console.error('scanManager._clearPanelAfterDelay error', e);
      }
    },


    handleScan: async function (scannedCode) {
      try {
        const cleanedCode = scannedCode;
        if (!cleanedCode) return;

        // Diagnostic logging and sequence tracking for each scan
        try {
          this.scanSession._seqCounter = (this.scanSession._seqCounter || 0) + 1;
          const seqNum = this.scanSession._seqCounter;
          const seqRec = { seq: seqNum, timestamp: new Date(), scannedCode: cleanedCode };
          // attach a temporary current record for enrichment later
          this.scanSession._currentScanRecord = seqRec;
          // NOTE: per configuration, do not emit debug/console logs for intermediate scans here.
        } catch (e) {}

        // Ensure session target
        if (!this.scanSession.targetPart) {
          // attempt to start session from current selection
          this.startSessionForCurrentPart();
          if (!this.scanSession.targetPart) {
            // nothing to match against - fall back to legacy behavior by returning to main handler
            console.log("scanManager: no target part selected, falling back");
            return;
          }
        }

        let required = this.scanSession.requiredFields || [];
        // If required fields are not yet initialized, try to start a session now
        if (!required || required.length === 0) {
          try {
            this.startSessionForCurrentPart();
            required = this.scanSession.requiredFields || [];
            // ensure panel visible
            try { const p = document.getElementById('multi-scan-panel'); if (p) p.style.display = 'block'; } catch(e){}
            try { this._renderPanel(required); this._highlightPendingFields(); } catch(e){}
          } catch (e) { console.warn('scanManager: failed to initialize session on-demand', e); }
        }

        if (!required || required.length === 0) {
          console.log("scanManager: no required fields configured");
          return;
        }

        // If session was flagged as having missing fields, abort and instruct operator
        if (this.scanSession._hasMissingFields) {
          try {
            console.error && console.error('scanManager: cannot proceed with scanning - required fields missing in DOM or settings:', this.scanSession._missingFields || []);
          } catch (e) {}
          return;
        }

        // Determine current active field: prefer manual active if set and not matched
        let currentField = null;
        if (this.scanSession._manualActive && !this.scanSession.matchedFields.has(this.scanSession._manualActive)) {
          currentField = this.scanSession._manualActive;
        } else {
          currentField = required.find((f) => !this.scanSession.matchedFields.has(f));
        }
        try {
          const fldDef = (window.settings && window.settings.fields || []).find(ff=>ff.id===currentField) || null;
          let fldLabel = fldDef ? fldDef.label : null;
          if (!fldLabel) {
            // Try DOM label fallback
            try {
              const domLabel = document.querySelector(`label[for="${currentField}"]`);
              if (domLabel && domLabel.textContent) fldLabel = domLabel.textContent.trim();
            } catch(e) {}
          }
          if (!fldLabel) fldLabel = currentField;
          // active field determined (no console info emitted per final-only logging policy)
          if (!fldDef) console.warn && console.warn('scanManager: activeField had no matching settings.fields entry', { currentField });
        } catch(e) {}
        if (!currentField) {
          // All matched already
          console.log("scanManager: all fields already matched");
          return;
        }

        // Determine expected value for this field
        let expected = "";
        if (this.scanSession.targetPart) {
          expected = window.getValueFromRow
            ? window.getValueFromRow(this.scanSession.targetPart, currentField)
            : "";
        }
        if (!expected) {
          const input = document.getElementById(currentField);
          expected = input ? input.value : "";
        }

        try {
          const fld = (window.settings && window.settings.fields || []).find(f=>f.id===currentField) || {};
          // Matching field (silent)
          // enrich current scan record
          try {
            const rec = this.scanSession._currentScanRecord;
            if (rec) {
              rec.fieldId = currentField;
              rec.fieldLabel = fld.label || currentField;
              rec.expected = expected;
            }
          } catch (e) {}
        } catch (e) {}

        const isMatch = this._compare(cleanedCode, expected);
        const scannerInfo = document.getElementById("scan-by")?.value || "";

        // Build a log entry (include labels). Prefer master-data lookup via getValueFromRow,
        // fallback to DOM input value if necessary.
        const logEntry = {
          timestamp: new Date(),
          scannedCode: cleanedCode,
          scannerInfo: scannerInfo,
          matchStatus: isMatch ? "MATCHED_FIELD" : "NOT_MATCHED",
        };
        (window.settings?.fields || []).forEach((field) => {
          let val = "";
          try {
            if (this.scanSession.targetPart && typeof window.getValueFromRow === 'function') {
              val = window.getValueFromRow(this.scanSession.targetPart, field.id) || "";
            }
          } catch (e) { val = ""; }
          if (!val) {
            const input = document.getElementById(field.id);
            if (input) val = input.value || "";
          }
          logEntry[field.label] = val;
        });

        if (isMatch) {
          // Mark this input as passed
          const inp = document.getElementById(currentField);
          if (inp) {
            inp.classList.remove("scan-active", "scan-pending", "scan-failed");
            inp.classList.add("scan-passed");
          }

          // Mark matched and advance
          this.scanSession.matchedFields.add(currentField);
          // finalize and store sequence record
          try {
            const rec = this.scanSession._currentScanRecord;
            if (rec) {
              rec.matched = true;
              rec.result = 'MATCHED';
              this.scanSession._scanSequence.push(rec);
              // do not log matched events until final pass
            }
          } catch (e) {}
          // If operator had manually selected this field, clear manual active now
          if (this.scanSession._manualActive === currentField) this.scanSession._manualActive = null;
          const next = this._advanceToNextField();
          // Intermediate matched field — do not log to console per final-only logging policy.
          // Refresh panel after marking match
          try { this._updatePanelStatus(); } catch (e) {}

          // If none left, final PASS
          const allPassed = required.length > 0 && required.every((f) => this.scanSession.matchedFields.has(f));
          if (allPassed) {
            // Show PASS UI similar to legacy behavior
            try {
              document.getElementById("scan-data-value").textContent = cleanedCode;
              document.getElementById("scan-status-value").textContent = "OK";
              document.getElementById("scan-status-value").classList.add("ok");
              document.getElementById("part-code-status-value").textContent = "DATA MATCHED";
              document.getElementById("part-code-status-value").classList.add("ok");
              const passEl = document.getElementById("pass-status");
              passEl.textContent = "All Passed";
              passEl.classList.remove("failed");
              passEl.classList.add("pass-box");

              // Also update the multi-scan overall indicator to reflect final pass
              try {
                const overall = document.getElementById('multi-scan-overall');
                if (overall) {
                  overall.textContent = 'All Passed';
                  overall.style.background = 'linear-gradient(90deg,#00c853,#66bb6a)';
                  overall.style.color = '#022';
                }
              } catch (e) {}

              // Update scan quantity
              const scanQty = document.getElementById("scan-qty");
              if (scanQty) scanQty.value = String(Number(scanQty.value) + 1).padStart(5, "0");

              // Clear visuals after a short delay for final pass
              setTimeout(() => {
                passEl.textContent = "READY";
                passEl.classList.remove("pass-box");
                const sdv = document.getElementById("scan-data-value");
                if (sdv) sdv.textContent = "";
                document.getElementById("scan-status-value").textContent = "";
                document.getElementById("scan-status-value").classList.remove("ok");
                document.getElementById("part-code-status-value").textContent = "";
                document.getElementById("part-code-status-value").classList.remove("ok");
                // Keep passed fields green
              }, 1000);

              // Final save (optional)
              try {
                const finalLog = Object.assign({}, logEntry, { matchStatus: 'ALL_FIELDS_MATCHED' });
                if (typeof window.saveScanLogRealtime === 'function') window.saveScanLogRealtime(finalLog);
                // Emit consolidated sequence log now that all fields passed
                try {
                  console.info && console.info('scanManager: ALL_FIELDS_MATCHED - sequence:', this.scanSession._scanSequence || []);
                  console.info && console.info('scanManager: finalLog saved', finalLog);
                } catch (e) {}
              } catch (e) {
                console.error('final save failed', e);
              }
            } catch (e) {
              console.error('Error showing PASS UI:', e);
            }

            // Reset session for next set (but keep passed highlights)
            this.scanSession.matchedFields = new Set();
            try { this._updatePanelStatus(); } catch (e) {}
            try { this._clearPanelAfterDelay(1200); } catch (e) {}
            return;
          }

          // Intermediate matches update panel only; do not modify verification UI or emit logs here.

          return;
        } else {
          // Failed to match current field
          // finalize and store failed sequence record (do not emit console logs here; keep error saving unchanged)
          try {
            const rec = this.scanSession._currentScanRecord;
            if (rec) {
              rec.matched = false;
              rec.result = 'NOT_MATCHED';
              this.scanSession._scanSequence.push(rec);
            }
          } catch (e) {}
          try { console.warn && console.warn('scanManager: field NOT_MATCHED', { id: currentField, label: (window.settings && window.settings.fields || []).find(f=>f.id===currentField)?.label || currentField, scanned: cleanedCode, expected }); } catch(e){}
          const inp = document.getElementById(currentField);
          if (inp) {
            inp.classList.remove("scan-active", "scan-pending", "scan-passed");
            inp.classList.add("scan-failed");
          }
          try { this._updatePanelStatus(); } catch(e) {}

          try {
            if (typeof window.saveErrorScanLogRealtime === 'function') window.saveErrorScanLogRealtime(logEntry);
          } catch (e) {
            console.error('saveErrorScanLogRealtime failed:', e);
          }

          // Play error sound and visuals
          try {
            const errorSound = document.getElementById("error-sound");
            if (errorSound) {
              errorSound.loop = true;
              errorSound.play();
              setTimeout(() => {
                errorSound.pause();
                errorSound.currentTime = 0;
              }, 6000);
            }
          } catch (e) {
            console.error('Error playing error sound:', e);
          }

          try {
            const blinkOverlay = document.getElementById("blink-overlay");
            if (blinkOverlay) {
              blinkOverlay.style.display = "block";
              setTimeout(() => (blinkOverlay.style.display = "none"), 6000);
            }
          } catch (e) {}

          // Show PIN verification and handle clearing failed state upon success
          try {
            const verified = await window.showPinVerification?.();
            if (verified) {
              // Clear failed indicators
              const failedInp = document.getElementById(currentField);
              if (failedInp) {
                failedInp.classList.remove("scan-failed");
                failedInp.classList.add("scan-pending");
              }
              const passEl = document.getElementById("pass-status");
              passEl.textContent = "READY";
              passEl.classList.remove("failed");
              try { this._updatePanelStatus(); } catch(e) {}
            }
          } catch (e) {
            console.error('PIN verification error:', e);
          }

          return;
        }
      } catch (error) {
        console.error("scanManager.handleScan error:", error);
      }
    },
  };

  // Expose globally
  window.scanManager = scanManager;
})();
