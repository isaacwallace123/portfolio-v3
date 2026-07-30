using System.Data;
using System.Text.Json;
using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Api.Data;

public sealed record RankedAttemptView(
    string Id,
    string RunId,
    string DrillId,
    int ScenarioVersion,
    int ScenarioRating,
    string Outcome,
    DateTime StartedUtc,
    DateTime? CompletedUtc,
    long ElapsedMs,
    int StageReached,
    string FailedMove,
    int PreRating,
    double ExpectedScore,
    int RatingDelta,
    int PostRating,
    RankedPerformanceView? Performance,
    RankedMatchBriefing? Briefing,
    RankedMatchDebrief? Debrief,
    IReadOnlyList<RankedEvidenceView> Evidence);

public sealed record RankedPerformanceView(
    int QualityScore,
    double RatingScore,
    int SloHealthScore,
    int ObjectiveHealthScore,
    int ActionScore,
    int ContainmentScore,
    int TargetedActions,
    int HarmfulActions,
    int UnnecessaryActions,
    int RedundantActions,
    int ConvergenceViolations,
    int SampleCount,
    double PeakP95LatencyMs,
    double PeakErrorRatePct,
    int MinimumServedRatioPct,
    int VerificationSeconds,
    string Band);

public sealed record RankedTelemetryObservation(
    string AttemptId,
    string RunId,
    string OwnerKey,
    DateTime RecordedUtc,
    int Stage,
    int OfferedRequestsPerSec,
    int ServedRequestsPerSec,
    double P95LatencyMs,
    double ErrorRatePct,
    int ObjectiveGoalsMet,
    int ObjectiveGoalsTotal,
    int SloGoalsMet,
    int SloGoalsTotal,
    int HeldSeconds);

public sealed record RankedDrawContext(
    int Rating,
    IReadOnlySet<string> PlayedSeedIds,
    IReadOnlyList<string> RecentFamilies,
    IReadOnlyDictionary<string, int> FamilyAdjustments);

public sealed record RankedProfileView(
    int Rating,
    int PeakRating,
    int? LadderRank,
    int RatedOperators,
    string Division,
    int DivisionFloor,
    int? DivisionCeiling,
    double DivisionProgress,
    int GamesPlayed,
    int Wins,
    int Losses,
    int CurrentStreak,
    int BestStreak,
    int ProvisionalGamesRemaining,
    IReadOnlyList<RankedAttemptView> RecentAttempts);

public sealed record RankedStandingView(
    int Rank,
    string DisplayName,
    bool IsYou,
    int Rating,
    string Division,
    int GamesPlayed,
    int Wins,
    int Losses,
    int CurrentStreak);

public sealed record RankedActionView(
    string Id,
    string AttemptId,
    string RunId,
    string Command,
    string ActionId,
    int Stage,
    DateTime AcceptedUtc);

public sealed record RankedEvidenceView(
    string Id,
    string Query,
    string Kind,
    string Summary,
    int Stage,
    DateTime ObservedUtc);

/// <summary>
/// The transactional boundary for competitive results. A final attempt, its rating mutation, and
/// its ledger row commit together, so two API replicas judging the same frame cannot rate it twice.
/// </summary>
public sealed class RankedStore(HomeOpsDbContext db, ILogger<RankedStore> log)
{
    public async Task<RankedAttemptView> BeginAsync(
        string runId,
        string drillId,
        string owner,
        string displayName,
        DateTime startedUtc,
        CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, ct);

        var active = await db.RankedAttempts
            .AsNoTracking()
            .Where(a => a.OwnerKey == owner && a.Outcome == RankedOutcomes.Active)
            .OrderByDescending(a => a.StartedUtc)
            .FirstOrDefaultAsync(ct);
        if (active is not null)
            throw new InvalidOperationException("A ranked attempt is already active.");

