import SwiftUI

struct ProfileView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 44))
                    .foregroundStyle(.secondary)
                Text("Profile")
                    .font(.system(size: 18, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Profile")
        }
    }
}

#Preview {
    ProfileView()
}
