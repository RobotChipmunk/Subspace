import SwiftUI

struct AgentsModelOption: Decodable {
    var id: String
    var name: String
    var note: String?
}

/// What `GET runtime/options` returns (src/lib/core/runtime.ts).
struct AgentsRuntimeOptions: Decodable {
    var models: [AgentsModelOption]
    var efforts: [String]
    var contexts: [Int]
    var env_key: Bool?
}

struct AgentsOption: Identifiable {
    let id: String
    let label: String
}

/// One choice out of a few, as a row of equal segments.
struct AgentsSegmented: View {
    var label: String
    var hint: String?
    var value: String
    var options: [AgentsOption]
    var onChange: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                AgentsSectionLabel(label)
                Spacer(minLength: 0)
                if let hint, !hint.isEmpty {
                    Text(hint).font(.ssMeta).foregroundStyle(Theme.ink3).lineLimit(1)
                }
            }
            HStack(spacing: 0) {
                ForEach(options) { option in
                    segment(option)
                }
            }
            .padding(4)
            .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private func segment(_ option: AgentsOption) -> some View {
        let on = option.id == value
        return Button {
            onChange(option.id)
        } label: {
            Text(option.label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(on ? Theme.ink : Theme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.horizontal, 2)
                .frame(maxWidth: .infinity, minHeight: 36)
                .background(on ? Theme.solid : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label): \(option.label)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Running an agent inside Subspace on the owner's Anthropic API key: on or off, the key, the
/// model, how hard it thinks, how much it may hold, and whether it may use the web.
struct AgentsRealtime: View {
    var agent: Agent

    @Environment(AppModel.self) private var app
    @State private var options: AgentsRuntimeOptions? = nil
    @State private var enabled: Bool
    @State private var model: String
    @State private var effort: String
    @State private var context: Int
    @State private var web: Bool
    @State private var key = ""
    @State private var editingKey = false
    @State private var problem = ""

    init(agent: Agent) {
        self.agent = agent
        let rt = agent.runtime
        _enabled = State(initialValue: rt?["enabled"]?.bool ?? false)
        _model = State(initialValue: rt?["model"]?.string ?? "claude-opus-5-5")
        _effort = State(initialValue: rt?["effort"]?.string ?? "medium")
        _context = State(initialValue: rt?["context"]?.int ?? 200_000)
        _web = State(initialValue: rt?["web"]?.bool ?? true)
    }

    private var keyHint: String? { agent.runtime?.str("key_hint") }
    private var hasKey: Bool { keyHint != nil || options?.env_key == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Rectangle().fill(Theme.line).frame(height: 1)
            switchRow
            keyPart
            settings
                .opacity(hasKey ? 1 : 0.45)
                .allowsHitTesting(hasKey)
            lastRun
        }
        .padding(.top, 14)
        .task { await loadOptions() }
        .onChange(of: agent.runtime) { _, _ in sync() }
    }

    /// Shows what the server holds; used after a refresh and to put things back after a failure.
    private func sync() {
        let rt = agent.runtime
        enabled = rt?["enabled"]?.bool ?? false
        model = rt?["model"]?.string ?? "claude-opus-5-5"
        effort = rt?["effort"]?.string ?? "medium"
        context = rt?["context"]?.int ?? 200_000
        web = rt?["web"]?.bool ?? true
    }

    private func loadOptions() async {
        do {
            options = try await app.api.get("runtime/options", as: AgentsRuntimeOptions.self)
        } catch {
            problem = error.localizedDescription
        }
    }

    @discardableResult
    private func save(_ body: [String: Any]) async -> Bool {
        problem = ""
        do {
            try await app.api.send("PATCH", "agents/\(agent.id)/runtime", body: body)
            await app.refreshMe()
            return true
        } catch {
            problem = error.localizedDescription
            sync()
            return false
        }
    }

    // MARK: On or off

    private var switchRow: some View {
        let isOn = Binding<Bool>(
            get: { enabled },
            set: { now in
                enabled = now
                Task { _ = await save(["enabled": now]) }
            }
        )
        return HStack(spacing: 12) {
            Text("Run \(agent.name) inside Subspace on your Anthropic API key, so it answers within moments of being mentioned. Usage is billed to that key.")
                .font(.ssSecondary)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Toggle("Realtime", isOn: isOn)
                .labelsHidden()
                .tint(Theme.accent)
                .accessibilityLabel("Realtime")
                .accessibilityIdentifier("agents.realtime.on.\(agent.id)")
        }
    }

    // MARK: API key

    private var keyPart: some View {
        VStack(alignment: .leading, spacing: 6) {
            AgentsSectionLabel("API key")
            if let hint = keyHint, !editingKey {
                storedKey(hint)
            } else {
                keyForm
            }
            Text(problem.isEmpty ? "Stored encrypted. It is never shown again or sent anywhere except Anthropic." : problem)
                .font(.ssMeta)
                .foregroundStyle(problem.isEmpty ? Theme.ink3 : Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func storedKey(_ hint: String) -> some View {
        HStack(spacing: 8) {
            Text("sk-ant-" + hint)
                .font(.system(size: 12.5, design: .monospaced))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            AgentsQuietButton(title: "Replace", identifier: "agents.key.replace.\(agent.id)") {
                withAnimation(.ssSoft) { editingKey = true }
            }
            AgentsQuietButton(title: "Remove", identifier: "agents.key.remove.\(agent.id)") {
                Task { _ = await save(["api_key": ""]) }
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 4)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var keyForm: some View {
        let ready = !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let prompt = options?.env_key == true ? "Using the key set on the server. Paste one to override." : "sk-ant-…"
        return HStack(spacing: 8) {
            SecureField(prompt, text: $key)
                .font(.system(size: 12.5, design: .monospaced))
                .foregroundStyle(Theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { saveKey() }
                .frame(maxWidth: .infinity, minHeight: 36)
                .accessibilityLabel("Anthropic API key")
                .accessibilityIdentifier("agents.key.\(agent.id)")
            if editingKey {
                AgentsQuietButton(title: "Cancel", identifier: "agents.key.cancel.\(agent.id)") {
                    key = ""
                    withAnimation(.ssSoft) { editingKey = false }
                }
            }
            Button {
                saveKey()
            } label: {
                Text("Save")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.bg)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .background(Theme.ink, in: Capsule())
            }
            .buttonStyle(PressStyle(scale: 0.95))
            .disabled(!ready)
            .opacity(ready ? 1 : 0.3)
            .accessibilityIdentifier("agents.key.save.\(agent.id)")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 4)
        .background(Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func saveKey() {
        let wanted = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !wanted.isEmpty else { return }
        // A first key also turns realtime on, as the web page does.
        let first = keyHint == nil
        Task {
            var body: [String: Any] = ["api_key": wanted]
            if first { body["enabled"] = true }
            let saved = await save(body)
            if saved {
                key = ""
                withAnimation(.ssSoft) { editingKey = false }
            }
        }
    }

    // MARK: Model, effort, context, web

    private var modelOptions: [AgentsOption] {
        (options?.models ?? []).map { AgentsOption(id: $0.id, label: $0.name) }
    }

    private var effortOptions: [AgentsOption] {
        let names: [String: String] = ["low": "Low", "medium": "Medium", "high": "High", "xhigh": "Extra", "max": "Max"]
        return (options?.efforts ?? []).map { AgentsOption(id: $0, label: names[$0] ?? $0) }
    }

    private var contextOptions: [AgentsOption] {
        (options?.contexts ?? []).map { AgentsOption(id: String($0), label: Self.contextLabel($0)) }
    }

    private static func contextLabel(_ n: Int) -> String {
        if n >= 1_000_000 {
            let millions = Double(n) / 1_000_000
            return millions == millions.rounded() ? "\(Int(millions))M" : "\(millions)M"
        }
        return "\(n / 1000)K"
    }

    private var settings: some View {
        let note = options?.models.first(where: { $0.id == model })?.note
        return VStack(alignment: .leading, spacing: 16) {
            AgentsSegmented(label: "Model", hint: note, value: model, options: modelOptions) { picked in
                model = picked
                Task { _ = await save(["model": picked]) }
            }
            AgentsSegmented(label: "Effort", hint: "Higher thinks longer and costs more", value: effort, options: effortOptions) { picked in
                effort = picked
                Task { _ = await save(["effort": picked]) }
            }
            AgentsSegmented(label: "Context window", hint: "How much one run may hold", value: String(context), options: contextOptions) { picked in
                guard let size = Int(picked) else { return }
                context = size
                Task { _ = await save(["context": size]) }
            }
            webRow
        }
    }

    private var webRow: some View {
        let isOn = Binding<Bool>(
            get: { web },
            set: { now in
                web = now
                Task { _ = await save(["web": now]) }
            }
        )
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Web access").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
                Text("Let it search and read the web while it works.")
                    .font(.ssMeta)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Toggle("Web access", isOn: isOn)
                .labelsHidden()
                .tint(Theme.accent)
                .accessibilityLabel("Web access")
                .accessibilityIdentifier("agents.realtime.web.\(agent.id)")
        }
    }

    // MARK: Last run

    private var lastRunWords: String? {
        guard let run = agent.runtime?["last_run"], run.object != nil else { return nil }
        let at = run["at"]?.string
        if run["status"]?.string == "ok" {
            let when = ago(at)
            let ran = when == "now" ? "Last ran just now" : "Last ran " + agentsAgoPhrase(at)
            let steps = run["steps"]?.int ?? 0
            let tokens = (run["input_tokens"]?.double ?? 0) + (run["output_tokens"]?.double ?? 0)
            let thousands = Int((tokens / 1000).rounded())
            let unit = steps == 1 ? "step" : "steps"
            return "\(ran) · \(steps) \(unit) · \(thousands)K tokens"
        }
        let detail = run.str("detail") ?? "The last run failed."
        return "\(detail) · \(ago(at))"
    }

    private var lastRunFailed: Bool {
        guard let run = agent.runtime?["last_run"], run.object != nil else { return false }
        return run["status"]?.string != "ok"
    }

    @ViewBuilder private var lastRun: some View {
        if let words = lastRunWords {
            let failed = lastRunFailed
            Text(words)
                .font(.ssMeta)
                .foregroundStyle(failed ? Theme.danger : Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(failed ? Theme.danger.opacity(0.12) : Theme.fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityIdentifier("agents.realtime.lastrun.\(agent.id)")
        }
    }
}

/// A small text button inside a field row: "Replace", "Remove", "Cancel".
struct AgentsQuietButton: View {
    var title: String
    var identifier: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(minHeight: 36)
                .contentShape(Capsule())
        }
        .buttonStyle(PressStyle())
        .accessibilityIdentifier(identifier)
    }
}
