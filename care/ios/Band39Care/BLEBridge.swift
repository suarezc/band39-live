import CoreBluetooth
import Foundation
import WebKit

/// CoreBluetooth for the page. iPhone browsers have no Web Bluetooth, so the page's
/// NativeBleTransport (web/js/native-ble.js) sends `open`, `reopen`, `send` and `close` here, and
/// gets back results, frames and `closed`. It only ever connects to the exact name the page asks
/// for (Vexo-HACK-39) that also advertises the band's service: never the first Vexo band found.
/// Copied from band39-app/ios. The Bluetooth radio starts only when the page first asks to connect,
/// so the Bluetooth permission prompt appears on "Connect band 39", not at launch.
/// Untested on a real band in this app (same code as band39-app, which is also untested on a band).
final class BLEBridge: NSObject, WKScriptMessageHandler, CBCentralManagerDelegate, CBPeripheralDelegate {
    weak var webView: WKWebView?

    private var _central: CBCentralManager?
    private var central: CBCentralManager {
        if let c = _central { return c }
        let c = CBCentralManager(delegate: self, queue: .main)
        _central = c
        return c
    }
    private var peripheral: CBPeripheral?
    private var rx: CBCharacteristic?
    private var tx: CBCharacteristic?
    private var targetName = ""
    private var serviceUUID = CBUUID(string: "254f0001-df82-4a9c-a2b5-563a0f6b2021")
    private var rxUUID = CBUUID(string: "254f0002-df82-4a9c-a2b5-563a0f6b2021")
    private var txUUID = CBUUID(string: "254f0003-df82-4a9c-a2b5-563a0f6b2021")
    private var openId: Int?
    private var sendIds: [Int] = []
    private var closing = false
    private var waitingForPower = false
    private var timer: Timer?
    private var seconds: Double = 25

