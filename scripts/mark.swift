import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// ---- shared geometry (the same numbers as the web and app versions) ----
struct RNG { var a: UInt32
  mutating func next() -> Double { a = a &+ 0x6D2B79F5; var t = (a ^ (a >> 15)) &* (1 | a); t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t; return Double(t ^ (t >> 14)) / 4294967296.0 } }
struct P { var p: (Double, Double, Double); var kind: Int; var t: Double; var s: Double }
let LIGHT: [UInt32] = [0xFF8A65, 0xF0609E, 0x8B6CF6, 0x3BA9F5, 0x2CC79A, 0xF5B62E]
let DARK: [UInt32] = [0xFFC9B5, 0xF7B1D0, 0xC9B8FF, 0xA8E6FF, 0xB5F5D8, 0xFFE7A8]
func rgb(_ h: UInt32) -> (Double, Double, Double) { (Double((h >> 16) & 255) / 255, Double((h >> 8) & 255) / 255, Double(h & 255) / 255) }
func hue(_ pal: [UInt32], _ t: Double) -> (Double, Double, Double) {
  let x = (t - floor(t)) * Double(pal.count); let i = Int(x) % pal.count; let f = x - floor(x)
  let a = rgb(pal[i]), b = rgb(pal[(i + 1) % pal.count]); return (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f, a.2 + (b.2 - a.2) * f) }
func points(_ variant: String) -> [P] {
  var r = RNG(a: 11); var out: [P] = []
  let tiltX = 0.52, tiltZ = -0.40
  func tilt(_ v: (Double, Double, Double)) -> (Double, Double, Double) {
    let y1 = v.1 * cos(tiltX) - v.2 * sin(tiltX), z1 = v.1 * sin(tiltX) + v.2 * cos(tiltX)
    return (v.0 * cos(tiltZ) - y1 * sin(tiltZ), v.0 * sin(tiltZ) + y1 * cos(tiltZ), z1) }
  if variant == "plane" {
    let n = 58
    for i in 0..<n { let y = 1 - (2 * (Double(i) + 0.5)) / Double(n), rad = sqrt(1 - y * y), th = Double(i) * 2.39996323, k = 0.88 + r.next() * 0.12
      out.append(P(p: (cos(th) * rad * k, y * k, sin(th) * rad * k), kind: 0, t: 0, s: 0.7 + r.next() * 0.6)) }
    let m = 72
    for i in 0..<m { let a = Double(i) * 2.39996323, d = sqrt((Double(i) + 0.5) / Double(m)) * 0.8
      let yj = (r.next() - 0.5) * 0.05
      out.append(P(p: tilt((cos(a) * d, yj, sin(a) * d)), kind: 1, t: (a / (2 * Double.pi)).truncatingRemainder(dividingBy: 1), s: 0.75 + r.next() * 0.5)) }
  } else if variant == "cloud" {
    let n = 120
    for i in 0..<n { let y = 1 - (2 * (Double(i) + 0.5)) / Double(n), rad = sqrt(1 - y * y), th = Double(i) * 2.39996323, k = 0.35 + pow(r.next(), 0.6) * 0.6
      out.append(P(p: (cos(th) * rad * k, y * k, sin(th) * rad * k), kind: 1, t: (th / (2 * Double.pi)).truncatingRemainder(dividingBy: 1), s: 0.5 + r.next() * 0.8)) }
  } else {
    let cs: [(Double, Double, Double)] = [(-0.5, 0.28, 0.1), (0.45, 0.4, -0.25), (0.05, -0.5, 0.3)]
    for (k, c) in cs.enumerated() { for _ in 0..<30 {
      func g() -> Double { (r.next() + r.next() + r.next() - 1.5) * 0.36 }
      let x = c.0 + g(), y = c.1 + g(), z = c.2 + g()
      out.append(P(p: (x, y, z), kind: 1, t: Double(k) / 3 + (r.next() - 0.5) * 0.12, s: 0.55 + r.next() * 0.7)) } }
    for _ in 0..<26 { let th = r.next() * 6.283, y = r.next() * 2 - 1, rad = sqrt(1 - y * y), k = 0.5 + r.next() * 0.5
      out.append(P(p: (cos(th) * rad * k, y * k, sin(th) * rad * k), kind: 0, t: 0, s: 0.5 + r.next() * 0.4)) }
  }
  return out
}

/// mode: "light", "dark" or "tinted" (white on clear black, for the system to tint). icon: fill the square as an app icon.
func render(_ variant: String, mode: String, angle: Double, size: Int, icon: Bool, to path: String) {
  let dark = mode != "light"
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  let S = Double(size)
  let bg: (Double, Double, Double) = mode == "light" ? (0.957, 0.953, 0.945) : mode == "dark" ? (0.051, 0.051, 0.063) : (0, 0, 0)
  ctx.setFillColor(red: bg.0, green: bg.1, blue: bg.2, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
  if icon && mode != "tinted" {
    // a soft wash behind, as the app's own background has
    let washes: [(Double, Double, UInt32, Double)] = [(0.2, 0.82, 0xF7B1D0, 0.30), (0.85, 0.6, 0xA8E6FF, 0.30), (0.5, 0.1, 0xC9B8FF, 0.34)]
    for w in washes { let c = rgb(w.2); let a = dark ? w.3 * 0.45 : w.3
      let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: [CGColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: a), CGColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: 0)] as CFArray, locations: [0, 1])!
      ctx.drawRadialGradient(grad, startCenter: CGPoint(x: w.0 * S, y: w.1 * S), startRadius: 0, endCenter: CGPoint(x: w.0 * S, y: w.1 * S), endRadius: S * 0.62, options: []) }
  }
  let pal = dark ? DARK : LIGHT
  let c = cos(angle), s = sin(angle)
  let span = icon ? 0.36 : 0.40
  var proj: [(x: Double, y: Double, depth: Double, k: Double, q: P)] = points(variant).map { q in
    let X = q.p.0 * c + q.p.2 * s, Z = -q.p.0 * s + q.p.2 * c
    let k = 1 / (1 - Z * 0.22)
    return (0.5 + X * span * k, 0.5 + q.p.1 * span * k, (Z + 1) / 2, k, q) }
  proj.sort { $0.depth < $1.depth }
  for e in proj {
    let col: (Double, Double, Double) = mode == "tinted" ? (1, 1, 1) : e.q.kind == 1 ? hue(pal, e.q.t) : (dark ? (1, 1, 1) : (0.09, 0.09, 0.11))
    let rad = (e.q.kind == 1 ? 2.05 : 1.15) * e.q.s * (0.6 + 0.4 * e.depth) * e.k / 100 * (span / 0.40) * S
    let op = e.q.kind == 1 ? 0.45 + 0.55 * e.depth : (dark ? 0.16 + 0.44 * e.depth : 0.12 + 0.36 * e.depth)
    if dark && e.q.kind == 1 && mode != "tinted" { ctx.setShadow(offset: .zero, blur: rad * 1.6, color: CGColor(srgbRed: col.0, green: col.1, blue: col.2, alpha: 0.55 * op)) } else { ctx.setShadow(offset: .zero, blur: 0, color: nil) }
    ctx.setFillColor(red: col.0, green: col.1, blue: col.2, alpha: op)
    ctx.fillEllipse(in: CGRect(x: e.x * S - rad, y: e.y * S - rad, width: rad * 2, height: rad * 2))
  }
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
}

let args = CommandLine.arguments
if args.count >= 7 { render(args[1], mode: args[2], angle: Double(args[3])!, size: Int(args[4])!, icon: args[5] == "icon", to: args[6]) }
