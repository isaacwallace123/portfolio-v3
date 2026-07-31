using System.Text.Json;

namespace IsaacWallace.Api.Ranked;

/// <summary>
/// The pacing and change-detection rules for the ranked launch stream, kept apart from the endpoint
/// so they can be proven without a cluster or an HTTP context.
///
/// The launch is a state machine that only moves when something advances it. It used to be the
/// browser that did the advancing, on a fixed 1.5s timer, which made the drive loop a property of
/// the client: every step cost a full round trip through the edge, the session introspection, and
/// the rate limiter, and the cadence could not vary with what the launch was actually waiting for.
/// The loop now runs next to the cluster and the browser only watches, so the tick can be chosen per
/// phase — by how expensive the observation is and how quickly the phase is expected to move.
/// </summary>
public static class RankedLaunchStream
{
    /// <summary>
    /// How long to wait before advancing a launch sitting in this phase.
    ///
    /// The spread is about the cost of the observation, not impatience. Provisioning is decided from
    /// one list of LabRuns, so it is cheap to check often and it is the phase a waiting operator
    /// stares at longest. Once the namespace exists every advance takes a full frame of the
    /// namespace — pods, metrics, deployments, events, traces, and a scrape of every gateway pod —
    /// which is emphatically not something to do once a second against the live API server.
    /// </summary>
    public static TimeSpan TickFor(string phase) => phase switch
    {
        RankedLaunchPhases.Provisioning => TimeSpan.FromSeconds(1),
        RankedLaunchPhases.StartingWorkloads => TimeSpan.FromSeconds(2),
        RankedLaunchPhases.VerifyingTelemetry => TimeSpan.FromSeconds(2),
        // The activation boundary is a short sequence of writes with nothing to wait for. Pausing
        // between them only adds latency to the one phase the operator is about to be timed on.
        RankedLaunchPhases.ActivatingIncident => TimeSpan.FromMilliseconds(250),
        _ => TimeSpan.FromSeconds(2),
    };

    /// <summary>
    /// A hard ceiling on how long one connection may drive a launch, independent of the launch's own
    /// budget. The budget is what decides that a launch has failed; this only stops a connection
    /// living forever if a launch somehow never reaches a terminal phase. Comfortably longer than
    /// the total budget, so it is a backstop and never the thing that ends a launch.
    /// </summary>
    public static readonly TimeSpan Ceiling = TimeSpan.FromMinutes(20);

    /// <summary>
    /// Whether two observations say the same thing about the launch.
    ///
    /// Deliberately ignores elapsed time. Every advance produces a view whose
    /// <see cref="RankedLaunchView.LaunchElapsedSeconds"/> has moved, so comparing whole views would
    /// mean re-sending the full state — checks and all — on every tick, which is the chattiness the
    /// stream exists to remove. Elapsed time rides on its own small tick event instead.
    /// </summary>
    public static bool SameState(RankedLaunchView? previous, RankedLaunchView current)
    {
        if (previous is null) return false;
        if (previous.Phase != current.Phase ||
            previous.Detail != current.Detail ||
            previous.Title != current.Title ||
            previous.RunId != current.RunId ||
            previous.LaunchId != current.LaunchId ||
            previous.Active != current.Active ||
            previous.Failed != current.Failed ||
            previous.Terminal != current.Terminal ||
            previous.Retryable != current.Retryable ||
            previous.ClockStarted != current.ClockStarted ||
            previous.AttemptId != current.AttemptId ||
            previous.FailureReason != current.FailureReason ||
            previous.Checks.Count != current.Checks.Count)
            return false;

        for (var i = 0; i < previous.Checks.Count; i++)
        {
            var a = previous.Checks[i];
            var b = current.Checks[i];
            if (a.Id != b.Id || a.Status != b.Status || a.Detail != b.Detail || a.Label != b.Label)
                return false;
        }

        return true;
    }

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Format one SSE frame. Every payload here is single-line JSON, so no data line ever
    /// needs splitting.</summary>
    public static string Frame(string @event, string data) => $"event: {@event}\ndata: {data}\n\n";

    public static string LaunchFrame(RankedLaunchView launch) =>
        Frame("launch", JsonSerializer.Serialize(new { launch }, Json));

    /// <summary>The between-changes frame: elapsed seconds and nothing else. It keeps the launch
    /// timer moving and keeps intermediaries from reaping an idle connection, at a few bytes rather
    /// than a full re-send of the state.</summary>
    public static string TickFrame(int launchElapsedSeconds) =>
        Frame(
            "tick",
            JsonSerializer.Serialize(new { launchElapsedSeconds }, Json));

    public static string EndFrame() => Frame("end", "{}");
}
