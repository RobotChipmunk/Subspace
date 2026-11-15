import MapKit
import SwiftUI

private struct BlocksMapPlace: Identifiable {
    var id: Int
    var title: String
    var note: String?
    var url: String?
    var coordinate: CLLocationCoordinate2D
}

/// A calm map with numbered pins, and the same places listed underneath so nothing depends on
/// the map alone. The map does not take touches, so the page scrolls over it.
struct BlocksMap: View {
    var d: JSONValue
    var compact: Bool
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let places = BlocksMap.places(d)
        if !places.isEmpty {
            let height: CGFloat = compact ? 170 : (sizeClass == .compact ? 260 : 320)
            let radius: CGFloat = compact ? 14 : 20
            VStack(alignment: .leading, spacing: 10) {
                BlocksMapCanvas(places: places)
                    .frame(height: height)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 180 : 220), spacing: 16, alignment: .top)], alignment: .leading, spacing: 6) {
                    ForEach(places) { place in
                        BlocksMapRow(place: place)
                    }
                }
            }
        }
    }

    private static func places(_ d: JSONValue) -> [BlocksMapPlace] {
        var out: [BlocksMapPlace] = []
        for m in d.list("markers") {
            guard let lat = m["lat"]?.double, let lng = m["lng"]?.double else { continue }
            if abs(lat) > 90 || abs(lng) > 180 { continue }
            out.append(BlocksMapPlace(
                id: out.count,
                title: m.str("title") ?? "",
                note: m.str("note"),
                url: m.str("url"),
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)
            ))
        }
        return out
    }
}

private struct BlocksMapCanvas: View {
    var places: [BlocksMapPlace]

    var body: some View {
        Map(initialPosition: .region(region), interactionModes: []) {
            ForEach(places) { place in
                Annotation(place.title, coordinate: place.coordinate, anchor: .center) {
                    BlocksMapPin(number: place.id + 1, size: 28)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(emphasis: .muted))
        // The camera is set once; a different set of places is a different map.
        .id(key)
    }

    private var key: String {
        places.map { "\($0.coordinate.latitude),\($0.coordinate.longitude)" }.joined(separator: ";")
    }

    /// One place: a neighbourhood around it. Several: all of them, with room around the edge.
    private var region: MKCoordinateRegion {
        let lats = places.map { $0.coordinate.latitude }
        let lngs = places.map { $0.coordinate.longitude }
        let minLat = lats.min() ?? 0
        let maxLat = lats.max() ?? 0
        let minLng = lngs.min() ?? 0
        let maxLng = lngs.max() ?? 0
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        if places.count <= 1 {
            return MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03))
        }
        let latDelta = min(max((maxLat - minLat) * 1.5, 0.012), 160)
        let lngDelta = min(max((maxLng - minLng) * 1.5, 0.012), 340)
        return MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lngDelta))
    }
}

private struct BlocksMapPin: View {
    var number: Int
    var size: CGFloat

    var body: some View {
        Text("\(number)")
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(Color.white)
            .frame(width: size, height: size)
            .background(Theme.accent, in: Circle())
            .overlay(Circle().strokeBorder(Theme.solid, lineWidth: 2))
            .shadow(color: Color.black.opacity(0.25), radius: 4, x: 0, y: 2)
    }
}

private struct BlocksMapRow: View {
    var place: BlocksMapPlace

    var body: some View {
        BlocksLink(url: place.url, label: place.title) {
            HStack(alignment: .top, spacing: 8) {
                BlocksMapPin(number: place.id + 1, size: 22).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(place.title).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                    if let note = place.note {
                        Text(note)
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.ink2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if place.url != nil {
                    Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.ink3).padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
    }
}
