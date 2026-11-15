import Charts
import SwiftUI

/// One value of one series at one label.
private struct BlocksChartPoint: Identifiable {
    var id: String
    var key: String
    var series: String
    var value: Double
    var last: Bool
}

/// The chart's data, read forgivingly from the block.
private struct BlocksChartModel {
    var kind = "bar"
    var unit = ""
    var labels: [String] = []
    /// Labels made unique, so two equal labels stay two places on the axis.
    var keys: [String] = []
    var names: [String] = []
    var values: [[Double]] = []
    var points: [BlocksChartPoint] = []
    var low: Double = 0
    var high: Double = 1

    init(_ d: JSONValue) {
        kind = d.str("kind") == "line" ? "line" : "bar"
        unit = d.str("unit") ?? ""
        labels = d.list("labels").map { $0.text ?? "" }
        var seen: [String: Int] = [:]
        for l in labels {
            let n = seen[l] ?? 0
            seen[l] = n + 1
            keys.append(l + String(repeating: "\u{200B}", count: n))
        }
        let title = d.str("title")
        let series = Array(d.list("series").prefix(4))
        var all: [Double] = []
        for (si, s) in series.enumerated() {
            let name = s.str("name") ?? (series.count == 1 ? (title ?? "Series 1") : "Series \(si + 1)")
            // Names must be distinct to keep their own colours.
            let unique = names.contains(name) ? name + " \(si + 1)" : name
            names.append(unique)
            let nums = s.list("values").map { $0.double ?? 0 }
            var row: [Double] = []
            for i in 0..<keys.count {
                let v = i < nums.count ? nums[i] : 0
                row.append(v)
                all.append(v)
                points.append(BlocksChartPoint(id: "\(si)-\(i)", key: keys[i], series: unique, value: v, last: i == keys.count - 1))
            }
            values.append(row)
        }
        low = min(0, all.min() ?? 0)
        high = BlocksChartModel.niceMax(max(all.max() ?? 0, 0))
        if high <= low { high = low + 1 }
    }

    var valid: Bool { keys.count >= 1 && !names.isEmpty }
    var many: Bool { names.count > 1 }

    static func niceMax(_ v: Double) -> Double {
        if v <= 0 { return 1 }
        let p = pow(10, floor(log10(v)))
        let n = v / p
        let step: Double
        if n <= 1 { step = 1 }
        else if n <= 2 { step = 2 }
        else if n <= 2.5 { step = 2.5 }
        else if n <= 5 { step = 5 }
        else { step = 10 }
        return step * p
    }

    /// The same figures as a table block.
    var asTable: JSONValue {
        var head: [JSONValue] = [.string("")]
        for n in names { head.append(.string(n)) }
        var rows: [JSONValue] = []
        for (i, l) in labels.enumerated() {
            var cells: [JSONValue] = [.string(l)]
            for row in values {
                cells.append(.string(BlocksFormat.value(i < row.count ? row[i] : 0, unit: unit)))
            }
            rows.append(.array(cells))
        }
        return .object(["type": .string("table"), "columns": .array(head), "rows": .array(rows)])
    }
}

/// Categorical series colours, in the web app's fixed order.
private enum BlocksSeries {
    static let light = ["#2A78D6", "#EB6834", "#1BAF7A", "#EDA100"]
    static let dark = ["#3987E5", "#D95926", "#199E70", "#C98500"]

    static func colors(_ scheme: ColorScheme, count: Int) -> [Color] {
        let hexes = scheme == .dark ? dark : light
        return Array(hexes.prefix(max(1, min(count, hexes.count)))).map { Color(hex: $0) }
    }
}

struct BlocksChart: View {
    var d: JSONValue
    var compact: Bool

    @Environment(\.colorScheme) private var scheme
    @State private var asTable = false

    var body: some View {
        let model = BlocksChartModel(d)
        if model.valid {
            if asTable {
                VStack(alignment: .leading, spacing: 4) {
                    BlocksTable(d: model.asTable, compact: compact)
                    toggle("Show chart")
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    if model.many {
                        BlocksChartLegend(names: model.names, colors: BlocksSeries.colors(scheme, count: model.names.count))
                    }
                    BlocksChartPlot(model: model, colors: BlocksSeries.colors(scheme, count: model.names.count), compact: compact)
                        .frame(height: compact ? 150 : 230)
                        .accessibilityLabel(d.str("title") ?? "Chart")
                    toggle("Show as table")
                }
                .padding(compact ? 10 : 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .blocksCard(radius: 18, compact: compact)
            }
        }
    }

    private func toggle(_ label: String) -> some View {
        Button {
            withAnimation(.ssSoft) { asTable.toggle() }
        } label: {
            Text(label)
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.ink3)
                .padding(.horizontal, 4)
                .frame(minHeight: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .accessibilityIdentifier("blocks.chart.toggle")
    }
}

private struct BlocksChartLegend: View {
    var names: [String]
    var colors: [Color]

    var body: some View {
        FlowRow(spacing: 14) {
            ForEach(Array(names.enumerated()), id: \.offset) { item in
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(item.offset < colors.count ? colors[item.offset] : Theme.ink3)
                        .frame(width: 10, height: 10)
                    Text(item.element).font(.system(size: 12.5)).foregroundStyle(Theme.ink2).lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 4)
    }
}

private struct BlocksChartPlot: View {
    var model: BlocksChartModel
    var colors: [Color]
    var compact: Bool

    var body: some View {
        let unit = model.unit
        Chart {
            if model.kind == "line" {
                BlocksChartLines(model: model)
            } else {
                BlocksChartBars(model: model, labelled: !model.many && model.keys.count <= 12 && !compact)
            }
        }
        .chartForegroundStyleScale(domain: model.names, range: colors)
        .chartLegend(.hidden)
        .chartXScale(domain: model.keys)
        .chartYScale(domain: model.low...model.high)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Theme.line)
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(BlocksFormat.value(v, unit: unit)).font(.system(size: 11).monospacedDigit()).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel().font(.system(size: 11)).foregroundStyle(Theme.ink3)
            }
        }
    }
}

private struct BlocksChartBars: ChartContent {
    var model: BlocksChartModel
    var labelled: Bool

    var body: some ChartContent {
        ForEach(model.points) { p in
            BarMark(x: .value("Label", p.key), y: .value("Value", p.value))
                .foregroundStyle(by: .value("Series", p.series))
                .position(by: .value("Series", p.series))
                .cornerRadius(4)
                .annotation(position: p.value >= 0 ? .top : .bottom, spacing: 3) {
                    if labelled {
                        Text(BlocksFormat.value(p.value, unit: model.unit))
                            .font(.system(size: 11, weight: .medium).monospacedDigit())
                            .foregroundStyle(Theme.ink2)
                    }
                }
        }
    }
}

private struct BlocksChartLines: ChartContent {
    var model: BlocksChartModel

    var body: some ChartContent {
        ForEach(model.points) { p in
            LineMark(x: .value("Label", p.key), y: .value("Value", p.value))
                .foregroundStyle(by: .value("Series", p.series))
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
        ForEach(model.points.filter { $0.last }) { p in
            PointMark(x: .value("Label", p.key), y: .value("Value", p.value))
                .foregroundStyle(by: .value("Series", p.series))
                .symbolSize(50)
                .annotation(position: .topLeading, spacing: 3) {
                    Text(model.many ? p.series : BlocksFormat.value(p.value, unit: model.unit))
                        .font(.system(size: 11, weight: .medium).monospacedDigit())
                        .foregroundStyle(Theme.ink2)
                }
        }
    }
}
