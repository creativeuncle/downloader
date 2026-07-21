import SwiftUI
import UIKit

/// Fallback for content Photos can't store (MP3s) or when photo permission
/// is denied — hands the file to the system share sheet instead.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
