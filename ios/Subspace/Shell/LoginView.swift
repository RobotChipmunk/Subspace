import SwiftUI

/// Sign-in: where your Subspace lives, and its password.
struct LoginView: View {
    @Environment(AppModel.self) private var app
    @State private var server = ""
    @State private var password = ""
    @State private var error = ""
    @State private var busy = false
    @State private var shake = 0
    @FocusState private var focus: Field?

    private enum Field { case server, password }

    var body: some View {
        VStack(spacing: 0) {
            SubspaceMark(size: 140)
                .padding(.bottom, 8)
                .accessibilityIdentifier("login.mark")
            Text("Subspace").font(.system(size: 34, weight: .bold)).tracking(-1.2)
            Text("Where you and your agents meet.").font(.system(size: 15)).foregroundStyle(Theme.ink2).padding(.top, 4)

            VStack(spacing: 10) {
                TextField("Address, like my-subspace.vercel.app", text: $server)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .server)
                    .onSubmit { focus = .password }
                    .font(.system(size: 16))
                    .padding(.horizontal, 20)
                    .frame(height: 52)
                    .glass(radius: 26)
                    .accessibilityIdentifier("login.server")

                HStack(spacing: 6) {
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .focused($focus, equals: .password)
                        .onSubmit(submit)
                        .font(.system(size: 16))
                        .accessibilityIdentifier("login.password")
                    Button(action: submit) {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.bg)
                            .frame(width: 40, height: 40)
                            .background(Theme.ink, in: Circle())
                    }
                    .buttonStyle(PressStyle(scale: 0.9))
                    .disabled(busy || password.isEmpty || server.isEmpty)
                    .opacity(busy || password.isEmpty || server.isEmpty ? 0.25 : 1)
                    .accessibilityLabel("Sign in")
                    .accessibilityIdentifier("login.submit")
                }
                .padding(.leading, 20)
                .padding(.trailing, 6)
                .frame(height: 52)
                .glass(radius: 26)
                .keyframeAnimator(initialValue: 0.0, trigger: shake) { view, x in
                    view.offset(x: x)
                } keyframes: { _ in
                    CubicKeyframe(-8, duration: 0.08)
                    CubicKeyframe(8, duration: 0.08)
                    CubicKeyframe(-5, duration: 0.08)
                    CubicKeyframe(5, duration: 0.08)
                    CubicKeyframe(0, duration: 0.08)
                }
            }
            .padding(.top, 32)

            Text(error)
                .font(.system(size: 13))
                .foregroundStyle(Theme.danger)
                .multilineTextAlignment(.center)
                .frame(minHeight: 20)
                .padding(.top, 12)
                .accessibilityIdentifier("login.error")
        }
        .frame(maxWidth: 340)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            server = app.server
            focus = server.isEmpty ? .server : .password
        }
    }

    private func submit() {
        guard !busy, !password.isEmpty, !server.isEmpty else { return }
        busy = true
        error = ""
        Task {
            do {
                try await app.signIn(server: server, password: password)
            } catch {
                self.error = error.localizedDescription
                shake += 1
            }
            busy = false
        }
    }
}
