import Foundation

struct VideoFormat: Decodable, Identifiable, Hashable {
    let label: String
    let format_id: String
    let type: String
    var id: String { format_id }
}

struct VideoInfo: Decodable {
    let title: String
    let thumbnail: String
    let duration: String
    let platform: String
    let uploader: String
    let formats: [VideoFormat]
}

private struct APIErrorBody: Decodable {
    let error: String
}

enum APIService {
    /// Same Render-hosted backend the Android app talks to.
    static let baseURL = "https://downloader-xeir.onrender.com"

    static func fetchInfo(url: String) async throws -> VideoInfo {
        let request = try makeRequest(path: "/api/info", body: ["url": url])
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkResponse(response, data: data)
        return try JSONDecoder().decode(VideoInfo.self, from: data)
    }

    static func makeRequest(path: String, body: [String: String]) throws -> URLRequest {
        guard let endpoint = URL(string: baseURL + path) else { throw URLError(.badURL) }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    static func checkResponse(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard http.statusCode == 200 else {
            let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error
                ?? "Something went wrong (\(http.statusCode))"
            throw NSError(domain: "VidSnatch", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
        }
    }
}
