using System.Globalization;
using System.Text.RegularExpressions;

namespace IsaacWallace.Api.Runs;

// Reads REAL, CURRENT request metrics for a run from its Envoy gateway's admin stats. Envoy sits in
// front of the checkout workload and is the single source of truth for request rate, latency, and
// errors — the arena renders exactly these numbers.
//
// Envoy's counters/histograms are cumulative since start, so a single read can't show "right now".
// Each call therefore takes TWO prometheus scrapes ~2s apart and reports the delta: request rate and
// 5xx rate over the window, and a windowed p95 via histogram-quantile over the bucket delta. That
// makes the metrics live — p95 actually falls once a scale decision relieves the saturation — and
// stateless, so it works regardless of which api replica serves the poll.
//
// The gateway is a scalable tier, so a run may have several Envoys and each one only counts the
// requests it served. Both rounds therefore scrape EVERY gateway pod directly by IP and sum them.
// Going through the ClusterIP Service instead would have kube-proxy pick one pod per round: the two
// rounds could land on different pods (a meaningless, often negative delta) and even when they
// agreed the run would report one gateway's share as though it were the whole cluster's throughput.
public sealed partial class EnvoyScraper(ILogger<EnvoyScraper> log)
{
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(3) };

    /// <param name="gatewayIps">Pod IPs of the run's Envoy replicas. Empty falls back to the
    /// namespace Service, which is correct only while the gateway is a single pod.</param>
    public async Task<EnvoyMetrics?> ScrapeAsync(
        string runId, string ns, IReadOnlyList<string> gatewayIps, CancellationToken ct)
    {
        var urls = gatewayIps.Count > 0
            ? gatewayIps.Select(ip => $"http://{ip}:9901/stats/prometheus").ToArray()
            : [$"http://envoy.{ns}.svc.cluster.local:9901/stats/prometheus"];

        Sample a, b;
        var t0 = DateTime.UtcNow;
        try
        {
            a = await SampleAllAsync(urls, ct);
            await Task.Delay(2000, ct);
            b = await SampleAllAsync(urls, ct);
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

    // One round: every gateway at once, summed. Scraping them in parallel keeps the round short, so
    // the delta window stays close to the 2s the rate is divided by.
    //
    // A gateway that fails to answer is skipped rather than failing the round. A replica that has
    // just been scheduled has no stats to give, and losing the whole frame because the fleet is mid
    // scale-out would blank the graph at precisely the moment the operator is watching it.
    private async Task<Sample> SampleAllAsync(IReadOnlyList<string> urls, CancellationToken ct)
    {
        var texts = await Task.WhenAll(urls.Select(async url =>
        {
            try { return await http.GetStringAsync(url, ct); }
            catch (Exception ex)
            {
                log.LogDebug(ex, "Gateway {Url} did not answer this round.", url);
                return null;
            }
        }));

        var answered = texts.OfType<string>().ToArray();
        if (answered.Length == 0) throw new HttpRequestException("No gateway answered.");

        long completed = 0, fivexx = 0;
        // Histograms merge by summing each bucket's count across gateways: the fleet's latency
        // distribution is the sum of its members' distributions, so a quantile over the merged
        // buckets is the fleet-wide quantile.
        var buckets = new Dictionary<double, long>();
        foreach (var one in answered.Select(Parse))
        {
            completed += one.Completed;
            fivexx += one.FiveXx;
            foreach (var (le, count) in one.Buckets)
                buckets[le] = buckets.GetValueOrDefault(le) + count;
        }

        return new Sample(
            completed,
            fivexx,
            buckets.OrderBy(pair => pair.Key).Select(pair => (pair.Key, pair.Value)).ToArray());
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