        var rating = await db.OperatorRatings
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.OwnerKey == owner, ct);
        var current = rating?.Rating ?? RankedRules.InitialRating;
        var generated = RankedScenarioCatalog.TryPlan(drillId);
        var scenarioRating = generated?.ScenarioRating ?? RankedRules.ScenarioRating(drillId);

        var attempt = new RankedAttempt
        {
            RunId = runId,
            DrillId = drillId,
            ScenarioVersion = RankedRules.ScenarioVersion,
            ScenarioRating = scenarioRating,
            OwnerKey = owner,
            DisplayName = CleanName(displayName),
            Outcome = RankedOutcomes.Active,
            StartedUtc = Utc(startedUtc),
            PreRating = current,
            ExpectedScore = RankedRules.ExpectedScore(current, scenarioRating),
            PostRating = current,
        };
        if (generated is not null)
        {
            attempt.Scenario = new RankedScenarioRecord
            {
                AttemptId = attempt.Id,
                OwnerKey = owner,
                DrillId = generated.DrillId,
                SeedId = generated.Seed.SeedId,
                GeneratorVersion = generated.Seed.GeneratorVersion,
                PlayerRating = generated.Seed.PlayerRating,
                PlanJson = JsonSerializer.Serialize(generated),
                FamiliesJson = JsonSerializer.Serialize(generated.FamilyList),
                CreatedUtc = Utc(startedUtc),
            };
        }
        db.RankedAttempts.Add(attempt);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return View(attempt);
    }

    public async Task<RankedAttemptView?> FinalizeAsync(
        string attemptId,
        string owner,
        string outcome,
        long elapsedMs,
        int stageReached,
        string failedMove,
        string displayName,
        CancellationToken ct)
    {
        if (!RankedOutcomes.IsFinal(outcome))
            throw new ArgumentOutOfRangeException(nameof(outcome), "Outcome must be terminal.");

        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, ct);
            var attempt = await db.RankedAttempts
                .Include(candidate => candidate.Performance)
                .Include(candidate => candidate.Scenario)
                .Include(candidate => candidate.Evidence)
                .SingleOrDefaultAsync(a => a.Id == attemptId && a.OwnerKey == owner, ct);
            if (attempt is null) return null;
            if (attempt.Outcome != RankedOutcomes.Active) return View(attempt);

            var now = DateTime.UtcNow;
            attempt.Outcome = outcome;
            attempt.CompletedUtc = now;
            attempt.ElapsedMs = Math.Max(0, elapsedMs);
            attempt.StageReached = Math.Max(0, stageReached);
            attempt.FailedMove = failedMove.Trim();
            if (!string.IsNullOrWhiteSpace(displayName))
                attempt.DisplayName = CleanName(displayName);

            var scenario = ScenarioDefinitions.Find(attempt.DrillId);
            if (scenario is null)
                throw new InvalidOperationException(
                    $"Ranked scenario '{attempt.DrillId}' is no longer available for audit.");

            var samples = await db.RankedTelemetry
                .AsNoTracking()
                .Where(sample =>
                    sample.AttemptId == attempt.Id &&
                    sample.OwnerKey == owner)
                .OrderBy(sample => sample.RecordedUtc)
                .ToListAsync(ct);
            if (outcome == RankedOutcomes.Completed && samples.Count == 0)
                throw new InvalidOperationException(
                    "A completed ranked match cannot be rated without measured telemetry.");

            var actions = await db.RankedActions
                .AsNoTracking()
                .Where(action =>
                    action.AttemptId == attempt.Id &&
                    action.OwnerKey == owner)
                .OrderBy(action => action.AcceptedUtc)
                .ToListAsync(ct);
            var performance = RankedPerformance.Evaluate(
                outcome,
                scenario,
                samples.Select(Signal).ToArray(),
                actions.Select(action => new RankedActionSignal(
                    action.Command,
                    action.Stage,
                    action.AcceptedUtc)).ToArray(),
                scenario.Stages[^1].HoldSeconds);
            attempt.Performance = Performance(attempt, performance, now);

            if (RankedOutcomes.IsRated(outcome))
            {
                var rating = await db.OperatorRatings
                    .SingleOrDefaultAsync(r => r.OwnerKey == owner, ct);
                if (rating is null)
                {
                    rating = NewRating(owner, attempt.DisplayName, now);
                    db.OperatorRatings.Add(rating);
                }

                var result = RankedRules.Calculate(
                    rating.Rating,
                    rating.GamesPlayed,
                    attempt.ScenarioRating,
                    performance.RatingScore,
                    outcome is RankedOutcomes.Forfeited or RankedOutcomes.Expired);

                attempt.PreRating = result.Before;
                attempt.ExpectedScore = result.ExpectedScore;
                attempt.RatingDelta = result.Delta;
                attempt.PostRating = result.After;

                rating.DisplayName = attempt.DisplayName;
                rating.Rating = result.After;
                rating.PeakRating = Math.Max(rating.PeakRating, result.After);
                rating.GamesPlayed += 1;
                if (outcome == RankedOutcomes.Completed)
                {
                    rating.Wins += 1;
                    rating.CurrentStreak += 1;
                    rating.BestStreak = Math.Max(rating.BestStreak, rating.CurrentStreak);
                }
                else
                {
                    rating.Losses += 1;
                    rating.CurrentStreak = 0;
                }
                rating.UpdatedUtc = now;

                db.RatingLedger.Add(new RatingLedgerEntry
                {
                    AttemptId = attempt.Id,
                    OwnerKey = owner,
                    Outcome = outcome,
                    BeforeRating = result.Before,
                    Delta = result.Delta,
                    AfterRating = result.After,
                    CreatedUtc = now,
                });

                if (attempt.Scenario is not null)
                {
                    var families =
                        JsonSerializer.Deserialize<string[]>(attempt.Scenario.FamiliesJson) ?? [];
                    foreach (var family in families.Distinct(StringComparer.Ordinal))
                    {
                        var calibration = await db.RankedCalibrations
                            .SingleOrDefaultAsync(candidate => candidate.Family == family, ct);
                        if (calibration is null)
                        {
                            calibration = new RankedCalibrationRecord { Family = family };
                            db.RankedCalibrations.Add(calibration);
                        }
                        calibration.RatedAttempts += 1;
                        if (outcome == RankedOutcomes.Completed) calibration.Completions += 1;
                        calibration.UpdatedUtc = now;
                    }
                }
            }
            else
            {
                attempt.RatingDelta = 0;
                attempt.PostRating = attempt.PreRating;
            }

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return View(attempt);
        }
        catch (DbUpdateException ex)
        {
            // Another API replica may have finalized the same attempt after both observed the same
            // terminal cluster state. The unique ledger index decides the race; return its result.
            log.LogDebug(ex, "Ranked attempt {AttemptId} was already finalized.", attemptId);
            db.ChangeTracker.Clear();
            return await GetAttemptAsync(attemptId, owner, ct);
        }
    }

    public async Task<RankedAttemptView?> GetAttemptAsync(
        string attemptId,
        string owner,
        CancellationToken ct)
    {
        var attempt = await db.RankedAttempts
            .AsNoTracking()
            .Include(candidate => candidate.Performance)
            .Include(candidate => candidate.Scenario)
            .Include(candidate => candidate.Evidence)
            .SingleOrDefaultAsync(a => a.Id == attemptId && a.OwnerKey == owner, ct);
        return attempt is null ? null : View(attempt);
    }

    public async Task<RankedAttemptView?> ActiveForRunAsync(
        string runId,
        string owner,
        CancellationToken ct)
    {
        var attempt = await db.RankedAttempts
            .AsNoTracking()
            .Include(candidate => candidate.Performance)
            .Include(candidate => candidate.Scenario)
            .Include(candidate => candidate.Evidence)
            .Where(a =>
                a.RunId == runId &&
                a.OwnerKey == owner &&
                a.Outcome == RankedOutcomes.Active)
            .OrderByDescending(a => a.StartedUtc)
            .FirstOrDefaultAsync(ct);
        return attempt is null ? null : View(attempt);
    }

    public async Task<RankedAttemptView?> ActiveForOwnerAsync(
        string owner,
        CancellationToken ct)
    {
        var attempt = await db.RankedAttempts
            .AsNoTracking()
            .Include(candidate => candidate.Performance)
            .Include(candidate => candidate.Scenario)
            .Include(candidate => candidate.Evidence)
            .Where(a => a.OwnerKey == owner && a.Outcome == RankedOutcomes.Active)
            .OrderByDescending(a => a.StartedUtc)
            .FirstOrDefaultAsync(ct);
        return attempt is null ? null : View(attempt);
    }

    public async Task<bool> RecordActionAsync(
        string id,
        string attemptId,
        string runId,
        string owner,
        string command,
        string actionId,
        int stage,
        DateTime acceptedUtc,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(id) ||
            id.Length > 64 ||
            string.IsNullOrWhiteSpace(attemptId) ||
            string.IsNullOrWhiteSpace(runId) ||
            string.IsNullOrWhiteSpace(owner))
            return false;

        var existing = await db.RankedActions
            .AsNoTracking()
            .SingleOrDefaultAsync(action => action.Id == id, ct);
        if (existing is not null)
            return existing.AttemptId == attemptId &&
                existing.RunId == runId &&
                existing.OwnerKey == owner;

        var attemptExists = await db.RankedAttempts
            .AsNoTracking()
            .AnyAsync(
                attempt =>
                    attempt.Id == attemptId &&
                    attempt.RunId == runId &&
                    attempt.OwnerKey == owner,
                ct);
        if (!attemptExists) return false;

        var actionCount = await db.RankedActions
            .AsNoTracking()
            .CountAsync(action =>
                action.AttemptId == attemptId &&
                action.RunId == runId &&
                action.OwnerKey == owner,
                ct);
        if (actionCount >= RankedRules.MaxActionsPerAttempt) return false;

        db.RankedActions.Add(new RankedActionEntry
        {
            Id = id,
            AttemptId = attemptId,
            RunId = runId,
            OwnerKey = owner,
            Command = command[..Math.Min(command.Length, 128)],
            ActionId = actionId[..Math.Min(actionId.Length, 64)],
            Stage = Math.Max(1, stage),
            AcceptedUtc = Utc(acceptedUtc),
        });
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex)
        {
            log.LogDebug(ex, "Ranked action {ActionEntryId} was already recorded.", id);
            db.ChangeTracker.Clear();
            return await db.RankedActions
                .AsNoTracking()
                .AnyAsync(action =>
                    action.Id == id &&
                    action.AttemptId == attemptId &&
                    action.RunId == runId &&
                    action.OwnerKey == owner,
                    ct);
        }
    }

    public async Task<bool> RecordTelemetryAsync(
        RankedTelemetryObservation observation,
        CancellationToken ct)
    {
        var attempt = await db.RankedAttempts
            .AsNoTracking()
            .SingleOrDefaultAsync(
                candidate =>
                    candidate.Id == observation.AttemptId &&
                    candidate.RunId == observation.RunId &&
                    candidate.OwnerKey == observation.OwnerKey &&
                    candidate.Outcome == RankedOutcomes.Active,
                ct);
        if (attempt is null) return false;

        var recordedUtc = Utc(observation.RecordedUtc);
        var bucket = Math.Max(
            0,
            (long)Math.Floor(
                (recordedUtc - Utc(attempt.StartedUtc)).TotalSeconds /
                RankedPerformance.TelemetryBucketSeconds));
        var id = $"{attempt.Id}:{bucket:x}";
        if (await db.RankedTelemetry.AsNoTracking().AnyAsync(sample => sample.Id == id, ct))
            return true;

        db.RankedTelemetry.Add(new RankedTelemetrySample
        {
            Id = id,
            AttemptId = attempt.Id,
            RunId = attempt.RunId,
            OwnerKey = attempt.OwnerKey,
            RecordedUtc = recordedUtc,
            Stage = Math.Max(1, observation.Stage),
            OfferedRequestsPerSec = Math.Max(0, observation.OfferedRequestsPerSec),
            ServedRequestsPerSec = Math.Max(0, observation.ServedRequestsPerSec),
            P95LatencyMs = Math.Max(0, observation.P95LatencyMs),
            ErrorRatePct = Math.Clamp(observation.ErrorRatePct, 0, 100),
            ObjectiveGoalsMet = Math.Max(0, observation.ObjectiveGoalsMet),
            ObjectiveGoalsTotal = Math.Max(0, observation.ObjectiveGoalsTotal),
            SloGoalsMet = Math.Max(0, observation.SloGoalsMet),
            SloGoalsTotal = Math.Max(0, observation.SloGoalsTotal),
            HeldSeconds = Math.Max(0, observation.HeldSeconds),
        });
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex)
        {
            log.LogDebug(
                ex,
                "Ranked telemetry bucket {TelemetryBucketId} was already recorded.",
                id);
            db.ChangeTracker.Clear();
            return await db.RankedTelemetry
                .AsNoTracking()
                .AnyAsync(sample => sample.Id == id, ct);
        }
    }

    public async Task<RankedEvidenceView?> RecordEvidenceAsync(
        string id,
        string attemptId,
        string runId,
        string owner,
        string query,
        string kind,
        string summary,
        int stage,
        DateTime observedUtc,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(id) ||
            id.Length > 64 ||
            string.IsNullOrWhiteSpace(attemptId) ||
            string.IsNullOrWhiteSpace(runId) ||
            string.IsNullOrWhiteSpace(owner))
            return null;

        var attemptExists = await db.RankedAttempts
            .AsNoTracking()
            .AnyAsync(
                attempt =>
                    attempt.Id == attemptId &&
                    attempt.RunId == runId &&
                    attempt.OwnerKey == owner &&
                    attempt.Outcome == RankedOutcomes.Active,
                ct);
        if (!attemptExists) return null;

        var existing = await db.RankedEvidence
            .AsNoTracking()
            .SingleOrDefaultAsync(evidence => evidence.Id == id, ct);
        if (existing is not null)
            return existing.AttemptId == attemptId &&
                existing.RunId == runId &&
                existing.OwnerKey == owner
                ? View(existing)
                : null;

        var evidenceCount = await db.RankedEvidence
            .AsNoTracking()
            .CountAsync(evidence =>
                evidence.AttemptId == attemptId &&
                evidence.RunId == runId &&
                evidence.OwnerKey == owner,
                ct);
        if (evidenceCount >= RankedRules.MaxEvidencePerAttempt) return null;

        var item = new RankedEvidenceEntry
        {
            Id = id,
            AttemptId = attemptId,
            RunId = runId,
            OwnerKey = owner,
            Query = query[..Math.Min(query.Length, 128)],
            Kind = kind[..Math.Min(kind.Length, 32)],
            Summary = summary[..Math.Min(summary.Length, 512)],
            Stage = Math.Max(1, stage),
            ObservedUtc = Utc(observedUtc),
        };
        db.RankedEvidence.Add(item);
        try
        {
            await db.SaveChangesAsync(ct);
            return View(item);
        }
        catch (DbUpdateException ex)
        {
            log.LogDebug(ex, "Ranked evidence {EvidenceId} was already recorded.", id);
            db.ChangeTracker.Clear();
            existing = await db.RankedEvidence
                .AsNoTracking()
                .SingleOrDefaultAsync(evidence =>
                    evidence.Id == item.Id &&
                    evidence.AttemptId == attemptId &&
                    evidence.RunId == runId &&
                    evidence.OwnerKey == owner,
                    ct);
            return existing is null ? null : View(existing);
        }
    }

    public async Task<IReadOnlyList<RankedActionView>> ActionsForAttemptAsync(
        string attemptId,
        string owner,
        CancellationToken ct) =>
        await db.RankedActions
            .AsNoTracking()
            .Where(action =>
                action.AttemptId == attemptId &&
                action.OwnerKey == owner)
            .OrderBy(action => action.AcceptedUtc)
            .Select(action => new RankedActionView(
                action.Id,
                action.AttemptId,
                action.RunId,
                action.Command,
                action.ActionId,
                action.Stage,
                action.AcceptedUtc))
            .ToArrayAsync(ct);

    public async Task<RankedProfileView> ProfileAsync(string owner, CancellationToken ct)
    {
        var rating = await db.OperatorRatings
            .AsNoTracking()
            .SingleOrDefaultAsync(r => r.OwnerKey == owner, ct);
        var value = rating?.Rating ?? RankedRules.InitialRating;
        var division = RankedRules.Division(value);
        var ratedOperators = await db.OperatorRatings
            .AsNoTracking()
            .CountAsync(r => r.GamesPlayed > 0, ct);
        int? ladderRank = rating is { GamesPlayed: > 0 }
            ? 1 + await db.OperatorRatings
                .AsNoTracking()
                .CountAsync(r => r.GamesPlayed > 0 && r.Rating > rating.Rating, ct)
            : null;
        var recent = await db.RankedAttempts
            .AsNoTracking()
            .Include(attempt => attempt.Performance)
            .Include(attempt => attempt.Scenario)
            .Include(attempt => attempt.Evidence)
            .Where(a => a.OwnerKey == owner)
            .OrderByDescending(a => a.StartedUtc)
            .Take(12)
            .ToListAsync(ct);

        return new RankedProfileView(
            value,
            rating?.PeakRating ?? value,
            ladderRank,
            ratedOperators,
            division.Name,
            division.Floor,
            division.Ceiling,
            division.Progress,
            rating?.GamesPlayed ?? 0,
            rating?.Wins ?? 0,
            rating?.Losses ?? 0,
            rating?.CurrentStreak ?? 0,
            rating?.BestStreak ?? 0,
            Math.Max(0, RankedRules.PlacementGames - (rating?.GamesPlayed ?? 0)),
            recent.Select(View).ToArray());
    }

    public async Task<RankedDrawContext> DrawContextAsync(
        string owner,
        CancellationToken ct)
    {
        var rating = await db.OperatorRatings
            .AsNoTracking()
            .SingleOrDefaultAsync(candidate => candidate.OwnerKey == owner, ct);
        var scenarios = await db.RankedScenarios
            .AsNoTracking()
            .Where(scenario => scenario.OwnerKey == owner)
            .OrderByDescending(scenario => scenario.CreatedUtc)
            .ToListAsync(ct);
        var recentFamilies = scenarios
            .Take(RankedMatchmaker.RecentExclusionCount)
            .SelectMany(scenario =>
                JsonSerializer.Deserialize<string[]>(scenario.FamiliesJson) ?? [])
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var calibrations = await db.RankedCalibrations
            .AsNoTracking()
            .ToDictionaryAsync(
                calibration => calibration.Family,
                calibration => RankedRules.CalibrationAdjustment(
                    calibration.RatedAttempts,
                    calibration.Completions),
                StringComparer.Ordinal,
                ct);

        return new RankedDrawContext(
            rating?.Rating ?? RankedRules.InitialRating,
            scenarios.Select(scenario => scenario.SeedId).ToHashSet(StringComparer.Ordinal),
            recentFamilies,
            calibrations);
    }

    public async Task<IReadOnlyList<RankedStandingView>> LeaderboardAsync(
        string owner,
        int limit,
        CancellationToken ct)
    {
        var ratings = await db.OperatorRatings
            .AsNoTracking()
            .Where(r => r.GamesPlayed > 0)
            .OrderByDescending(r => r.Rating)
            .ThenByDescending(r => r.Wins)
            .ThenBy(r => r.Losses)
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync(ct);

        return ratings.Select(rating => new RankedStandingView(
            ratings.FindIndex(candidate => candidate.Rating == rating.Rating) + 1,
            rating.DisplayName,
            owner.Length > 0 && rating.OwnerKey == owner,
            rating.Rating,
            RankedRules.Division(rating.Rating).Name,
            rating.GamesPlayed,
            rating.Wins,
            rating.Losses,
            rating.CurrentStreak)).ToArray();
    }

    private static OperatorRating NewRating(string owner, string name, DateTime now) =>
        new()
        {
            OwnerKey = owner,
            DisplayName = CleanName(name),
            Rating = RankedRules.InitialRating,
            PeakRating = RankedRules.InitialRating,
            UpdatedUtc = now,
        };

    private static DateTime Utc(DateTime value) =>
        value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime();

    private static string CleanName(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? "operator" : trimmed[..Math.Min(trimmed.Length, 48)];
    }

    private static RankedAttemptView View(RankedAttempt attempt)
    {
        var plan = ReadPlan(attempt);
        var activeGenerated = attempt.Outcome == RankedOutcomes.Active && plan is not null;
        return new(
            attempt.Id,
            attempt.RunId,
            activeGenerated ? RankedScenarioSeed.PublicDrillId : attempt.DrillId,
            attempt.ScenarioVersion,
            attempt.ScenarioRating,
            attempt.Outcome,
            attempt.StartedUtc,
            attempt.CompletedUtc,
            attempt.ElapsedMs,
            attempt.StageReached,
            attempt.FailedMove,
            attempt.PreRating,
            attempt.ExpectedScore,
            attempt.RatingDelta,
            attempt.PostRating,
            attempt.Performance is null ? null : View(attempt.Performance),
            plan is not null
                ? RankedMatchBriefing.From(plan)
                : null,
            attempt.Outcome != RankedOutcomes.Active && plan is not null
                ? RankedMatchDebrief.From(plan)
                : null,
            attempt.Evidence
                .OrderBy(evidence => evidence.ObservedUtc)
                .Select(View)
                .ToArray());
    }

    private static RankedEvidenceView View(RankedEvidenceEntry evidence) =>
        new(
            evidence.Id,
            evidence.Query,
            evidence.Kind,
            evidence.Summary,
            evidence.Stage,
            evidence.ObservedUtc);

    private static RankedPerformanceView View(RankedPerformanceRecord performance) =>
        new(
            performance.QualityScore,
            performance.RatingScore,
            performance.SloHealthScore,
            performance.ObjectiveHealthScore,
            performance.ActionScore,
            performance.ContainmentScore,
            performance.TargetedActions,
            performance.HarmfulActions,
            performance.UnnecessaryActions,
            performance.RedundantActions,
            performance.ConvergenceViolations,
            performance.SampleCount,
            performance.PeakP95LatencyMs,
            performance.PeakErrorRatePct,
            performance.MinimumServedRatioPct,
            performance.VerificationSeconds,
            performance.Band);

    private static RankedTelemetryFrame Signal(RankedTelemetrySample sample) =>
        new(
            sample.RecordedUtc,
            sample.Stage,
            sample.OfferedRequestsPerSec,
            sample.ServedRequestsPerSec,
            sample.P95LatencyMs,
            sample.ErrorRatePct,
            sample.ObjectiveGoalsMet,
            sample.ObjectiveGoalsTotal,
            sample.SloGoalsMet,
            sample.SloGoalsTotal,
            sample.HeldSeconds);

    private static RankedPerformanceRecord Performance(
        RankedAttempt attempt,
        RankedPerformanceResult result,
        DateTime now) =>
        new()
        {
            AttemptId = attempt.Id,
            OwnerKey = attempt.OwnerKey,
            QualityScore = result.QualityScore,
            RatingScore = result.RatingScore,
            SloHealthScore = result.SloHealthScore,
            ObjectiveHealthScore = result.ObjectiveHealthScore,
            ActionScore = result.ActionScore,
            ContainmentScore = result.ContainmentScore,
            TargetedActions = result.TargetedActions,
            HarmfulActions = result.HarmfulActions,
            UnnecessaryActions = result.UnnecessaryActions,
            RedundantActions = result.RedundantActions,
            ConvergenceViolations = result.ConvergenceViolations,
            SampleCount = result.SampleCount,
            PeakP95LatencyMs = result.PeakP95LatencyMs,
            PeakErrorRatePct = result.PeakErrorRatePct,
            MinimumServedRatioPct = result.MinimumServedRatioPct,
            VerificationSeconds = result.VerificationSeconds,
            Band = result.Band,
            CreatedUtc = now,
        };

    private static RankedScenarioPlan? ReadPlan(RankedAttempt attempt)
    {
        if (attempt.Scenario is { PlanJson.Length: > 0 })
        {
            try
            {
                return JsonSerializer.Deserialize<RankedScenarioPlan>(attempt.Scenario.PlanJson);
            }
            catch (JsonException)
            {
                // The token remains a deterministic repair source if a stored receipt was damaged.
            }
        }
        return RankedScenarioCatalog.TryPlan(attempt.DrillId);
    }
}
