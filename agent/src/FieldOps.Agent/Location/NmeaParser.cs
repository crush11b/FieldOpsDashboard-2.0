using System.Globalization;

namespace FieldOps.Agent.Location;

internal sealed record NmeaFix(
    double? Latitude, double? Longitude, double? Altitude, double? Speed, double? Heading,
    DateTimeOffset? TimestampUtc, int? Satellites, double? Hdop, int? FixQuality, bool HasFix);

internal static class NmeaParser
{
    public static bool TryParse(string sentence, out NmeaFix fix)
    {
        fix = default!;
        if (string.IsNullOrWhiteSpace(sentence) || sentence.Length > 128 || sentence[0] != '$') return false;
        var star = sentence.IndexOf('*');
        if (star >= 0)
        {
            if (star + 3 != sentence.Length || !byte.TryParse(sentence.AsSpan(star + 1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var expected)) return false;
            byte checksum = 0; foreach (var c in sentence.AsSpan(1, star - 1)) checksum ^= (byte)c;
            if (checksum != expected) return false;
        }
        var body = sentence[1..(star >= 0 ? star : sentence.Length)];
        var fields = body.Split(',');
        if (fields.Length == 0) return false;
        var type = fields[0];
        if (type.Length < 5 || (!type.EndsWith("GGA", StringComparison.Ordinal) && !type.EndsWith("RMC", StringComparison.Ordinal))) return false;
        return type.EndsWith("GGA", StringComparison.Ordinal) ? TryGga(fields, out fix) : TryRmc(fields, out fix);
    }

    private static bool TryGga(string[] f, out NmeaFix fix)
    {
        fix = default!;
        if (f.Length < 10 || !TryCoordinate(f[2], f[3], f[4], f[5], out var lat, out var lon)) return false;
        int? quality = Int(f[6]); var hasFix = quality is > 0;
        fix = new(lat, lon, Double(f[9]), null, null, ParseTime(f[1]), Int(f[7]), Double(f[8]), quality, hasFix);
        return true;
    }

    private static bool TryRmc(string[] f, out NmeaFix fix)
    {
        fix = default!;
        if (f.Length < 10 || !TryCoordinate(f[3], f[4], f[5], f[6], out var lat, out var lon)) return false;
        var valid = string.Equals(f[2], "A", StringComparison.OrdinalIgnoreCase);
        fix = new(lat, lon, null, Double(f[7]) is double speed ? speed * 0.514444 : null, Double(f[8]), ParseDateTime(f[9], f[1]), null, null, null, valid);
        return true;
    }

    private static bool TryCoordinate(string value, string ns, string value2, string ew, out double? lat, out double? lon)
    {
        lat = lon = null;
        if (!TryCoord(value, ns, out var a) || !TryCoord(value2, ew, out var b)) return false;
        lat = a; lon = b; return true;
    }
    private static bool TryCoord(string value, string hemi, out double result)
    {
        result = 0; if (string.IsNullOrWhiteSpace(value) || value.Length < 4 || !double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var raw)) return false;
        var deg = Math.Floor(raw / 100); var minutes = raw - deg * 100; if (minutes >= 60) return false;
        result = (deg + minutes / 60) * (hemi is "S" or "W" ? -1 : hemi is "N" or "E" ? 1 : 0); return hemi is "N" or "S" or "E" or "W";
    }
    private static double? Double(string value) => double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && double.IsFinite(v) ? v : null;
    private static int? Int(string value) => int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;
    private static DateTimeOffset? ParseTime(string value) => DateTimeOffset.TryParseExact(value, "HHmmss.FFF", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t : null;
    private static DateTimeOffset? ParseDateTime(string date, string time) => DateTimeOffset.TryParseExact(date + time, new[] { "ddMMyyHHmmss.FFF", "ddMMyyHHmmss" }, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t : null;
}
