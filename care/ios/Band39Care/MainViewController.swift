import UIKit
import WebKit

/// One WKWebView holds the whole Band 39 care app (all state lives in that one page), and a native tab bar switches
/// roles by calling `VexoCare.go(...)`: Margaret (grandma portal), Lisa (caregiver portal), Simulator (30-second demo
/// or the full event simulator). No server sync is needed between roles: they are views of the same page.
final class MainViewController: UIViewController, UITabBarDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    enum Role: Int { case margaret = 0, lisa = 1, simulator = 2 }

    static let serverKey = "b39ServerURL"
    static var serverURL: String {
        get { UserDefaults.standard.string(forKey: serverKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: serverKey) }
    }

    private var webView: WKWebView!
    private let tabBar = UITabBar()
    private let simBar = UIView()
    private let simSwitch = UISegmentedControl(items: ["30-second demo", "Full simulator"])
    private let gear = UIButton(type: .system)
    private let bridge = BLEBridge()

    private var role: Role = .simulator
    private var lastTab: [Role: String] = [.margaret: "g-today", .lisa: "c-home"]
    private var webTopToView: NSLayoutConstraint!
    private var webTopToBar: NSLayoutConstraint!

    private static let paper = UIColor(red: 0.961, green: 0.933, blue: 0.898, alpha: 1)    // --paper #F5EEE5
    private static let sky = UIColor(red: 0.867, green: 0.937, blue: 1.0, alpha: 1)        // --bg1 #DDEFFF
    private static let accent = UIColor(red: 0.361, green: 0.247, blue: 0.839, alpha: 1)   // --violet-d #5C3FD6
    private static let terra = UIColor(red: 0.690, green: 0.325, blue: 0.184, alpha: 1)    // --terra #B0532F

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        #if DEBUG
        setvbuf(stdout, nil, _IONBF, 0)
        #endif
        view.backgroundColor = Self.paper
        buildWebView()
        buildSimBar()
        buildTabBar()
        layout()
        applyChrome()
        webView.load(URLRequest(url: startURL(hash: "#/")))
    }

    // MARK: - building

    private func buildWebView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.userContentController.add(bridge, name: "vexoBle")
        config.userContentController.add(self, name: "b39nav")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []      // Pip speaks hands-free
        installUserScripts(config.userContentController)

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never   // the page pads for the notch with env(safe-area-inset-*)
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view.addSubview(webView)
        bridge.webView = webView
    }

    /// Runs before any page script: the API base (read by web/js/api-base.js), the Bluetooth transport, and a tiny
    /// hook that tells the native tab bar when the page changes portal by itself (e.g. "Join" opens Lisa's portal).
    private func installUserScripts(_ ucc: WKUserContentController) {
        ucc.removeAllUserScripts()
        let base = Self.serverURL
        if !base.isEmpty, let data = try? JSONSerialization.data(withJSONObject: base, options: [.fragmentsAllowed]),
           let literal = String(data: data, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: "window.B39_API_BASE = \(literal);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if let url = Bundle.main.url(forResource: "native-ble", withExtension: "js"), let js = try? String(contentsOf: url, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let nav = """
        (function () {
          var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.b39nav; if (!h) return;
          var last = null;
          function tell() { var x = location.hash || '#/'; if (x !== last) { last = x; h.postMessage(x); } }
          var rs = history.replaceState, ps = history.pushState;
          history.replaceState = function () { var r = rs.apply(this, arguments); tell(); return r; };
          history.pushState = function () { var r = ps.apply(this, arguments); tell(); return r; };
          addEventListener('hashchange', tell);
          addEventListener('DOMContentLoaded', tell);
        })();
        """
        ucc.addUserScript(WKUserScript(source: nav, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func buildSimBar() {
        simBar.translatesAutoresizingMaskIntoConstraints = false
        simBar.backgroundColor = Self.paper
        let line = UIView()
        line.translatesAutoresizingMaskIntoConstraints = false
        line.backgroundColor = UIColor(red: 0.914, green: 0.871, blue: 0.820, alpha: 1)   // --line #E9DED1
        simBar.addSubview(line)

        simSwitch.translatesAutoresizingMaskIntoConstraints = false
        simSwitch.selectedSegmentIndex = 0
        simSwitch.selectedSegmentTintColor = Self.terra
        simSwitch.setTitleTextAttributes([.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 14, weight: .semibold)], for: .selected)
        simSwitch.setTitleTextAttributes([.foregroundColor: UIColor(red: 0.18, green: 0.14, blue: 0.12, alpha: 1), .font: UIFont.systemFont(ofSize: 14, weight: .medium)], for: .normal)
        simSwitch.addTarget(self, action: #selector(simSwitchChanged), for: .valueChanged)
        simBar.addSubview(simSwitch)

        gear.translatesAutoresizingMaskIntoConstraints = false
        gear.setImage(UIImage(systemName: "gearshape"), for: .normal)
        gear.tintColor = Self.terra
        gear.accessibilityLabel = "Server settings"
        gear.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        simBar.addSubview(gear)
        view.addSubview(simBar)

        NSLayoutConstraint.activate([
            simSwitch.leadingAnchor.constraint(equalTo: simBar.leadingAnchor, constant: 14),
            simSwitch.centerYAnchor.constraint(equalTo: simBar.centerYAnchor),
            simSwitch.trailingAnchor.constraint(lessThanOrEqualTo: gear.leadingAnchor, constant: -10),
            gear.trailingAnchor.constraint(equalTo: simBar.trailingAnchor, constant: -8),
            gear.centerYAnchor.constraint(equalTo: simBar.centerYAnchor),
            gear.widthAnchor.constraint(equalToConstant: 44),
            gear.heightAnchor.constraint(equalToConstant: 44),
            line.leadingAnchor.constraint(equalTo: simBar.leadingAnchor),
            line.trailingAnchor.constraint(equalTo: simBar.trailingAnchor),
            line.bottomAnchor.constraint(equalTo: simBar.bottomAnchor),
            line.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),
        ])
    }

    private func buildTabBar() {
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.tintColor = Self.accent
        let items = [
            UITabBarItem(title: "Margaret", image: UIImage(systemName: "person"), selectedImage: UIImage(systemName: "person.fill")),
            UITabBarItem(title: "Lisa", image: UIImage(systemName: "person.2"), selectedImage: UIImage(systemName: "person.2.fill")),
            UITabBarItem(title: "Simulator", image: UIImage(systemName: "play.rectangle"), selectedImage: UIImage(systemName: "play.rectangle.fill")),
        ]
        for (i, item) in items.enumerated() { item.tag = i }
        items[0].accessibilityHint = "Margaret's screen (the elderly role)"
        items[1].accessibilityHint = "Lisa's app (the caregiver role)"
        tabBar.items = items
        tabBar.selectedItem = items[Role.simulator.rawValue]
        view.addSubview(tabBar)
    }

    private func layout() {
        webTopToView = webView.topAnchor.constraint(equalTo: view.topAnchor)
        webTopToBar = webView.topAnchor.constraint(equalTo: simBar.bottomAnchor)
        NSLayoutConstraint.activate([
            simBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            simBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            simBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            simBar.heightAnchor.constraint(equalToConstant: 52),

            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: tabBar.topAnchor),

            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            tabBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -49),
        ])
    }

    /// Simulator tab: native top bar (demo / full switch + settings). Margaret and Lisa: the page runs edge to edge.
    private func applyChrome() {
        let sim = role == .simulator
        simBar.isHidden = !sim
        webTopToBar.isActive = sim
        webTopToView.isActive = !sim
        view.backgroundColor = sim ? Self.paper : Self.sky
        tabBar.selectedItem = tabBar.items?[role.rawValue]
    }

    private func startURL(hash: String) -> URL {
        URL(string: "\(BundleSchemeHandler.scheme)://app/index.html?embed=1\(hash)")!
    }

    // MARK: - switching roles

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard let r = Role(rawValue: item.tag) else { return }
        show(r)
    }

    @objc private func simSwitchChanged() { show(.simulator) }

    private func show(_ r: Role) {
        role = r
        applyChrome()
        let portal: String, tab: String?
        switch r {
        case .margaret: portal = "grandma"; tab = lastTab[.margaret]
        case .lisa: portal = "caregiver"; tab = lastTab[.lisa]
        case .simulator: portal = simSwitch.selectedSegmentIndex == 1 ? "sim" : "home"; tab = nil
        }
        let hash = portal == "home" ? "#/" : "#/\(portal)" + (tab.map { "/\($0)" } ?? "")
        let args = tab.map { "'\(portal)', '\($0)'" } ?? "'\(portal)'"
        // Before app.js has run, setting the hash is enough: the page routes from it on load.
        webView.evaluateJavaScript("if (window.VexoCare) VexoCare.go(\(args)); else location.hash = '\(hash)'; 0", completionHandler: nil)
    }

    /// The page moved on its own (a button inside it): keep the tab bar in step and remember each role's last tab.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "b39nav", let hash = message.body as? String else { return }
        let parts = hash.split(separator: "/").map(String.init)   // ["#", "grandma", "g-today"]
        let portal = parts.count > 1 ? parts[1] : ""
        let tab = parts.count > 2 ? parts[2] : nil
        let r: Role
        switch portal {
        case "grandma": r = .margaret; if let t = tab, !t.isEmpty { lastTab[.margaret] = t }
        case "caregiver": r = .lisa; if let t = tab, !t.isEmpty { lastTab[.lisa] = t }
        case "sim": r = .simulator; simSwitch.selectedSegmentIndex = 1
        default: r = .simulator; simSwitch.selectedSegmentIndex = 0
        }
        if r != role { role = r; applyChrome() }
    }

    // MARK: - settings

    @objc private func openSettings() {
        let settings = SettingsViewController(current: Self.serverURL) { [weak self] url in
            guard let self = self, url != Self.serverURL else { return }
            Self.serverURL = url
            self.installUserScripts(self.webView.configuration.userContentController)
            let hash = self.webView.url?.fragment.map { "#\($0)" } ?? "#/"
            self.webView.load(URLRequest(url: self.startURL(hash: hash)))   // the base is read once, at page start
        }
        let nav = UINavigationController(rootViewController: settings)
        if let sheet = nav.sheetPresentationController { sheet.detents = [.medium(), .large()]; sheet.prefersGrabberVisible = true }
        present(nav, animated: true)
    }

    // MARK: - WKNavigationDelegate / WKUIDelegate

    // Links to other sites (Stripe checkout, references) open in Safari, never inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, let scheme = url.scheme?.lowercased(),
           ![BundleSchemeHandler.scheme, "about", "blob", "data"].contains(scheme) {
            if action.targetFrame?.isMainFrame ?? true { UIApplication.shared.open(url) }
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    // Microphone for the page (Margaret talking to Pip). iOS still asks the person once (NSMicrophoneUsageDescription).
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == BundleSchemeHandler.scheme ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[load failed] \(error)")
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("[load failed] \(error)")
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        print("[web process ended] reloading"); webView.reload()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("[loaded] \(webView.url?.absoluteString ?? "")")
        #if DEBUG
        debugHooks()
        #endif
    }

    #if DEBUG
    // Verification only: Band39Care -tab 0|1|2 -run "<js>" -snapshot /path.png [-wait 6]
    // Switches tab natively, runs JS, then renders the whole window (tab bar included) to a PNG and quits.
    private func debugHooks() {
        let args = ProcessInfo.processInfo.arguments
        func arg(_ name: String) -> String? { args.firstIndex(of: name).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil } }
        if let t = arg("-tab").flatMap(Int.init), let r = Role(rawValue: t) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.show(r) }
        }
        if let js = arg("-run") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.webView.evaluateJavaScript(js, completionHandler: nil) }
        }
        guard let out = arg("-snapshot") else { return }
        let delay = Double(arg("-wait") ?? "") ?? 6
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            let probe = "JSON.stringify({portal: document.getElementById('app').dataset.portal, hash: location.hash, base: window.B39_API_BASE || '', nativeBle: !!window.VexoNativeBle, care: !!window.VexoCare})"
            self.webView.evaluateJavaScript(probe) { r, e in
                print("[page] \(r ?? "") \(e.map { "\($0)" } ?? "") role=\(self.role)")
                guard let window = self.view.window else { exit(1) }
                let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
                if let png = image.pngData() { try? png.write(to: URL(fileURLWithPath: out)); print("snapshot \(out)") }
                exit(0)
            }
        }
    }
    #endif
}
