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
    /// Retries a couple times: PHPhotosErrorDomain writes can fail transiently
    /// (e.g. iCloud Photos syncing in the background) and often succeed right after.
    static func saveVideo(at fileURL: URL, retries: Int = 2) async throws {
        var lastError: Error?
        for attempt in 0...retries {
            do {
                try await performSave(fileURL: fileURL)
                return
            } catch {
                lastError = error
                if attempt < retries {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                }
            }
        }
        throw lastError ?? NSError(
            domain: "VidSnatch",
            code: -1,
            userInfo: [NSLocalizedDescriptionKey: "Couldn't save to Photos"]
        )
    }

    private static func performSave(fileURL: URL) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                // Keep shouldMoveFile false — a failed attempt could otherwise leave the
                // source file gone, breaking the retry and the share-sheet fallback.
                options.shouldMoveFile = false
                request.addResource(with: .video, fileURL: fileURL, options: options)
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
