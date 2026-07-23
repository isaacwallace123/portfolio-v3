using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;

namespace IsaacWallace.Api.Runs;

// Reads REAL request metrics for a run from its Envoy gateway's admin stats. Envoy sits in front of
// the checkout workload and is the single source of truth for request rate, latency percentiles, and
// error rate — the arena renders exactly these numbers. Scraped over the allow-scrape NetworkPolicy
// (Envoy admin :9901); reachable only from in-cluster, and this API is the only intended reader.
public sealed partial class EnvoyScraper(ILogger<EnvoyScraper> log)
{
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(3) };

    // Per-run previous counter sample, so request/sec is a real delta rather than a lifetime average.
    private readonly ConcurrentDictionary<string, (long Completed, DateTime At)> _prev = new();

    public async Task<EnvoyMetrics?> ScrapeAsync(string runId, string ns, CancellationToken ct)
    {
        var url = $"http://envoy.{ns}.svc.cluster.local:9901/stats?filter=ingress.downstream_rq";
        string text;
        try
        {
            text = await http.GetStringAsync(url, ct);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "Envoy scrape failed for {RunId} (workload may still be starting).", runId);
            _prev.TryRemove(runId, out _);
            return null;
        }

        var completed = ParseCounter(text, "downstream_rq_completed");
        var fivexx = ParseCounter(text, "downstream_rq_5xx");
        var p95 = ParseP95(text);

        double rps = 0;
        var now = DateTime.UtcNow;
        if (_prev.TryGetValue(runId, out var prev))
        {
            var dt = (now - prev.At).TotalSeconds;
            if (dt >= 0.5 && completed >= prev.Completed)
                rps = (completed - prev.Completed) / dt;
        }
        _prev[runId] = (completed, now);

        var errPct = completed > 0 ? (double)fivexx / completed * 100.0 : 0;
        return new EnvoyMetrics(
            RequestsPerSec: (int)Math.Round(rps),
            P95LatencyMs: (int)Math.Round(p95),
            ErrorRatePct: Math.Round(errPct, 2));
    }

    public void Forget(string runId) => _prev.TryRemove(runId, out _);

    // "http.ingress.downstream_rq_completed: 94778"
    private static long ParseCounter(string stats, string suffix)
    {
        var m = Regex.Match(stats, $@"^http\.ingress\.{Regex.Escape(suffix)}:\s*(\d+)",
            RegexOptions.Multiline);
        return m.Success ? long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
    }

    // "http.ingress.downstream_rq_time: P0(...) ... P95(3084.83, 3084.61) ..." → 3084.83
    private static double ParseP95(string stats)
    {
        var m = P95Regex().Match(stats);
        return m.Success ? double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
    }

    [GeneratedRegex(@"http\.ingress\.downstream_rq_time:.*?P95\(([\d.]+)", RegexOptions.Singleline)]
    private static partial Regex P95Regex();
}

public sealed record EnvoyMetrics(int RequestsPerSec, int P95LatencyMs, double ErrorRatePct);
