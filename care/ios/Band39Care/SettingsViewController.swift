import UIKit

/// Server URL for the AI and voice features (Deepgram, OpenAI, ElevenLabs live on server/server.py, which holds the keys).
/// Empty = offline: the simulator, motion labels and pretend band still work; AI replies and voices fall back or show errors.
final class SettingsViewController: UIViewController, UITextFieldDelegate {
    private let current: String
    private let onSave: (String) -> Void
    private let field = UITextField()
    private let status = UILabel()
    private let testButton = UIButton(type: .system)

    init(current: String, onSave: @escaping (String) -> Void) {
        self.current = current
        self.onSave = onSave
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Server"
        view.backgroundColor = .systemGroupedBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Save", style: .done, target: self, action: #selector(save))

        let label = UILabel()
        label.text = "Band 39 server URL"
        label.font = .preferredFont(forTextStyle: .headline)

        field.text = current
        field.placeholder = "https://your-band39-server.example"
        field.borderStyle = .roundedRect
        field.keyboardType = .URL
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.clearButtonMode = .whileEditing
        field.returnKeyType = .done
        field.textContentType = .URL
        field.delegate = self
        field.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true

        let note = UILabel()
        note.numberOfLines = 0
        note.font = .preferredFont(forTextStyle: .footnote)
        note.textColor = .secondaryLabel
        note.text = "Pip's replies, voices, transcripts and Lisa's AI digests come from this server (python3 server/server.py). Leave it empty to stay offline: the simulator, motion and the pretend band still work. Saving reloads the app, so the current day starts over."

        testButton.setTitle("Test connection", for: .normal)
        testButton.contentHorizontalAlignment = .leading
        testButton.addTarget(self, action: #selector(test), for: .touchUpInside)

        status.numberOfLines = 0
        status.font = .preferredFont(forTextStyle: .footnote)
        status.textColor = .secondaryLabel
        status.text = current.isEmpty ? "Now: offline (no server)." : "Now: \(current)"

        let stack = UIStackView(arrangedSubviews: [label, field, note, testButton, status])
        stack.axis = .vertical
        stack.spacing = 12
        stack.setCustomSpacing(6, after: label)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
    }

    /// "" for empty; otherwise an http(s) URL with no trailing slash, or nil if it isn't one.
    static func normalize(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return "" }
        if !s.contains("://") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let u = URL(string: s), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = u.host, !host.isEmpty else { return nil }
        return s
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }

    @objc private func cancel() { dismiss(animated: true) }

    @objc private func save() {
        guard let url = Self.normalize(field.text ?? "") else { return showStatus("That doesn't look like a web address (for example https://my-server.example).", error: true) }
        onSave(url)
        dismiss(animated: true)
    }

    @objc private func test() {
        guard let base = Self.normalize(field.text ?? ""), !base.isEmpty, let url = URL(string: base + "/api/config") else {
            return showStatus("Type a server address first.", error: true)
        }
        showStatus("Checking \(url.absoluteString)…", error: false)
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            let text: String, bad: Bool
            if let error = error {
                text = "Could not reach it: \(error.localizedDescription)"; bad = true
            } else if let data = data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                func on(_ k: String) -> String { (j[k] as? Bool) == true ? "on" : "off" }
                text = "Connected. Deepgram \(on("deepgram")), OpenAI \(on("openai")), ElevenLabs \(on("elevenlabs")), Stripe \(on("stripe"))."
                bad = false
            } else {
                text = "It answered (HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)), but not like a Band 39 server."; bad = true
            }
            DispatchQueue.main.async { self?.showStatus(text, error: bad) }
        }.resume()
    }

    private func showStatus(_ text: String, error: Bool) {
        status.text = text
        status.textColor = error ? .systemRed : .secondaryLabel
    }
}
