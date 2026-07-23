using System.Globalization;
using System.Text.RegularExpressions;

namespace IsaacWallace.Api.Runs;

// Reads REAL, CURRENT request metrics for a run from its Envoy gateway's admin stats. Envoy sits in
// front of the checkout workload and is the single source of truth for request rate, latency, and
// errors — the arena renders exactly these numbers.
//
// Envoy's counters/histograms are cumulative since start, so a single read can't show "right now".
// Each call therefore takes TWO prometheus scrapes ~1s apart and reports the delta: request rate and
// 5xx rate over the window, and a windowed p95 via histogram-quantile over the bucket delta. That
// makes the metrics live — p95 actually falls once a scale decision relieves the saturation — and
// stateless, so it works regardless of which api replica serves the poll.
public sealed partial class EnvoyScraper(ILogger<EnvoyScraper> log)
{
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(3) };

    public async Task<EnvoyMetrics?> ScrapeAsync(string runId, string ns, CancellationToken ct)
    {
        var url = $"http://envoy.{ns}.svc.cluster.local:9901/stats/prometheus";
        Sample a, b;
        var t0 = DateTime.UtcNow;
        try
        {
            a = Parse(await http.GetStringAsync(url, ct));
            await Task.Delay(2000, ct);
            b = Parse(await http.GetStringAsync(url, ct));
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "Envoy scrape failed for {RunId} (workload may still be starting).", runId);
            return null;
        }

        var dt = Math.Max(0.5, (DateTime.UtcNow - t0).TotalSeconds);
        var dCompleted = Math.Max(0, b.Completed - a.Completed);
        var d5xx = Math.Max(0, b.FiveXx - a.FiveXx);

        var errPct = dCompleted > 0 ? (double)d5xx / dCompleted * 100.0 : 0;
        var p95 = P95FromDelta(a.Buckets, b.Buckets);

        return new EnvoyMetrics(
            RequestsPerSec: (int)Math.Round(dCompleted / dt),
            P95LatencyMs: (int)Math.Round(p95),
            ErrorRatePct: Math.Round(errPct, 2));
    }

    // histogram_quantile(0.95) over the per-bucket delta between two cumulative samples.
    private static double P95FromDelta(
        IReadOnlyList<(double Le, long Count)> a,
        IReadOnlyList<(double Le, long Count)> b)
    {
        if (b.Count == 0) return 0;
        var total = b[^1].Count - a[^1].Count; // +Inf bucket delta = all requests in the window
        if (total <= 0) return 0;
        var target = 0.95 * total;

        double prevLe = 0, prevCum = 0;
        foreach (var (le, _) in b)
        {
            var ai = a.FirstOrDefault(x => x.Le == le).Count;
            var bi = b.First(x => x.Le == le).Count;
            var cum = bi - ai;
            if (cum >= target)
            {
                if (double.IsPositiveInfinity(le)) return prevLe; // all in the last finite bucket
                var span = cum - prevCum;
                return span <= 0 ? le : prevLe + (target - prevCum) / span * (le - prevLe);
            }
            prevLe = double.IsPositiveInfinity(le) ? prevLe : le;
            prevCum = cum;
        }
        return prevLe;
    }

    private static Sample Parse(string text)
    {
        long completed = 0, fivexx = 0;
        var buckets = new List<(double Le, long Count)>();
        foreach (var line in text.AsSpan().EnumerateLines())
        {
            var s = line.ToString();
            if (s.Length == 0 || s[0] == '#' || !s.Contains("prefix=\"ingress\"")) continue;

            if (s.StartsWith("envoy_http_downstream_rq_completed{"))
                completed = TailValue(s);
            else if (s.StartsWith("envoy_http_downstream_rq_xx{") && s.Contains("class=\"5\""))
                fivexx = TailValue(s);
            else if (s.StartsWith("envoy_http_downstream_rq_time_bucket{"))
            {
                var le = LeRegex().Match(s);
                if (le.Success)
                {
                    var leVal = le.Groups[1].Value == "+Inf"
                        ? double.PositiveInfinity
                        : double.Parse(le.Groups[1].Value, CultureInfo.InvariantCulture);
                    buckets.Add((leVal, TailValue(s)));
                }
            }
        }
        buckets.Sort((x, y) => x.Le.CompareTo(y.Le));
        return new Sample(completed, fivexx, buckets);
    }

    private static long TailValue(string line)
    {
        var sp = line.LastIndexOf(' ');
        return sp >= 0 && long.TryParse(line.AsSpan(sp + 1), out var v) ? v : 0;
    }

    [GeneratedRegex(@"le=""([^""]+)""")]
    private static partial Regex LeRegex();

    private sealed record Sample(long Completed, long FiveXx, IReadOnlyList<(double Le, long Count)> Buckets);
}

public sealed record EnvoyMetrics(int RequestsPerSec, int P95LatencyMs, double ErrorRatePct);
