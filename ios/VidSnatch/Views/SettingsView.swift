import SwiftUI

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: "gearshape.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.secondary)
                Text("Settings")
                    .font(.system(size: 18, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
}
