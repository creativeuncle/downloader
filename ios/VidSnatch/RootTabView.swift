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
    }
}

#Preview {
    RootTabView()
}
