//  Palette.cs — course hue + colors, matching the web/iOS/Android apps.
using System;
using System.Windows.Media;

namespace Lumen;

public static class Palette
{
    public const double Seed = 265;

    public static double Hue(string key)
    {
        uint x = 2166136261;
        foreach (var b in System.Text.Encoding.UTF8.GetBytes(key)) { x ^= b; x *= 16777619; }
        double[] p = { 265, 200, 150, 30, 340, 85, 230, 300, 175, 10, 120, 250 };
        return p[x % (uint)p.Length];
    }

    public static Color Hsv(double h, double s, double v)
    {
        h = ((h % 360) + 360) % 360 / 60.0;
        int i = (int)Math.Floor(h); double f = h - i;
        double p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
        double r, g, b;
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            default: r = v; g = p; b = q; break;
        }
        return Color.FromRgb((byte)(r * 255), (byte)(g * 255), (byte)(b * 255));
    }

    public static Color Accent(double hue, bool dark) => dark ? Hsv(hue, 0.55, 0.85) : Hsv(hue, 0.72, 0.70);
    public static Color Container(double hue, bool dark) => dark ? Hsv(hue, 0.35, 0.32) : Hsv(hue, 0.18, 0.95);
    public static Brush AccentBrush(double hue, bool dark) => new SolidColorBrush(Accent(hue, dark));
    public static Brush Banner(double hue, bool dark)
    {
        var a = dark ? Hsv(hue, 0.5, 0.42) : Hsv(hue, 0.62, 0.58);
        var b = dark ? Hsv((hue + 25) % 360, 0.5, 0.30) : Hsv((hue + 25) % 360, 0.6, 0.45);
        return new LinearGradientBrush(a, b, 45);
    }
}
