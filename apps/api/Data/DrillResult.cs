namespace IsaacWallace.Api.Data;

// One completed drill attempt. Written once, by the broker, at the instant a drill is actually
// solved — so a row here means the workload really did reach the target state, not that someone
// clicked the right buttons.
//
// EVERY solve is recorded, practice and ranked alike. That is what makes an average solve time worth
// showing: it is the whole field's experience of a drill, not a self-selected sample of good runs.
public sealed class DrillResult
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");

    /// <summary>The cluster the attempt ran on. With StartedUtc it identifies the attempt, which is
    /// what keeps a double-recorded solve out of the averages.</summary>
    public string RunId { get; set; } = "";

    public string DrillId { get; set; } = "";

    /// <summary>practice | ranked. Ranked results are the ones the leaderboard is built from.</summary>
    public string Mode { get; set; } = "practice";

    /// <summary>The opaque per-user key the cluster was provisioned with — a hash of the account id,
    /// never the id itself.</summary>
    public string OwnerKey { get; set; } = "";

    /// <summary>Resolved from the operator's SSO session by the site, server-side. Denormalised so
    /// the board can be rendered without a second identity lookup per row; the most recent name an
    /// operator solved under wins.</summary>
    public string DisplayName { get; set; } = "operator";

    public int StageCount { get; set; }

    /// <summary>Time from the drill starting to its objective first being met, in milliseconds.</summary>
    public long ElapsedMs { get; set; }

    /// <summary>Wrong options chosen across every stage. They were really applied to the cluster, so
    /// a fast time with missteps is a different result from a fast time without them.</summary>
    public int Missteps { get; set; }

    public int CorrectChosen { get; set; }
    public int CorrectTotal { get; set; }

    public DateTime StartedUtc { get; set; }
    public DateTime CompletedUtc { get; set; }
}
