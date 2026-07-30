namespace IsaacWallace.Api.Ranked;

public sealed record RankedInspection(
    string Canonical,
    string Kind,
    string? Service,
    bool WarningsOnly)
{
    public const int MaxInputLength = 128;

    private static readonly IReadOnlyDictionary<string, string> Services =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["api"] = "checkout",
            ["checkout"] = "checkout",
            ["canary"] = "checkout-canary",
            ["gateway"] = "envoy",
            ["cache"] = "redis",
            ["database"] = "postgres",
            ["postgres"] = "postgres",
        };

    public static bool TryParse(
        string input,
        out RankedInspection? inspection,
        out string error)
    {
        inspection = null;
        error = "";
        if (input.Length > MaxInputLength)
        {
            error = $"Inspections must be {MaxInputLength} characters or fewer.";
            return false;
        }
        var command = string.Join(
            ' ',
            input.Trim().ToLowerInvariant()
                .Split(' ', StringSplitOptions.RemoveEmptyEntries));
        var words = command.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        if (words is ["inspect", "metrics"] or ["inspect", "metrics", _])
            return ServiceInspection(words, "metrics", out inspection, out error);
        if (words is ["inspect", "pods"] or ["inspect", "pods", _])
            return ServiceInspection(words, "pods", out inspection, out error);
        if (words is ["inspect", "logs"] or ["inspect", "logs", _])
            return ServiceInspection(words, "logs", out inspection, out error);
        if (words is ["inspect", "events"])
        {
            inspection = new RankedInspection("inspect events", "events", null, false);
            return true;
        }
        if (words is ["inspect", "events", "--warnings"])
        {
            inspection = new RankedInspection(
                "inspect events --warnings", "events", null, true);
            return true;
        }
        if (words is ["inspect", "deployments"])
        {
            inspection = new RankedInspection(
                "inspect deployments", "deployments", null, false);
            return true;
        }
        if (words is ["trace", "latest"])
        {
            inspection = new RankedInspection("trace latest", "trace", null, false);
            return true;
        }
        if (words is ["history"])
        {
            inspection = new RankedInspection("history", "history", null, false);
            return true;
        }

        error =
            "Inspection is not available. Use metrics, events, pods, logs, deployments, trace, or history.";
        return false;
    }

    private static bool ServiceInspection(
        IReadOnlyList<string> words,
        string kind,
        out RankedInspection? inspection,
        out string error)
    {
        inspection = null;
        error = "";
        string? service = null;
        if (words.Count == 3)
        {
            if (!Services.TryGetValue(words[2], out service))
            {
                error =
                    $"Unknown service '{words[2]}'. Use checkout, canary, gateway, cache, or database.";
                return false;
            }
        }

        var canonical = service is null
            ? $"inspect {kind}"
            : $"inspect {kind} {service}";
        inspection = new RankedInspection(canonical, kind, service, false);
        return true;
    }
}

public sealed record RankedInspectionResult(
    string Id,
    string Query,
    string Kind,
    int Stage,
    DateTime ObservedUtc,
    IReadOnlyList<string> Lines);
