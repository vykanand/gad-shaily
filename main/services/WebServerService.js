const express = require('express');
const path = require('path');
const os = require('os');
const cors = require('cors');
const QRCode = require('qrcode');
const fs = require('fs').promises;
const fsSync = require('fs');
const { app, BrowserWindow } = require('electron');
const https = require('https');
const selfsigned = require('selfsigned');
const { Server: IOServer } = require('socket.io');

class WebServerService {
  constructor(moduleManager, onlineService, offlineService, syncService) {
    this.moduleManager = moduleManager;
    this.onlineService = onlineService;
    this.offlineService = offlineService;
    this.syncService = syncService;
    this.app = null;
    this.server = null;
    this.io = null;
    this.port = 3456;
    this.isRunning = false;
    this.displayAddress = null;
    this.tls = {
      enabled: false,
      keyPath: null,
      certPath: null,
      passphrase: null
    };

    this.configFile = path.join(app.getPath('userData'), 'data', 'server-config.json');

    try {
      const cfgDir = path.dirname(this.configFile);
      if (!fsSync.existsSync(cfgDir)) fsSync.mkdirSync(cfgDir, { recursive: true });

      if (fsSync.existsSync(this.configFile)) {
        try {
          const raw = fsSync.readFileSync(this.configFile, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed && parsed.displayAddress) this.displayAddress = parsed.displayAddress;
          if (parsed && parsed.port) this.port = parsed.port;
          if (parsed && parsed.tls) {
            this.tls = { ...this.tls, ...parsed.tls };
            if (this.tls.keyPath && this.tls.certPath) this.tls.enabled = true;
          }
        } catch (e) {
          console.warn('Failed to read server config, using defaults:', e && e.message);
        }
      }
    } catch (e) {
      console.warn('Error ensuring server config directory:', e && e.message);
    }
  }

  setTLSOptions({ keyPath, certPath, passphrase } = {}) {
    if (keyPath && certPath) {
      this.tls.enabled = true;
      this.tls.keyPath = keyPath;
      this.tls.certPath = certPath;
      this.tls.passphrase = passphrase || null;
      try {
        const cfg = this._readConfigFileSync();
        cfg.tls = { keyPath: this.tls.keyPath, certPath: this.tls.certPath };
        fsSync.writeFileSync(this.configFile, JSON.stringify(cfg, null, 2));
      } catch (e) {}
      return { success: true };
    }
    this.tls.enabled = false;
    this.tls.keyPath = null;
    this.tls.certPath = null;
    this.tls.passphrase = null;
    return { success: true };
  }

  async generateSelfSignedCerts() {
    try {
      const dataDir = path.dirname(this.configFile);
      if (!fsSync.existsSync(dataDir)) fsSync.mkdirSync(dataDir, { recursive: true });

      const localIps = this.getLocalIPAddresses().map(i => i.address);
      const altNames = [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: '::1' },
        ...localIps.filter(Boolean).map(ip => ({ type: 7, ip }))
      ];

      const caAttrs = [{ name: 'commonName', value: 'Local App CA' }];
      const caOpts = { days: 3650, keySize: 2048, algorithm: 'sha256' };
      const caPems = selfsigned.generate(caAttrs, caOpts);

      const caKeyPath = path.join(dataDir, 'ca-key.pem');
      const caCertPath = path.join(dataDir, 'ca-cert.pem');
      fsSync.writeFileSync(caKeyPath, caPems.private);
      fsSync.writeFileSync(caCertPath, caPems.cert);

      const serverAttrs = [{ name: 'commonName', value: 'localhost' }];
      const serverOpts = {
        days: 365,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
          { name: 'extKeyUsage', serverAuth: true }
        ],
        altNames,
        signWith: caPems.private
      };
      const serverPems = selfsigned.generate(serverAttrs, serverOpts);

      const keyPath = path.join(dataDir, 'server-key.pem');
      const certPath = path.join(dataDir, 'server-cert.pem');

      fsSync.writeFileSync(keyPath, serverPems.private);
      fsSync.writeFileSync(certPath, serverPems.cert);

      this.tls.enabled = true;
      this.tls.keyPath = keyPath;
      this.tls.certPath = certPath;
      this.tls.passphrase = null;

      try {
        const cfg = this._readConfigFileSync();
        cfg.tls = { keyPath: keyPath, certPath: certPath };
        fsSync.writeFileSync(this.configFile, JSON.stringify(cfg, null, 2));
      } catch (e) {}

