//  Theme.swift
//  Material-You-style dynamic color. Each course gets a stable hue; screens tint to it.

import SwiftUI

enum Theme {
    static func accent(_ hue: Double, _ dark: Bool) -> Color {
        dark ? Color(hue: hue / 360, saturation: 0.55, brightness: 0.85)
             : Color(hue: hue / 360, saturation: 0.72, brightness: 0.70)
    }
    static func container(_ hue: Double, _ dark: Bool) -> Color {
        dark ? Color(hue: hue / 360, saturation: 0.35, brightness: 0.32)
             : Color(hue: hue / 360, saturation: 0.18, brightness: 0.95)
    }
    static func onContainer(_ hue: Double, _ dark: Bool) -> Color {
        dark ? Color(hue: hue / 360, saturation: 0.25, brightness: 0.92)
             : Color(hue: hue / 360, saturation: 0.55, brightness: 0.30)
    }
    static func bannerGradient(_ hue: Double, _ dark: Bool) -> LinearGradient {
        let a = dark ? Color(hue: hue / 360, saturation: 0.5, brightness: 0.42)
                     : Color(hue: hue / 360, saturation: 0.62, brightness: 0.58)
        let b = dark ? Color(hue: (hue + 25) / 360, saturation: 0.5, brightness: 0.30)
                     : Color(hue: (hue + 25) / 360, saturation: 0.6, brightness: 0.45)
        return LinearGradient(colors: [a, b], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static let seed: Double = 265   // Lumen's default indigo
}

/// Status colors for work items.
extension WorkStatus {
    func tint(_ dark: Bool) -> Color {
        switch self {
        case .done: return dark ? .green.opacity(0.9) : .green
        case .missing: return dark ? Color(red: 1, green: 0.5, blue: 0.5) : Color(red: 0.8, green: 0.1, blue: 0.1)
        case .assigned: return .secondary
        }
    }
}