    // MARK: page -> native
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        let id = body["id"] as? Int ?? 0
        if let s = body["seconds"] as? Double { seconds = s } else if let s = body["seconds"] as? Int { seconds = Double(s) }
        switch op {
        case "open":
            guard let name = body["name"] as? String, name.hasPrefix("Vexo-HACK-") else {
                return reply(id, ok: false, code: "bad-arg", message: "No band name given.")
            }
            targetName = name
            if let s = body["service"] as? String { serviceUUID = CBUUID(string: s) }
            if let s = body["rx"] as? String { rxUUID = CBUUID(string: s) }
            if let s = body["tx"] as? String { txUUID = CBUUID(string: s) }
            failOpen(code: "cancelled", message: "A new connect replaced the old one.")
            openId = id; closing = false
            if let p = peripheral, p.state != .disconnected { central.cancelPeripheralConnection(p) }
            peripheral = nil
            begin()
        case "reopen":
            failOpen(code: "cancelled", message: "A new connect replaced the old one.")
            openId = id; closing = false
            if let p = peripheral, central.state == .poweredOn {
                startTimer()
                central.connect(p, options: nil)
            } else { begin() }
        case "send":
            guard let p = peripheral, let rx = rx, p.state == .connected,
                  let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else {
                return reply(id, ok: false, code: "not-connected", message: "Not connected to a band.")
            }
            sendIds.append(id)
            p.writeValue(data, for: rx, type: .withResponse)
        case "close":
            closing = true
            stopTimer(); _central?.stopScan()
            failOpen(code: "cancelled", message: "Connecting was stopped.")
            if let p = peripheral, p.state != .disconnected { _central?.cancelPeripheralConnection(p) }
            reply(id, ok: true)
        default:
            reply(id, ok: false, code: "bad-arg", message: "Unknown request \(op).")
        }
    }

    // MARK: connecting
    private func begin() {
        switch central.state {
        case .poweredOn: scan()
        case .unauthorized:
            failOpen(code: "no-permission", message: "Band 39 Care is not allowed to use Bluetooth. Turn it on in Settings › Privacy & Security › Bluetooth, then try again.")
        case .poweredOff:
            failOpen(code: "bluetooth-off", message: "Bluetooth is off. Turn it on in Control Center, then try again.")
        case .unsupported:
            failOpen(code: "no-bluetooth", message: "This device has no Bluetooth Low Energy (the iOS Simulator has none: use a real iPhone or the Mac).")
        default:
            waitingForPower = true
            startTimer()
        }
    }

    private func scan() {
        waitingForPower = false
        startTimer()
        // Only bands with the Vexo Open service; the exact name is checked in didDiscover.
        central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    private func startTimer() {
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            self.central.stopScan()
            if let p = self.peripheral, p.state == .connecting { self.central.cancelPeripheralConnection(p) }
            self.failOpen(code: "not-found-nearby", message: "Could not see \(self.targetName). If something else is connected to it (the dashboard, a laptop, another phone), close that first: the band takes one connection at a time. Then double-tap the band (it blinks blue for a minute), keep it close, and try again.")
        }
    }
    private func stopTimer() { timer?.invalidate(); timer = nil }

    // MARK: CBCentralManagerDelegate
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if waitingForPower && openId != nil {
            if central.state == .poweredOn { scan() } else if central.state != .unknown && central.state != .resetting { begin() }
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? p.name
        guard name == targetName, peripheral == nil || peripheral === p else { return }   // our band only
        central.stopScan()
        peripheral = p
        p.delegate = self
        central.connect(p, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        p.discoverServices([serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        failOpen(code: "not-found-nearby", message: "Could not connect to \(targetName): \(error?.localizedDescription ?? "no answer"). Double-tap the band, keep it close, and try again.")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        rx = nil; tx = nil
        let ids = sendIds; sendIds = []
        for id in ids { reply(id, ok: false, code: "not-connected", message: "The band disconnected.") }
        if openId != nil { failOpen(code: "not-found-nearby", message: "\(targetName) disconnected while connecting. Double-tap it and try again.") }
        event(["type": "closed", "reason": closing ? "closed" : "lost"])
    }

    // MARK: CBPeripheralDelegate
    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard let service = p.services?.first(where: { $0.uuid == serviceUUID }) else {
            return failOpen(code: "not-found-nearby", message: "\(targetName) does not offer the Vexo Open service.")
        }
        p.discoverCharacteristics([rxUUID, txUUID], for: service)
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        rx = service.characteristics?.first(where: { $0.uuid == rxUUID })
        tx = service.characteristics?.first(where: { $0.uuid == txUUID })
        guard let tx = tx, rx != nil else {
            return failOpen(code: "not-found-nearby", message: "\(targetName) is missing a Vexo Open characteristic.")
        }
        p.setNotifyValue(true, for: tx)        // listen before the first command
    }

    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor c: CBCharacteristic, error: Error?) {
        guard c.uuid == txUUID else { return }
        if let error = error { return failOpen(code: "not-found-nearby", message: "Could not listen to \(targetName): \(error.localizedDescription)") }
        stopTimer()
        if let id = openId { openId = nil; reply(id, ok: true) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard c.uuid == txUUID, let value = c.value, error == nil else { return }
        event(["type": "frame", "data": value.base64EncodedString()])
    }

    func peripheral(_ p: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        guard !sendIds.isEmpty else { return }
        let id = sendIds.removeFirst()
        if let error = error { reply(id, ok: false, code: "ble-error", message: error.localizedDescription) } else { reply(id, ok: true) }
    }

    // MARK: native -> page
    private func failOpen(code: String, message: String) {
        stopTimer()
        waitingForPower = false
        guard let id = openId else { return }
        openId = nil
        reply(id, ok: false, code: code, message: message)
    }

    private func reply(_ id: Int, ok: Bool, code: String? = nil, message: String? = nil) {
        var e: [String: Any] = ["type": "result", "id": id, "ok": ok]
        if let code = code { e["code"] = code }
        if let message = message { e["message"] = message }
        event(e)
    }

    private func event(_ e: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: e), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__vexoBle && window.__vexoBle.event(\(json))", completionHandler: nil)
    }
}
