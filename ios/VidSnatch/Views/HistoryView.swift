import SwiftUI

struct HistoryView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 44))
                    .foregroundStyle(.secondary)
                Text("No downloads yet")
                    .font(.system(size: 18, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("History")
        }
    }
}

#Preview {
    HistoryView()
}
