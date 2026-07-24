using System.Text.Json;

namespace IsaacWallace.Api.Runs;

// Reads one sanitized OpenTelemetry trace from the disposable checkout service. The service keeps a
// small in-memory ring of spans and exposes only allowlisted names/attributes on an internal path.
// Raw request headers, SQL, pod names, and user data never cross this boundary.
public sealed class TraceScraper(ILogger<TraceScraper> log)
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<RunTrace?> ScrapeAsync(string runId, string ns, CancellationToken ct)
    {
        try
        {
            var json = await _http.GetStringAsync(
                $"http://checkout.{ns}.svc.cluster.local/internal/traces/latest", ct);
            return JsonSerializer.Deserialize<RunTrace>(json, JsonOptions);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "Trace scrape failed for {RunId}.", runId);
            return null;
        }
    }
}

public sealed record RunTrace(
    string TraceId,
    string Release,
    int DurationMs,
    DateTime CapturedAt,
    IReadOnlyList<RunSpan> Spans);

public sealed record RunSpan(
    string SpanId,
    string? ParentSpanId,
    string Name,
    string Service,
    int DurationMs,
    string Status,
    IReadOnlyDictionary<string, string> Attributes);
