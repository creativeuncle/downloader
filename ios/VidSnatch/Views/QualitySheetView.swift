import SwiftUI

struct VideoQuality: Identifiable {
    let id = UUID()
    let label: String
    let icon: String
}

private let qualityOptions: [VideoQuality] = [
    VideoQuality(label: "Best Quality", icon: "flame.fill"),
    VideoQuality(label: "High Quality", icon: "bolt.fill"),
    VideoQuality(label: "Medium Quality", icon: "video.fill"),
    VideoQuality(label: "MP3", icon: "music.note"),
]

struct QualitySheetView: View {
    let onSelect: (VideoQuality) -> Void

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

            GlassEffectContainer(spacing: 12) {
                VStack(spacing: 12) {
                    ForEach(qualityOptions) { quality in
                        Button {
                            onSelect(quality)
                        } label: {
                            HStack(spacing: 14) {
                                Image(systemName: quality.icon)
                                    .font(.system(size: 17, weight: .semibold))
                                    .frame(width: 24)

                                Text(quality.label)
                                    .font(.system(size: 16, weight: .medium, design: .rounded))

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

            Spacer(minLength: 12)
        }
        .presentationDetents([.fraction(0.42)])
        .presentationDragIndicator(.hidden)
    }
}

#Preview {
    Color.clear
        .sheet(isPresented: .constant(true)) {
            QualitySheetView(onSelect: { _ in })
        }
}
