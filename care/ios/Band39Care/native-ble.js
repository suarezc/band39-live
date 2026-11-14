/* Bluetooth for the iOS app (copied from band39-app/web/js/native-ble.js; the Band 39 Care app injects it as a
 * WKUserScript, and web/js/app.js already uses window.VexoNativeBle when it exists). iPhone browsers have no Web Bluetooth, so the app's Swift side
 * (BLEBridge.swift, CoreBluetooth) does the radio work and this file turns it into a kit
 * transport: Band.connect(39, { transport: new VexoNativeBle.NativeBleTransport(39) }).
 * Shape of a transport: vexo-open-kit/js/src/transport.js. Only defined inside the app.
 */
(function () {
  'use strict';
  const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vexoBle;
  if (!bridge) return;

  // From vexo-open-kit/contract/contract.md (codec.js): the band's service and its two characteristics.
  const SERVICE = '254f0001-df82-4a9c-a2b5-563a0f6b2021';
  const RX = '254f0002-df82-4a9c-a2b5-563a0f6b2021';   // we write commands here
  const TX = '254f0003-df82-4a9c-a2b5-563a0f6b2021';   // the band notifies frames here

  let seq = 0;
  const pending = new Map();
  let current = null;

  function vexoError(code, message) { const e = new Error(message); e.name = 'VexoError'; e.code = code; return e; }
  function call(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      bridge.postMessage(Object.assign({ op, id }, args || {}));
    });
  }
  const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
  const fromB64 = (b64) => { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

  // Swift calls this with one object per event.
  window.__vexoBle = {
    event(e) {
      if (e.type === 'result') {
        const p = pending.get(e.id); if (!p) return;
        pending.delete(e.id);
        if (e.ok) p.resolve(e.value); else p.reject(vexoError(e.code || 'ble-error', e.message || 'Bluetooth error'));
      } else if (e.type === 'frame') {
        if (current && current._up) current.onFrame(fromB64(e.data));
      } else if (e.type === 'closed') {
        if (current && current._up) { current._up = false; current.onClose(current._closing ? 'closed' : 'lost'); }
      }
    },
  };

  class NativeBleTransport {
    constructor(number) {
      this.kind = 'ble';
      this.bandName = 'Vexo-HACK-' + String(number).padStart(2, '0');   // the only band we look for
      this.onFrame = () => {};
      this.onClose = () => {};
      this._up = false; this._closing = false; this._writes = Promise.resolve();
    }
    async open() {
      current = this; this._closing = false; this._writes = Promise.resolve();
      await call('open', { name: this.bandName, service: SERVICE, rx: RX, tx: TX, seconds: 25 });
      this._up = true;
    }
    async reopen() {                       // auto-reconnect: same band, no new scan of other names
      current = this; this._closing = false; this._writes = Promise.resolve();
      await call('reopen', { seconds: 25 });
      this._up = true;
    }
    async close() { this._closing = true; try { await call('close'); } catch (_) { /* already closed */ } }
    send(frame) {
      const write = this._writes.then(() => {
        if (!this._up) throw vexoError('not-connected', 'Not connected to a band.');
        return call('send', { data: toB64(frame) });
      });
      this._writes = write.catch(() => {});
      return write;
    }
  }

  window.VexoNativeBle = { NativeBleTransport };
})();