      return { success: true, keyPath, certPath };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  }

  async regenerateTLS() {
    return this.generateSelfSignedCerts();
  }

  _readConfigFileSync() {
    try {
      if (fsSync.existsSync(this.configFile)) {
        const raw = fsSync.readFileSync(this.configFile, 'utf-8');
        return JSON.parse(raw || '{}');
      }
    } catch (e) {}
    return { displayAddress: this.displayAddress, port: this.port };
  }

  getLocalIPAddress() {
    const list = this.getLocalIPAddresses();
    return list.length > 0 ? list[0].address : 'localhost';
  }

  getLocalIPAddresses() {
    const interfaces = os.networkInterfaces();
    const results = [];

    for (const interfaceName in interfaces) {
      for (const iface of interfaces[interfaceName]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const nameLower = interfaceName.toLowerCase();
          let type = 'other';
          if (/wifi|wlan|wi[-_]?fi|wl/i.test(nameLower)) type = 'wifi';
          else if (/eth|en|ethernet|lan/i.test(nameLower)) type = 'lan';

          results.push({
            interface: interfaceName,
            address: iface.address,
            family: iface.family,
            mac: iface.mac,
            cidr: iface.cidr,
            type
          });
        }
      }
    }

    results.sort((a, b) => {
      const order = { wifi: 0, lan: 1, other: 2 };
      return (order[a.type] || 3) - (order[b.type] || 3);
    });

    return results;
  }

  async generateQRCode(url) {
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(url, { width: 256, margin: 2 });
      return qrCodeDataUrl;
    } catch (error) {
      console.error('Error generating QR code:', error);
      return null;
    }
  }

  setDisplayAddress(displayAddress) {
    this.displayAddress = displayAddress;
    try {
      const cfg = this._readConfigFileSync();
      cfg.displayAddress = this.displayAddress;
      fsSync.writeFileSync(this.configFile, JSON.stringify(cfg, null, 2));
    } catch (err) {
      console.error('Failed to persist server config:', err && err.message);
    }
  }

  async startServer() {
    if (this.isRunning) {
      return { success: false, error: 'Server is already running' };
    }

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    const rendererPath = path.join(__dirname, '../../');
    this.rendererPath = rendererPath;
    this.app.get('/libs/jsQR.js', (req, res) => {
      res.sendFile(path.join(rendererPath, 'libs', 'jsQR.js'));
    });
    this.app.get('/libs/jsQR.min.js', (req, res) => {
      res.sendFile(path.join(rendererPath, 'libs', 'jsQR.js'));
    });
    // Serve ZXing from priyank renderer libs if present
    this.app.get('/libs/zxing.min.js', (req, res) => {
      const alt = path.join(rendererPath, 'priyank', 'renderer', 'libs', 'zxing.min.js');
      try {
        if (fsSync.existsSync(alt)) return res.sendFile(alt);
      } catch (e) {}
      // fallback to project-level libs
      try { return res.sendFile(path.join(rendererPath, 'libs', 'zxing.min.js')); } catch (e) { return res.status(404).send('zxing not found'); }
    });
    // Serve beep.mp3 explicitly from project root if present
    this.app.get('/beep.mp3', (req, res) => {
      try {
        const beepPath = path.join(rendererPath, 'beep.mp3');
        if (fsSync.existsSync(beepPath)) return res.sendFile(beepPath);
      } catch (e) {}
      return res.status(404).send('beep not found');
    });
    this.app.use(express.static(rendererPath));

    // Mobile convenience: redirect mobile User-Agents to /mobile
    this.app.get('/', (req, res, next) => {
      try {
        const ua = (req.headers['user-agent'] || '').toLowerCase();
        if (/mobile|android|iphone|ipad|ipod|windows phone/.test(ua)) {
          return res.redirect('/mobile');
        }
      } catch (e) {}
      return next();
    });

    // Serve mobile.html explicitly at /mobile
    this.app.get('/mobile', (req, res) => {
      try {
        return res.sendFile(path.join(this.rendererPath, 'mobile.html'));
      } catch (e) {
        return res.status(500).send('mobile UI not available');
      }
    });

    this.setupAPIRoutes();

    const maxRetries = 8;
    let attempts = 0;
    let lastError = null;

    while (attempts < maxRetries) {
      try {
        await new Promise((resolve, reject) => {
          if (this.tls && this.tls.enabled && this.tls.keyPath && this.tls.certPath) {
            try {
              const key = fsSync.readFileSync(this.tls.keyPath);
              const cert = fsSync.readFileSync(this.tls.certPath);
              const creds = this.tls.passphrase ? { key, cert, passphrase: this.tls.passphrase } : { key, cert };
              try {
                const caCertPath = path.join(path.dirname(this.tls.certPath), 'ca-cert.pem');
                if (fsSync.existsSync(caCertPath)) {
                  const ca = fsSync.readFileSync(caCertPath);
                  creds.ca = [ca];
                }
              } catch (e) {}

              this.server = https.createServer(creds, this.app).listen(this.port, '0.0.0.0', () => {
                this.isRunning = true;
                resolve();
              }).on('error', (err) => reject(err));
            } catch (err) {
              return reject(err);
            }
          } else {
            this.server = this.app.listen(this.port, '0.0.0.0', () => {
              this.isRunning = true;
              resolve();
            }).on('error', (err) => {
              reject(err);
            });
          }
        });

        // Attach Socket.IO to the newly-created server so mobile clients can connect
        try {
          this.io = new IOServer(this.server, { cors: { origin: '*' } });
          this.io.on('connection', (socket) => {
            try {
              socket.on('mobile:scan', (data) => {
                try {
                  const wins = BrowserWindow.getAllWindows();
                  if (wins && wins[0] && wins[0].webContents) {
                    wins[0].webContents.send('mobile-scan', data);
                  }
                } catch (e) {}
              });

              socket.on('disconnect', () => {});
            } catch (e) {}
          });
        } catch (e) {
          console.warn('Socket.IO attach failed:', e && e.message);
          this.io = null;
        }

        const ipAddress = this.displayAddress || this.getLocalIPAddress();
        const protocol = (this.tls && this.tls.enabled) ? 'https' : 'http';
        const url = `${protocol}://${ipAddress}:${this.port}`;
        const mobileUrl = `${url.replace(/\/$/, '')}/mobile`;
        // Persist mobileUrl for status calls
        this.mobileUrl = mobileUrl;
        // Generate QR that opens the mobile-optimized page directly
        const qrCode = await this.generateQRCode(mobileUrl);

        try {
          const cfg = this._readConfigFileSync();
          cfg.displayAddress = this.displayAddress || ipAddress;
          cfg.port = this.port;
          fsSync.writeFileSync(this.configFile, JSON.stringify(cfg, null, 2));
        } catch (e) {
          console.warn('Failed to persist server config after start:', e && e.message);
        }

        return { success: true, url, mobileUrl, ipAddress, port: this.port, qrCode };
      } catch (err) {
        lastError = err;
        if (err && err.code === 'EADDRINUSE') {
          this.port++;
          attempts++;
          continue;
        }
        console.error('Error starting server:', err);
        return { success: false, error: err.message || String(err) };
      }
    }

    console.error('Failed to start server after retries:', lastError);
    return { success: false, error: lastError ? lastError.message : 'Failed to bind port' };
  }

  setupAPIRoutes() {
    this.app.get('/api/local-ips', async (req, res) => {
      try {
        const ips = this.getLocalIPAddresses();
        res.json({ success: true, ips });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/online/:moduleId/data', async (req, res) => {
      try {
        const module = await this.moduleManager.getModule(req.params.moduleId);
        const result = await this.onlineService.fetchData(module);
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Additional app-specific routes can be added here
  }

  // Broadcast a session/update object to connected mobile clients
  broadcastSessionUpdate(session) {
    try {
      if (this.io) {
        this.io.emit('session:update', session);
        return { success: true };
      }
      return { success: false, error: 'Socket server not running' };
    } catch (e) {
      return { success: false, error: e && e.message };
    }
  }

  async stopServer() {
    if (!this.isRunning || !this.server) {
      return { success: false, error: 'Server is not running' };
    }

    try {
      // close socket.io first if present
      try {
        if (this.io) {
          this.io.close();
          this.io = null;
        }
      } catch (e) {}

      await new Promise((resolve) => {
        this.server.close(() => {
          this.isRunning = false;
          this.server = null;
          this.app = null;
          resolve();
        });
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getServerStatus() {
    if (this.isRunning) {
      const ipAddress = this.displayAddress || this.getLocalIPAddress();
      const protocol = (this.tls && this.tls.enabled) ? 'https' : 'http';
      const baseUrl = `${protocol}://${ipAddress}:${this.port}`;
      const mobileUrl = this.mobileUrl || `${baseUrl.replace(/\/$/, '')}/mobile`;
      return (async () => {
        const qr = await this.generateQRCode(mobileUrl).catch(() => null);
        return { success: true, isRunning: true, url: baseUrl, mobileUrl, ipAddress, port: this.port, qrCode: qr };
      })();
    }
    return Promise.resolve({ success: true, isRunning: false });
  }

  getCAcert() {
    try {
      const caCertPath = path.join(path.dirname(this.configFile), 'ca-cert.pem');
      if (fsSync.existsSync(caCertPath)) {
        const cert = fsSync.readFileSync(caCertPath, 'utf-8');
        return { success: true, cert };
      } else {
        return { success: false, error: 'CA certificate not found' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = WebServerService;
