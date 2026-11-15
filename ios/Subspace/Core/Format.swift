import Foundation

private let isoFractional: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
private let isoPlain = ISO8601DateFormatter()

/// Reads the server's timestamps ("2026-11-15T01:09:43.430Z").
func parseDate(_ iso: String?) -> Date? {
    guard let iso else { return nil }
    return isoFractional.date(from: iso) ?? isoPlain.date(from: iso)
}

/// Relative when recent ("now", "5m", "3h", "2d"), a short date after that. Same rule as the web app.
func ago(_ iso: String?) -> String {
    guard let d = parseDate(iso) else { return "" }
    let s = max(0, Date().timeIntervalSince(d))
    if s < 50 { return "now" }
    if s < 3600 { return "\(Int((s / 60).rounded()))m" }
    if s < 86400 { return "\(Int((s / 3600).rounded()))h" }
    if s < 86400 * 6 { return "\(Int((s / 86400).rounded()))d" }
    let sameYear = Calendar.current.component(.year, from: d) == Calendar.current.component(.year, from: Date())
    return d.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
}

/// FNV-1a, the same hash the web app uses to pick a palette, so colours match everywhere.
func stableHash(_ s: String) -> UInt32 {
    var h: UInt32 = 2166136261
    for unit in s.utf16 {
        h = (h ^ UInt32(unit)) &* 16777619
    }
    return h
}
