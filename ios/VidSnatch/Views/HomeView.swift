import SwiftUI

struct HomeView: View {
    @State private var urlText: String = ""
    @State private var showQualitySheet = false
    @FocusState private var fieldFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemBackground)
                    .ignoresSafeArea()

                VStack(spacing: 28) {
                    Spacer(minLength: 40)

                    Text("Social Video\nDownloader")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.primary)

                    GlassEffectContainer(spacing: 16) {
                        VStack(spacing: 16) {
                            TextField("Enter url", text: $urlText)
                                .textFieldStyle(.plain)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 16)
                                .focused($fieldFocused)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .glassEffect(.regular, in: .rect(cornerRadius: 16))

                            Button {
                                fieldFocused = false
                                guard !urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                                showQualitySheet = true
                            } label: {
                                Text("Download")
                                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                            }
                            .buttonStyle(.glassProminent)
                            .tint(.primary)
                        }
                    }

                    Spacer()
                }
                .padding(.horizontal, 24)
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showQualitySheet) {
                QualitySheetView { quality in
                    showQualitySheet = false
                    // selected quality wired up to the download later
                    print("Selected quality: \(quality.label)")
                }
            }
        }
    }
}

#Preview {
    HomeView()
}
