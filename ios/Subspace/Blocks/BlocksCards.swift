import SwiftUI

// MARK: Cards

struct BlocksCards: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let items = d.list("items")
        let layout = d.str("layout") ?? "grid"
        if compact || layout == "list" {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.offset) { item in
                    BlocksCardRow(item: item.element, compact: compact)
                }
            }
            .padding(.horizontal, compact ? 0 : -8)
        } else if layout == "carousel" {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(items.enumerated()), id: \.offset) { item in
                        BlocksCard(item: item.element, wide: true)
                    }
                }
                .padding(.horizontal, 1)
                .padding(.top, 2)
                .padding(.bottom, 10)
            }
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 188), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(Array(items.enumerated()), id: \.offset) { item in
                    BlocksCard(item: item.element, wide: false)
                }
            }
        }
    }
}

/// A card with a picture on top (grid and carousel).
private struct BlocksCard: View {
    var item: JSONValue
    var wide: Bool

    var body: some View {
        let title = item.str("title") ?? ""
        BlocksLink(url: item.str("url"), label: title) {
            VStack(alignment: .leading, spacing: 0) {
                BlocksPicture(src: item.str("image"), label: title)
                    .aspectRatio(4.0 / 3.0, contentMode: .fit)
                    .clipped()
                    .overlay(alignment: .topLeading) {
                        if let badge = item.str("badge") {
                            Text(badge)
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(Color.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.black.opacity(0.55), in: Capsule())
                                .padding(10)
                        }
                    }
                BlocksCardText(item: item, title: title)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .blocksCard(radius: 20, compact: false)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .frame(width: wide ? 236 : nil)
    }
}

private struct BlocksCardText: View {
    var item: JSONValue
    var title: String

    var body: some View {
        let meta = blocksStrings(item.list("meta")) + blocksStrings(item.list("tags"))
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 8) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if let price = item.str("price") {
                    Text(price).font(.system(size: 14.5, weight: .semibold).monospacedDigit()).foregroundStyle(Theme.ink).fixedSize()
                }
            }
            if let subtitle = item.str("subtitle") {
                Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.ink2).lineLimit(1)
            }
            if let rating = item["rating"]?.double {
                BlocksStars(value: rating, reviews: item["reviews"])
            }
            if let description = item.str("description") {
                Text(description).font(.system(size: 13)).foregroundStyle(Theme.ink2).lineLimit(3).multilineTextAlignment(.leading)
            }
            if !meta.isEmpty {
                BlocksChips(labels: Array(meta.prefix(4))).padding(.top, 2)
            }
            if let url = item.str("url") {
                HStack(spacing: 4) {
                    Text(item.str("link_label") ?? BlocksFormat.host(url)).lineLimit(1)
                    Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .medium))
                }
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.ink3)
                .padding(.top, 6)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A card as one row with a small picture (list layout, and always in the rail).
private struct BlocksCardRow: View {
    var item: JSONValue
    var compact: Bool

    var body: some View {
        let title = item.str("title") ?? ""
        let side: CGFloat = compact ? 44 : 64
        BlocksLink(url: item.str("url"), label: title) {
            HStack(alignment: .center, spacing: compact ? 10 : 14) {
                BlocksPicture(src: item.str("image"), label: title)
                    .frame(width: side, height: side)
                    .clipShape(RoundedRectangle(cornerRadius: compact ? 10 : 12, style: .continuous))
                BlocksCardRowText(item: item, title: title, compact: compact)
                if let price = item.str("price") {
                    Text(price).font(.system(size: compact ? 13 : 14.5, weight: .semibold).monospacedDigit()).foregroundStyle(Theme.ink).fixedSize()
                }
                if item.str("url") != nil {
                    Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ink3)
                }
            }
            .padding(.vertical, compact ? 4 : 8)
            .padding(.leading, compact ? 0 : 8)
            .padding(.trailing, compact ? 0 : 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
    }
}

private struct BlocksCardRowText: View {
    var item: JSONValue
    var title: String
    var compact: Bool

