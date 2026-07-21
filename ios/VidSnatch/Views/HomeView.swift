import SwiftUI

struct HomeView: View {
    @State private var urlText: String = ""
    @State private var isFetchingInfo = false
    @State private var videoInfo: VideoInfo?
    @State private var showQualitySheet = false
    @State private var isDownloading = false
    @State private var downloadProgress: Double = 0
    @State private var errorMessage: String?
    @State private var successMessage: String?
    @State private var shareURL: IdentifiableURL?
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
                                Task { await fetchInfoAndShowSheet() }
                            } label: {
                                Group {
                                    if isFetchingInfo {
                                        ProgressView()
                                            .tint(.white)
                                    } else {
                                        Text("Download")
                                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                            }
                            .buttonStyle(.glassProminent)
                            .tint(.primary)
                            .disabled(isFetchingInfo || isDownloading)
                        }
                    }

                    if isDownloading {
                        VStack(spacing: 6) {
                            ProgressView(value: downloadProgress)
                                .tint(.primary)
                            Text("\(Int(downloadProgress * 100))%")
                                .font(.system(size: 13, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.system(size: 14, design: .rounded))
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }

                    if let successMessage {
                        Text(successMessage)
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundStyle(.green)
                    }

                    Spacer()
                }
                .padding(.horizontal, 24)
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showQualitySheet) {
                QualitySheetView(formats: videoInfo?.formats ?? []) { format in
                    showQualitySheet = false
                    Task { await downloadAndSave(format: format) }
                }
            }
            .sheet(item: $shareURL) { wrapped in
                ShareSheet(items: [wrapped.url])
            }
        }
    }

    private func fetchInfoAndShowSheet() async {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        errorMessage = nil
        successMessage = nil
        isFetchingInfo = true
        defer { isFetchingInfo = false }

        do {
            videoInfo = try await APIService.fetchInfo(url: trimmed)
            showQualitySheet = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func downloadAndSave(format: VideoFormat) async {
        let trimmed = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        errorMessage = nil
        successMessage = nil
        isDownloading = true
        downloadProgress = 0
        defer {
            isDownloading = false
            downloadProgress = 0
        }

        do {
            let fileURL = try await VideoDownloader().download(
                url: trimmed,
                formatId: format.format_id,
                type: format.type
            ) { progress in
                downloadProgress = progress
            }

            if format.type == "audio" {
                // Photos can't store audio files — hand off to the share sheet instead.
                shareURL = IdentifiableURL(url: fileURL)
            } else if await PhotoSaver.requestPermission() {
                try await PhotoSaver.saveVideo(at: fileURL)
                successMessage = "Saved to Photos"
            } else {
                shareURL = IdentifiableURL(url: fileURL)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct IdentifiableURL: Identifiable {
    let id = UUID()
    let url: URL
}

#Preview {
    HomeView()
}
