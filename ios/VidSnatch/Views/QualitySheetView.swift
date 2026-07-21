import SwiftUI

private func icon(for format: VideoFormat) -> String {
    if format.type == "audio" { return "music.note" }
    let label = format.label.lowercased()
    if label.contains("best") || label.contains("4k") { return "flame.fill" }
    if label.contains("1080") || label.contains("high") { return "bolt.fill" }
    return "video.fill"
}

struct QualitySheetView: View {
    let formats: [VideoFormat]
    let onSelect: (VideoFormat) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(.secondary.opacity(0.4))
                .frame(width: 36, height: 5)
                .padding(.top, 10)
                .padding(.bottom, 16)

            Text("Choose Quality")
                .font(.system(size: 18, weight: .semibold, design: .rounded))
                .padding(.bottom, 16)

            ScrollView {
                GlassEffectContainer(spacing: 12) {
                    VStack(spacing: 12) {
                        ForEach(formats) { format in
                            Button {
                                onSelect(format)
                            } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: icon(for: format))
                                        .font(.system(size: 17, weight: .semibold))
                                        .frame(width: 24)

                                    Text(format.label)
                                        .font(.system(size: 16, weight: .medium, design: .rounded))
                                        .lineLimit(1)

                                    Spacer()

                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(.secondary)
                                }
                                .foregroundStyle(.primary)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 16)
                            }
                            .glassEffect(.regular, in: .rect(cornerRadius: 16))
                        }
                    }
                }
                .padding(.horizontal, 20)
            }

            Spacer(minLength: 12)
        }
        .presentationDetents([.fraction(0.5), .large])
        .presentationDragIndicator(.hidden)
    }
}

#Preview {
    Color.clear
        .sheet(isPresented: .constant(true)) {
            QualitySheetView(
                formats: [
                    VideoFormat(label: "🔥 Best Quality (Auto)", format_id: "best", type: "video"),
                    VideoFormat(label: "1080p MP4", format_id: "1080", type: "video"),
                    VideoFormat(label: "🎵 Audio Only (MP3)", format_id: "audio", type: "audio"),
                ],
                onSelect: { _ in }
            )
        }
}
