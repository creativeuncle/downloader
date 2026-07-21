import Foundation

/// Downloads a file from /api/download (a POST with a JSON body) while
/// reporting progress — URLSession's plain async APIs don't expose progress
/// for a POST response body, so this drives a download task via the
/// delegate callbacks directly.
final class VideoDownloader: NSObject, URLSessionDownloadDelegate {
    private var continuation: CheckedContinuation<URL, Error>?
    private var onProgress: ((Double) -> Void)?
    private var session: URLSession?

    func download(url: String, formatId: String, type: String, onProgress: @escaping (Double) -> Void) async throws -> URL {
        self.onProgress = onProgress

        let request = try APIService.makeRequest(
            path: "/api/download",
            body: ["url": url, "format_id": formatId, "type": type]
        )

        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.session = session

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            session.downloadTask(with: request).resume()
        }
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        DispatchQueue.main.async { [onProgress] in
            onProgress?(progress)
        }
    }

    private struct ErrorBody: Decodable { let error: String }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        if let http = downloadTask.response as? HTTPURLResponse, http.statusCode != 200 {
            let data = try? Data(contentsOf: location)
            let message = data.flatMap { try? JSONDecoder().decode(ErrorBody.self, from: $0) }?.error
            continuation?.resume(throwing: NSError(
                domain: "VidSnatch",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: message ?? "Download failed"]
            ))
            continuation = nil
            return
        }

        // The temp file at `location` is deleted as soon as this method returns,
        // so move it somewhere stable before handing it back to the caller.
        let ext = downloadTask.response?.suggestedFilename.map { ($0 as NSString).pathExtension } ?? "mp4"
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(ext.isEmpty ? "mp4" : ext)
        do {
            try FileManager.default.moveItem(at: location, to: destination)
            continuation?.resume(returning: destination)
        } catch {
            continuation?.resume(throwing: error)
        }
        continuation = nil
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            continuation?.resume(throwing: error)
            continuation = nil
        }
    }
}
