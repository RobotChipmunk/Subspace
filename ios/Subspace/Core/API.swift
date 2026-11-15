import Foundation

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// The REST client. Every call goes to `<server>/api/v1/<path>` with the session token as a
/// Bearer header, the way README "For the iOS app" describes.
final class API {
    var baseURL: URL?
    var token: String?
    /// Called when the server says the session is no longer valid.
    var onUnauthorized: (() -> Void)?

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 30
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    /// Turns an address from the server ("/api/media/x", "https://…") into a full URL.
    func resolve(_ ref: String?) -> URL? {
        guard let ref, !ref.isEmpty else { return nil }
        if ref.hasPrefix("http://") || ref.hasPrefix("https://") { return URL(string: ref) }
        if ref.hasPrefix("/"), let baseURL { return URL(string: ref, relativeTo: baseURL)?.absoluteURL }
        return URL(string: ref)
    }

    private func request(_ method: String, _ path: String) throws -> URLRequest {
        guard let baseURL, let url = URL(string: "api/v1/" + path, relativeTo: baseURL) else {
            throw APIError(status: 0, message: "Enter the address of your Subspace.")
        }
        var r = URLRequest(url: url)
        r.httpMethod = method
        if let token { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        return r
    }

    private func run(_ r: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            do {
                (data, response) = try await session.data(for: r)
            } catch let e as URLError where e.code == .networkConnectionLost {
                // The server closed a connection that was being kept open, just as it was reused.
                // The request never arrived, so it is safe to send once more on a fresh one.
                (data, response) = try await session.data(for: r)
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as URLError where e.code == .cancelled {
            throw CancellationError()
        } catch {
            throw APIError(status: 0, message: "Could not reach Subspace. Check the connection and try again.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(JSONValue.self, from: data))?["error"]?.string
            if status == 401, token != nil { await MainActor.run { onUnauthorized?() } }
            throw APIError(status: status, message: message ?? "Something went wrong.")
        }
        return data
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("decode \(T.self) failed:", error)
            #endif
            throw APIError(status: 0, message: "Subspace sent something this version of the app does not understand.")
        }
    }

    /// GET `path` (which may carry a query string).
    func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try decode(try await run(try request("GET", path)))
    }

    /// POST, PATCH or DELETE with an optional JSON body.
    func send<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil, as type: T.Type = T.self) async throws -> T {
        var r = try request(method, path)
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try decode(try await run(r))
    }

    /// The same, for calls whose reply is not needed.
    func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws {
        let _: JSONValue = try await send(method, path, body: body)
    }

    /// Sends one file to /media and returns its address.
    func upload(_ data: Data, mime: String, filename: String = "file") async throws -> String {
        var r = try request("POST", "media")
        let boundary = "subspace-" + UUID().uuidString
        r.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        r.httpBody = body
        let reply: JSONValue = try decode(try await run(r))
        guard let url = reply["url"]?.string else { throw APIError(status: 0, message: "The upload did not finish.") }
        return url
    }

    /// Raw bytes from any address (pictures). Sends the session only to the Subspace server itself.
    func data(from url: URL) async throws -> Data {
        var r = URLRequest(url: url)
        if let token, let baseURL, url.host == baseURL.host { r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: r)
        guard (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0) else { throw APIError(status: 0, message: "Not found.") }
        return data
    }
}

/// Percent-encodes a value for use inside a query string.
func q(_ value: String) -> String {
    var allowed = CharacterSet.urlQueryAllowed
    allowed.remove(charactersIn: "&=+?#")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}