    var body: some View {
        let parts = ([item.str("subtitle")].compactMap { $0 } + blocksStrings(item.list("meta"))).prefix(3)
        let meta = parts.joined(separator: " \u{00B7} ")
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(.system(size: compact ? 14 : 15, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                if let badge = item.str("badge") {
                    Text(badge)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.accentSoft, in: Capsule())
                        .fixedSize()
                }
            }
            if let rating = item["rating"]?.double {
                BlocksStars(value: rating, reviews: item["reviews"])
            }
            if !meta.isEmpty {
                Text(meta).font(.system(size: compact ? 12.5 : 13)).foregroundStyle(Theme.ink2).lineLimit(1)
            }
            if let description = item.str("description") {
                Text(description).font(.system(size: compact ? 12.5 : 13)).foregroundStyle(Theme.ink2).lineLimit(2).multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Five stars filled to the rating, the figure, and the number of reviews.
private struct BlocksStars: View {
    var value: Double
    var reviews: JSONValue?

    var body: some View {
        let fraction = CGFloat(min(max(value / 5, 0), 1))
        HStack(spacing: 4) {
            BlocksStarRow(color: Theme.fill2)
                .overlay(alignment: .leading) {
                    GeometryReader { geo in
                        BlocksStarRow(color: Color(hex: "#F0A020"))
                            .frame(width: geo.size.width * fraction, alignment: .leading)
                            .clipped()
                    }
                }
                .accessibilityHidden(true)
            Text(String(format: "%.1f", value)).font(.system(size: 12.5, weight: .medium).monospacedDigit()).foregroundStyle(Theme.ink)
            if let count = reviewText {
                Text("(\(count))").font(.system(size: 12.5)).foregroundStyle(Theme.ink3)
            }
        }
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(format: "%.1f out of 5", value))
    }

    private var reviewText: String? {
        guard let reviews else { return nil }
        switch reviews {
        case .number(let n):
            if abs(n) < 1e12 { return Int(n).formatted() }
            return nil
        case .string(let s):
            return s.isEmpty ? nil : s
        case .null, .bool, .array, .object:
            return nil
        }
    }
}

private struct BlocksStarRow: View {
    var color: Color

    var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<5, id: \.self) { _ in
                Image(systemName: "star.fill").font(.system(size: 10)).frame(width: 12, height: 12)
            }
        }
        .foregroundStyle(color)
        .fixedSize()
    }
}

/// Small rounded labels that wrap.
private struct BlocksChips: View {
    var labels: [String]

    var body: some View {
        FlowRow(spacing: 4) {
            ForEach(Array(labels.enumerated()), id: \.offset) { item in
                Text(item.element)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Theme.fill, in: Capsule())
            }
        }
    }
}

/// The strings in a JSON list, skipping anything else.
func blocksStrings(_ list: [JSONValue]) -> [String] {
    list.compactMap { v in
        guard let s = v.text, !s.isEmpty else { return nil }
        return s
    }
}

// MARK: Gallery

struct BlocksGallery: View {
    var d: JSONValue
    var compact: Bool

    var body: some View {
        let items = d.list("items")
        if items.count == 1 {
            BlocksGalleryItem(item: items[0], single: true)
        } else if items.count > 1 {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 100 : 160), spacing: 10, alignment: .top)], alignment: .leading, spacing: 10) {
                ForEach(Array(items.enumerated()), id: \.offset) { item in
                    BlocksGalleryItem(item: item.element, single: false)
                }
            }
        }
    }
}

private struct BlocksGalleryItem: View {
    var item: JSONValue
    var single: Bool
    @State private var ratio: CGFloat = 4.0 / 3.0

    var body: some View {
        let caption = item.str("caption")
        // One picture keeps its own shape (within reason); several share 4:3.
        let shape: CGFloat = single ? min(max(ratio, 0.8), 4) : 4.0 / 3.0
        BlocksLink(url: item.str("url"), label: caption ?? "Image") {
            VStack(alignment: .leading, spacing: 4) {
                BlocksGalleryPicture(src: item.str("image"), label: caption ?? "Image", single: single, ratio: $ratio)
                    .aspectRatio(shape, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                if let caption {
                    Text(caption)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.ink3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 2)
                }
            }
            .frame(maxWidth: single ? 640 : .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlocksGalleryPicture: View {
    var src: String?
    var label: String
    var single: Bool
    @Binding var ratio: CGFloat

    var body: some View {
        if let src, !src.isEmpty {
            RemoteImage(src, contentMode: .fill, onRatio: { r in
                if single, r > 0 { ratio = r }
            })
        } else {
            BlocksPicture(src: nil, label: label)
        }
    }
}
