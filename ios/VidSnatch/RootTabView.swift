import SwiftUI

struct RootTabView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house.fill") {
                HomeView()
            }
            Tab("History", systemImage: "clock.arrow.circlepath") {
                HistoryView()
            }
            Tab("Profile", systemImage: "person.crop.circle") {
                ProfileView()
            }
            Tab("Settings", systemImage: "gearshape.fill") {
                SettingsView()
            }
        }
        .task {
            // Ask up front so it's ready before the first download completes,
            // instead of interrupting the user mid-download.
            _ = await PhotoSaver.requestPermission()
        }
    }
}

#Preview {
    RootTabView()
}
