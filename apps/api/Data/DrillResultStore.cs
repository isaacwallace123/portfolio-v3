using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Api.Data;

/// <summary>Per-drill aggregates over every recorded attempt, plus the caller's own.</summary>
public sealed record DrillStat(
    string DrillId,
    int Attempts,
    int Operators,
    long AverageMs,
    long BestMs,
    int YourAttempts,
    long? YourBestMs,
    long? YourAverageMs);

/// <summary>One operator's time standing across successful ranked recoveries.</summary>
public sealed record LeaderboardEntry(
    int Rank,
    string DisplayName,
    bool IsYou,
    int DrillsSolved,
    long BestMs,
    long AverageMs,
    int Missteps,
    DateTime AchievedUtc);

public sealed record LeaderboardView(
    IReadOnlyList<LeaderboardEntry> Entries);

// Reads and writes drill results. The only component that knows how a time becomes a standing.
public sealed class DrillResultStore(HomeOpsDbContext db, ILogger<DrillResultStore> log)
{
    /// <summary>Record a solve. Safe to call twice for the same attempt: the unique index on
    /// (RunId, DrillId, StartedUtc) is what actually keeps a double-write out of the averages, and
    /// losing that race is expected rather than exceptional.</summary>
    public async Task RecordAsync(DrillResult result, CancellationToken ct)
    {
        result.StartedUtc = DateTime.SpecifyKind(result.StartedUtc, DateTimeKind.Utc);
        result.CompletedUtc = DateTime.SpecifyKind(result.CompletedUtc, DateTimeKind.Utc);
        db.DrillResults.Add(result);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            db.Entry(result).State = EntityState.Detached;
            log.LogDebug(ex, "Drill result for {RunId}/{DrillId} was already recorded.",
                result.RunId, result.DrillId);
        }
    }

    /// <summary>Average and best solve time per drill, over every attempt ever recorded, with the
    /// caller's own numbers alongside. An average is only worth showing because practice attempts
    /// count too — otherwise it would describe the drills people already knew how to solve.</summary>
    public async Task<IReadOnlyList<DrillStat>> StatsAsync(string owner, CancellationToken ct)
    {
        var totals = await db.DrillResults
            .GroupBy(r => r.DrillId)
            .Select(g => new
            {
                DrillId = g.Key,
                Attempts = g.Count(),
                AverageMs = g.Average(x => (double)x.ElapsedMs),
                BestMs = g.Min(x => x.ElapsedMs),
            })
            .ToListAsync(ct);

        // Counted separately: "distinct owners within a group" is the one shape of this query that
        // does not translate cleanly on both providers.
        var operators = (await db.DrillResults
                .Select(r => new { r.DrillId, r.OwnerKey })
                .Distinct()
                .ToListAsync(ct))
            .GroupBy(x => x.DrillId)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);

        var mine = owner.Length == 0
            ? []
            : await db.DrillResults
                .Where(r => r.OwnerKey == owner)
                .GroupBy(r => r.DrillId)
                .Select(g => new
                {
                    DrillId = g.Key,
                    Attempts = g.Count(),
                    AverageMs = g.Average(x => (double)x.ElapsedMs),
                    BestMs = g.Min(x => x.ElapsedMs),
                })
                .ToListAsync(ct);

        var byDrill = mine.ToDictionary(x => x.DrillId, StringComparer.Ordinal);

        return totals.Select(t =>
        {
            byDrill.TryGetValue(t.DrillId, out var own);
            return new DrillStat(
                t.DrillId,
                t.Attempts,
                operators.GetValueOrDefault(t.DrillId),
                (long)Math.Round(t.AverageMs),
                t.BestMs,
                own?.Attempts ?? 0,
                own?.BestMs,
                own is null ? null : (long)Math.Round(own.AverageMs));
        }).ToArray();
    }

    /// <summary>
    /// The single time ladder. Each operator contributes their fastest verified recovery across the
    /// rated pool; average personal-best time and scenario breadth remain supporting context.
    /// </summary>
    public async Task<LeaderboardView> LeaderboardAsync(
        string owner,
        int limit,
        CancellationToken ct)
    {
        // Materialised and aggregated in memory: picking each operator's best row per drill AND
        // carrying that row's own missteps and date is two levels of grouping, which is where LINQ
        // translation gets provider-specific. Ranked solves are a small set, and this keeps the
        // ranking rules readable — which matters more here than shaving a query.
        var rows = await db.DrillResults
            .Where(r => r.Mode == "ranked")
            .Select(r => new
            {
                r.OwnerKey,
                r.DisplayName,
                r.DrillId,
                r.ElapsedMs,
                r.Missteps,
                r.CompletedUtc,
            })
            .ToListAsync(ct);

        // The name an operator most recently solved under — people rename themselves.
        var names = rows
            .GroupBy(r => r.OwnerKey, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(r => r.CompletedUtc).First().DisplayName,
                StringComparer.Ordinal);

        var bests = rows
            .GroupBy(r => (r.OwnerKey, r.DrillId))
            .Select(g => g.OrderBy(r => r.ElapsedMs).ThenBy(r => r.Missteps).First())
            .ToArray();

        var entries = bests
            .GroupBy(b => b.OwnerKey, StringComparer.Ordinal)
            .Select(g => new
            {
                OwnerKey = g.Key,
                DrillsSolved = g.Count(),
                BestMs = g.Min(b => b.ElapsedMs),
                AverageMs = (long)Math.Round(g.Average(b => (double)b.ElapsedMs)),
                Missteps = g.Sum(b => b.Missteps),
                AchievedUtc = g.Max(b => b.CompletedUtc),
            })
            .OrderBy(x => x.BestMs)
            .ThenBy(x => x.AverageMs)
            .ThenByDescending(x => x.DrillsSolved)
            .Take(limit)
            .Select((x, i) => new LeaderboardEntry(
                i + 1,
                names.GetValueOrDefault(x.OwnerKey, "operator"),
                x.OwnerKey == owner && owner.Length > 0,
                x.DrillsSolved,
                x.BestMs,
                x.AverageMs,
                x.Missteps,
                x.AchievedUtc))
            .ToArray();

        return new LeaderboardView(entries);
    }
}
