import Photos

enum PhotoSaver {
    static func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                continuation.resume(returning: status == .authorized || status == .limited)
            }
        }
    }

    /// Photos only accepts image/video assets — audio (MP3) can't be saved here.
    static func saveVideo(at fileURL: URL) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
            }) { success, error in
                if success {
                    continuation.resume(returning: ())
                } else {
                    continuation.resume(throwing: error ?? NSError(
                        domain: "VidSnatch",
                        code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "Couldn't save to Photos"]
                    ))
                }
            }
        }
    }
}
