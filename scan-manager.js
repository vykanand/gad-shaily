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
        this.scanSession.matchedFields = new Set();
        const req = Array.isArray(window.settings && window.settings.primaryFields)
          ? window.settings.primaryFields.slice()
          : [];
        // If none configured, fallback to single primary
        if (!req || req.length === 0) {
          const p = window.getPrimaryFieldId && window.getPrimaryFieldId();
          if (p) req.push(p);
        }
        this.scanSession.requiredFields = req;
        this._highlightPendingFields();
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
    },

    _advanceToNextField: function () {
      const fields = this.scanSession.requiredFields || [];
      for (const fid of fields) {
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
          }
          return fid;
        }
      }
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

    handleScan: async function (scannedCode) {
      try {
        const cleanedCode = scannedCode;
        if (!cleanedCode) return;

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

        const required = this.scanSession.requiredFields || [];
        if (!required || required.length === 0) {
          console.log("scanManager: no required fields configured");
          return;
        }

        // Find current active field (first not matched)
        const currentField = required.find((f) => !this.scanSession.matchedFields.has(f));
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

        const isMatch = this._compare(cleanedCode, expected);
        const scannerInfo = document.getElementById("scan-by")?.value || "";

        // Build a log entry (include labels)
        const logEntry = {
          timestamp: new Date(),
          scannedCode: cleanedCode,
          scannerInfo: scannerInfo,
          matchStatus: isMatch ? "MATCHED_FIELD" : "NOT_MATCHED",
        };
        (window.settings?.fields || []).forEach((field) => {
          const input = document.getElementById(field.id);
          logEntry[field.label] = input ? input.value : "";
        });

        if (isMatch) {
          // Mark this input as passed
          const inp = document.getElementById(currentField);
          if (inp) {
            inp.classList.remove("scan-active", "scan-pending", "scan-failed");
            inp.classList.add("scan-passed");
          }

          // Save intermediate successful field scan
          try {
            if (typeof window.saveScanLogRealtime === 'function') window.saveScanLogRealtime(logEntry);
          } catch (e) {
            console.error('saveScanLogRealtime failed:', e);
          }

          // Mark matched and advance
          this.scanSession.matchedFields.add(currentField);
          const next = this._advanceToNextField();

          // If none left, final PASS
          const allPassed = required.every((f) => this.scanSession.matchedFields.has(f));
          if (allPassed) {
            // Show PASS UI similar to legacy behavior
            try {
              document.getElementById("scan-data-value").textContent = cleanedCode;
              document.getElementById("scan-status-value").textContent = "OK";
              document.getElementById("scan-status-value").classList.add("ok");
              document.getElementById("part-code-status-value").textContent = "DATA MATCHED";
              document.getElementById("part-code-status-value").classList.add("ok");
              const passEl = document.getElementById("pass-status");
              passEl.textContent = "PASS";
              passEl.classList.remove("failed");
              passEl.classList.add("pass-box");

              // Update scan quantity
              const scanQty = document.getElementById("scan-qty");
              if (scanQty) scanQty.value = String(Number(scanQty.value) + 1).padStart(5, "0");

              // Clear visuals after a short delay
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
              } catch (e) {
                console.error('final save failed', e);
              }
            } catch (e) {
              console.error('Error showing PASS UI:', e);
            }

            // Reset session for next set (but keep passed highlights)
            this.scanSession.matchedFields = new Set();
            return;
          }

          return;
        } else {
          // Failed to match current field
          const inp = document.getElementById(currentField);
          if (inp) {
            inp.classList.remove("scan-active", "scan-pending", "scan-passed");
            inp.classList.add("scan-failed");
          }

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
