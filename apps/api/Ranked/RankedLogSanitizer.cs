using System.Text.RegularExpressions;

namespace IsaacWallace.Api.Ranked;

/// <summary>
/// The only path from raw workload logs to a ranked client. It bounds reads before allocation,
/// removes terminal controls, and redacts common credential shapes before any line is returned or
/// persisted as evidence.
/// </summary>
public static class RankedLogSanitizer
{
    public const int MaxCharsPerPod = 16 * 1024;
    public const int MaxLineLength = 180;

    private static readonly Regex AnsiEscape = new(
        @"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex CredentialUri = new(
        @"(?i)\b(?<scheme>postgres(?:ql)?|redis|https?)://[^@\s]+@",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex SecretAssignment = new(
        @"(?i)\b(?<key>authorization|password|passwd|pwd|token|secret|api[_-]?key|cookie|set-cookie)"
        + @"\s*[:=]\s*(?:bearer\s+)?[^\s,;]+",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex Whitespace = new(
        @"\s+",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static async Task<string> ReadBoundedAsync(
        TextReader reader,
        int maxChars = MaxCharsPerPod,
        CancellationToken ct = default)
    {
        if (maxChars <= 0) return "";
        var buffer = new char[Math.Min(4096, maxChars)];
        var result = new System.Text.StringBuilder(Math.Min(maxChars, 4096));
        while (result.Length < maxChars)
        {
            var remaining = Math.Min(buffer.Length, maxChars - result.Length);
            var read = await reader.ReadAsync(buffer.AsMemory(0, remaining), ct);
            if (read == 0) break;
            result.Append(buffer, 0, read);
        }
        return result.ToString();
    }

    public static string Sanitize(string line)
    {
        var withoutAnsi = AnsiEscape.Replace(line, "");
        var printable = new string(withoutAnsi
            .Select(character => char.IsControl(character) ? ' ' : character)
            .ToArray());
        var cleaned = CredentialUri.Replace(
            printable,
            match => $"{match.Groups["scheme"].Value}://[redacted]@");
        cleaned = SecretAssignment.Replace(
            cleaned,
            match => $"{match.Groups["key"].Value}=[redacted]");
        cleaned = Whitespace.Replace(cleaned, " ").Trim();
        return cleaned.Length <= MaxLineLength
            ? cleaned
            : cleaned[..MaxLineLength] + "...";
    }
}
