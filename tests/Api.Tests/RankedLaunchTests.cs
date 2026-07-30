using System.Globalization;
using IsaacWallace.Api.Data;
using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IsaacWallace.Api.Tests;

/// <summary>
/// Adversarial tests for the ranked launch.
///
/// The property under test throughout is the one the lifecycle exists for: nothing that could cost
/// an operator rating — a match clock, an attempt row, a rated outcome — comes into existence until
/// a real environment has been measured playable. Every test that ends before activation therefore
/// asserts the same three things: no clock, no attempt, no rating movement.
///
/// The cluster is faked because Crossplane cannot be staged in a unit test. The rated attempt is
/// NOT faked: it runs against a real <see cref="RankedStore"/> on a real database, because "exactly
/// one attempt" and "no rating impact" are claims about that store's transaction, and asserting
/// them against a stub would only prove the stub.
/// </summary>
public sealed class RankedLaunchTests
{
    private const string Owner = "0123456789abcdef0123456789abcdef";
    private const string Other = "fedcba9876543210fedcba9876543210";

    [Fact]
    public async Task AProvisioningClusterStartsNoClockAndOpensNoAttempt()
    {
        await using var arena = await FakeArena.CreateAsync();

        var result = await Launch(arena);

        var launch = Assert.IsType<RankedLaunchView>(result.Launch);
        Assert.Equal(200, result.Status);
        Assert.Equal(RankedLaunchPhases.Provisioning, launch.Phase);
        Assert.Equal(1, launch.Step);
        Assert.False(launch.ClockStarted);
        Assert.Equal(0, launch.MatchElapsedMs);
        Assert.Equal("", launch.AttemptId);
        Assert.NotEqual("", launch.LaunchId);
        await AssertNothingRated(arena);
    }

    [Fact]
    public async Task AProvisionedClusterWaitsForItsRequiredWorkloads()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkProvisioned();

        var launch = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.StartingWorkloads, launch.Phase);
        Assert.False(launch.ClockStarted);
        Assert.All(
            RankedLaunchGate.RequiredWorkloads,
            name => Assert.Contains(launch.Checks, check => check.Id == $"workload:{name}"));
        await AssertNothingRated(arena);
    }

    /// <summary>An arena is provisioned as a quiet sandbox. Starting the traffic is the launch's own
    /// job — and it happens entirely before the clock, so the operator is never timed on it.</summary>
    [Fact]
    public async Task AQuietArenaHasItsLoadGeneratorStartedBeforeAnythingIsMeasured()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkProvisioned();
        arena.MarkWorkloadsReady();

        var starting = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.StartingWorkloads, starting.Phase);
        Assert.Equal(1, arena.TrafficStarts);
        Assert.False(starting.ClockStarted);
        Assert.Equal(0, arena.Draws);

        // Once it is running the launch stops asking, and moves on to whether it can measure it.
        arena.MarkTelemetryFlowing();
        var verified = await LaunchView(arena);

        Assert.Equal(1, arena.TrafficStarts);
        Assert.Equal(RankedLaunchPhases.Active, verified.Phase);
    }

    [Fact]
    public async Task RunningWorkloadsWithNoUsableTelemetryDoNotStartAMatch()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkProvisioned();
        arena.MarkWorkloadsReady();
        await Launch(arena);

        var launch = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.VerifyingTelemetry, launch.Phase);
        Assert.False(launch.ClockStarted);
        Assert.Null(arena.ClockOf(Owner));
        Assert.Equal(0, arena.Draws);
        await AssertNothingRated(arena);
    }

    /// <summary>The regression this whole change is about: every phase before activation must leave
    /// spec.drillStartedAt unwritten, so no ranked second is charged for the platform's own work.
    /// </summary>
    [Fact]
    public async Task TheMatchClockIsNotWrittenUntilTheEnvironmentIsVerified()
    {
        await using var arena = await FakeArena.CreateAsync();

        await Launch(arena);
        Assert.Null(arena.ClockOf(Owner));

        arena.MarkProvisioned();
        await Launch(arena);
        Assert.Null(arena.ClockOf(Owner));

        arena.MarkWorkloadsReady();
        await Launch(arena);
        await Launch(arena);
        Assert.Null(arena.ClockOf(Owner));
        Assert.Equal(0, arena.Activations);
        await AssertNothingRated(arena);

        arena.MarkTelemetryFlowing();
        var live = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.Active, live.Phase);
        Assert.True(live.ClockStarted);
        Assert.NotNull(arena.ClockOf(Owner));
    }

    [Fact]
    public async Task ActivationStampsTheClockAndOpensExactlyOneAttempt()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();

        var launch = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.Active, launch.Phase);
        Assert.Equal(5, launch.Step);
        Assert.True(launch.Terminal);
        Assert.True(launch.Active);
        Assert.NotEqual("", launch.AttemptId);

        var attempt = Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
        Assert.Equal(RankedOutcomes.Active, attempt.Outcome);
        Assert.Equal(launch.AttemptId, attempt.Id);
        Assert.Equal(arena.RunIdOf(Owner), attempt.RunId);
        // The clock is the attempt's own start, so the recorded time and the stamped time cannot
        // disagree about when the match began.
        Assert.Equal(attempt.StartedUtc, arena.ClockOf(Owner));
        Assert.Equal(1, arena.Activations);
        Assert.Equal(1, arena.AttemptOpens);
        Assert.Equal(1, arena.Draws);
    }

    [Fact]
    public async Task RepeatedStartRequestsResumeOneLaunchRatherThanStackingUp()
    {
        await using var arena = await FakeArena.CreateAsync();

        var first = await LaunchView(arena);
        for (var i = 0; i < 4; i++) await Launch(arena);
        arena.MarkProvisioned();
        for (var i = 0; i < 4; i++) await Launch(arena);
        arena.MarkWorkloadsReady();
        for (var i = 0; i < 4; i++) await Launch(arena);
        arena.MarkTelemetryFlowing();
        var live = await LaunchView(arena);
        for (var i = 0; i < 4; i++) await Launch(arena);

        Assert.Equal(first.LaunchId, live.LaunchId);
        Assert.Equal(1, arena.Clusters);
        Assert.Equal(1, arena.Provisions);
        Assert.Equal(1, arena.Draws);
        Assert.Equal(1, arena.AttemptOpens);
        Assert.Equal(1, arena.Activations);
        Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
    }

    [Fact]
    public async Task ConcurrentStartRequestsActivateExactlyOnce()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();

        var results = await Task.WhenAll(
            Enumerable.Range(0, 8).Select(_ => Task.Run(() => Launch(arena))));

        Assert.All(results, result => Assert.Equal(200, result.Status));
        Assert.All(
            results,
            result => Assert.Equal(RankedLaunchPhases.Active, result.Launch!.Phase));
        Assert.Single(results.Select(result => result.Launch!.AttemptId).Distinct());
        Assert.Equal(1, arena.Clusters);
        Assert.Equal(1, arena.Provisions);
        Assert.Equal(1, arena.Activations);
        Assert.Equal(1, arena.AttemptOpens);
        Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
    }

    [Fact]
    public async Task ReloadingAnActiveMatchResumesItWithoutRestartingTheClock()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();
        var live = await LaunchView(arena);
        var stampedAt = arena.ClockOf(Owner);

        arena.Clock.Advance(TimeSpan.FromMinutes(3));
        var reloaded = await LaunchView(arena);
        var observed = await ObserveView(arena);

        Assert.Equal(stampedAt, arena.ClockOf(Owner));
        Assert.Equal(live.AttemptId, reloaded.AttemptId);
        Assert.Equal(live.AttemptId, observed.AttemptId);
        Assert.Equal(RankedLaunchPhases.Active, observed.Phase);
        Assert.True(reloaded.MatchElapsedMs >= 180_000);
        Assert.Equal(1, arena.Activations);
        Assert.Equal(1, arena.AttemptOpens);
        Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
    }

    /// <summary>Two replicas reaching the activation boundary together. The one whose write lands
    /// second must converge onto the live match rather than starting a second one.</summary>
    [Fact]
    public async Task AnActivationThatLosesItsRaceAdoptsTheLiveMatch()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();
        arena.BeforeActivate = activation =>
        {
            // Another replica committed the identical activation a moment earlier, which moves the
            // resourceVersion this caller verified and makes its own write a no-op.
            arena.ActivateOutOfBand(activation);
            return Task.FromResult(false);
        };

        var launch = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.Active, launch.Phase);
        Assert.True(launch.ClockStarted);
        Assert.Equal(0, arena.Activations);
        Assert.Equal(1, arena.AttemptOpens);
        Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
    }

    /// <summary>The store's one-attempt-per-operator guard firing between another replica's read
    /// and this one's write. The refusal is not an error: it names the winner, and this launch
    /// adopts it.</summary>
    [Fact]
    public async Task AnAttemptOpenedByAnotherReplicaIsAdoptedRatherThanDuplicated()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();
        string? winner = null;
        arena.BeforeOpenAttempt = async (runId, drillId) =>
        {
            winner = (await arena.OpenAttemptOutOfBandAsync(runId, drillId, Owner)).Id;
            return false;
        };

        var launch = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.Active, launch.Phase);
        Assert.Equal(winner, launch.AttemptId);
        Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
    }

    /// <summary>A launch that opened its attempt but never got the clock written is resumed onto
    /// that same attempt — not a fresh one, and not a fresh incident.</summary>
    [Fact]
    public async Task AnInterruptedActivationResumesOntoTheSameAttemptAndIncident()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();
        arena.BeforeActivate = _ => Task.FromResult(false);

        var stalled = await LaunchView(arena);
        Assert.NotEqual(RankedLaunchPhases.Active, stalled.Phase);
        Assert.Null(arena.ClockOf(Owner));
        var incident = arena.IncidentOf(Owner);
        var attemptId = arena.LaunchAttemptOf(Owner);
        Assert.NotEqual("", incident);
        Assert.NotEqual("", attemptId);

        arena.BeforeActivate = null;
        var live = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.Active, live.Phase);
        Assert.Equal(attemptId, live.AttemptId);
        Assert.Equal(incident, arena.IncidentOf(Owner));
        Assert.Equal(1, arena.Draws);
        Assert.Equal(1, arena.AttemptOpens);
        Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
    }

    [Fact]
    public async Task AnInfrastructureFailureBeforeActivationCostsNoRating()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        // The cluster never becomes ready; the launch outlives its provisioning budget.
        arena.Clock.Advance(RankedLaunchBudget.Default.Provisioning + TimeSpan.FromSeconds(1));

        var failed = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.Failed, failed.Phase);
        Assert.True(failed.Failed);
        Assert.True(failed.Retryable);
        Assert.False(failed.ClockStarted);
        Assert.NotEqual("", failed.FailureReason);
        Assert.Equal(0, arena.Draws);
        await AssertNothingRated(arena);
    }

    [Fact]
    public async Task ATelemetryFailureBeforeActivationCostsNoRating()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkProvisioned();
        arena.MarkWorkloadsReady();
        await Launch(arena);
        arena.Clock.Advance(
            RankedLaunchBudget.Default.DeadlineFor(RankedLaunchPhases.VerifyingTelemetry)
            + TimeSpan.FromSeconds(1));

        var failed = await LaunchView(arena);

        Assert.Equal(RankedLaunchPhases.Failed, failed.Phase);
        Assert.False(failed.ClockStarted);
        await AssertNothingRated(arena);
    }

    [Fact]
    public async Task CancellingBeforeActivationTearsDownAndRatesNothing()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkProvisioned();
        arena.MarkWorkloadsReady();
        await Launch(arena);

        var cancelled = await Abandon(arena);

        Assert.Equal(200, cancelled.Status);
        Assert.True(cancelled.Launch!.Failed);
        Assert.False(cancelled.Launch.ClockStarted);
        Assert.Equal(1, arena.Discards);
        Assert.Equal(0, arena.Clusters);
        await AssertNothingRated(arena);
    }

    /// <summary>Cancelling must not become a cheaper forfeit. Once the match is live it ends through
    /// the rated path or not at all.</summary>
    [Fact]
    public async Task ALiveMatchCannotBeCancelledThroughTheLaunch()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();
        var live = await LaunchView(arena);

        var refused = await Abandon(arena);

        Assert.Equal(409, refused.Status);
        Assert.Null(refused.Launch);
        Assert.Equal(0, arena.Discards);
        Assert.Equal(1, arena.Clusters);
        var attempt = Assert.Single(await arena.Db.RankedAttempts.ToListAsync());
        Assert.Equal(RankedOutcomes.Active, attempt.Outcome);
        Assert.Equal(live.AttemptId, attempt.Id);
        Assert.Empty(await arena.Db.RatingLedger.ToListAsync());
    }

    [Fact]
    public async Task RetryingAFailedProvisionReplacesTheCluster()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        var original = arena.RunIdOf(Owner);
        arena.Clock.Advance(RankedLaunchBudget.Default.Provisioning + TimeSpan.FromSeconds(1));
        await Launch(arena);

        var retried = await LaunchView(arena, retry: true);

        Assert.Equal(1, arena.Discards);
        Assert.Equal(2, arena.Provisions);
        Assert.NotEqual(original, retried.RunId);
        Assert.Equal(RankedLaunchPhases.Provisioning, retried.Phase);
        await AssertNothingRated(arena);
    }

    /// <summary>A cluster whose workloads are running is not the thing that failed, and rebuilding
    /// it would spend minutes reproducing what is already there.</summary>
    [Fact]
    public async Task RetryingAFailedTelemetryCheckKeepsTheProvisionedCluster()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkProvisioned();
        arena.MarkWorkloadsReady();
        await Launch(arena);
        var original = arena.RunIdOf(Owner);
        arena.Clock.Advance(
            RankedLaunchBudget.Default.DeadlineFor(RankedLaunchPhases.VerifyingTelemetry)
            + TimeSpan.FromSeconds(1));
        await Launch(arena);

        arena.MarkTelemetryFlowing();
        var retried = await LaunchView(arena, retry: true);

        Assert.Equal(0, arena.Discards);
        Assert.Equal(1, arena.Provisions);
        Assert.Equal(original, retried.RunId);
        Assert.Equal(RankedLaunchPhases.Active, retried.Phase);
    }

    [Fact]
    public async Task AnotherOwnerCanNeitherObserveNorResumeTheLaunch()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkProvisioned();
        arena.MarkWorkloadsReady();
        var mine = await LaunchView(arena);

        var peeked = await Orchestrator(arena).ObserveAsync(Other, CancellationToken.None);
        var cancelled = await Orchestrator(arena)
            .AbandonAsync(Other, "Mallory", CancellationToken.None);
        var theirs = await Orchestrator(arena)
            .LaunchAsync(Other, "Mallory", retry: false, CancellationToken.None);

        Assert.Equal(404, peeked.Status);
        Assert.Null(peeked.Launch);
        Assert.Equal(404, cancelled.Status);
        Assert.Equal(0, arena.Discards);

        // A second operator gets a second cluster and a second launch. Nothing about the first one
        // is readable from it, and the first one is untouched.
        Assert.NotEqual(mine.RunId, theirs.Launch!.RunId);
        Assert.NotEqual(mine.LaunchId, theirs.Launch.LaunchId);
        Assert.Equal(2, arena.Clusters);

        var still = await ObserveView(arena);
        Assert.Equal(mine.LaunchId, still.LaunchId);
        Assert.Equal(mine.RunId, still.RunId);
    }

    [Fact]
    public async Task ObservingDoesNotAdvanceTheLaunch()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkPlayable();

        var observed = await ObserveView(arena);

        Assert.Equal(RankedLaunchPhases.ActivatingIncident, observed.Phase);
        Assert.False(observed.ClockStarted);
        Assert.Equal(0, arena.Draws);
        Assert.Equal(0, arena.Activations);
        await AssertNothingRated(arena);
    }

    [Fact]
    public async Task NoCapacityIsReportedAsTheBrokersOwnRefusalRatherThanALaunch()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.RefuseProvisioning(429, "No cluster slots are free. Try again shortly.");

        var result = await Launch(arena);

        Assert.Equal(429, result.Status);
        Assert.Null(result.Launch);
        Assert.Equal(0, arena.Clusters);
        await AssertNothingRated(arena);
    }

    /// <summary>The cancel button tears down a cluster, so it must only ever reach a cluster a
    /// ranked launch actually owns — never somebody's practice sandbox.</summary>
    [Fact]
    public async Task CancellingDoesNotTearDownAClusterThatHasNoRankedLaunch()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();
        arena.ProvisionSandboxFor(Owner);

        var refused = await Abandon(arena);

        Assert.Equal(404, refused.Status);
        Assert.Equal(0, arena.Discards);
        Assert.Equal(1, arena.Clusters);
    }

    /// <summary>A practice incident is a different lifecycle on the same cluster. Ranked neither
    /// replaces it nor deletes what it is running on.</summary>
    [Fact]
    public async Task APracticeIncidentBlocksARankedLaunchInsteadOfBeingReplaced()
    {
        await using var arena = await FakeArena.CreateAsync();
        arena.MarkPlayable();
        arena.ProvisionSandboxFor(Owner);
        arena.StartPracticeDrill(Owner);

        var refused = await Launch(arena);
        var cancelled = await Abandon(arena);

        Assert.Equal(409, refused.Status);
        Assert.Equal(404, cancelled.Status);
        Assert.Equal(0, arena.Discards);
        // The practice drill is still exactly what it was, on the cluster it was running on.
        Assert.Equal("practice", arena.DrillModeOf(Owner));
        Assert.Equal("", arena.IncidentOf(Owner));
        Assert.Equal(0, arena.Draws);
        await AssertNothingRated(arena);
    }

    /// <summary>A cluster torn down under a launch is not something to activate onto. The launch
    /// refuses rather than racing the teardown, and the caller retries into a fresh one.</summary>
    [Fact]
    public async Task ALaunchOntoAClusterBeingTornDownIsRefused()
    {
        await using var arena = await FakeArena.CreateAsync();
        await Launch(arena);
        arena.MarkDeleting();

        var refused = await Launch(arena);

        Assert.Equal(409, refused.Status);
        Assert.Null(refused.Launch);
        Assert.Null(arena.ClockOf(Owner));
        await AssertNothingRated(arena);
    }

    /// <summary>The old entry point started the clock the moment it was called. It is now closed,
    /// and closed before anything reaches the cluster.</summary>
    [Fact]
    public async Task TheLegacyDrillEndpointRefusesRankedMode()
    {
        // Every collaborator is absent on purpose: refusing ranked mode must happen before the
        // broker reads a run, draws an incident, or opens an attempt, so a broker that cannot do
        // any of those things still answers correctly.
        var broker = new RunBroker(
            null!,
            Microsoft.Extensions.Options.Options.Create(new RunBrokerOptions()),
            null!,
            null!,
            null!,
            null!,
            null!,
            null!,
            NullLogger<RunBroker>.Instance);

        var result = await broker.StartDrillAsync(
            "run-hl-abcdef", "", "ranked", "", Owner, CancellationToken.None);

        Assert.Equal(409, result.Status);
        Assert.Null(result.Run);
        Assert.Contains("/v1/ranked/launch", result.Error!, StringComparison.Ordinal);
    }

    // ── harness ──────────────────────────────────────────────────────────────────────────────

    private static RankedLaunchOrchestrator Orchestrator(FakeArena arena) =>
        new(arena, RankedLaunchBudget.Default, arena.Clock, NullLogger.Instance);

    private static Task<RankedLaunchResult> Launch(FakeArena arena, bool retry = false) =>
        Orchestrator(arena).LaunchAsync(Owner, "Ada", retry, CancellationToken.None);

    private static Task<RankedLaunchResult> Abandon(FakeArena arena) =>
        Orchestrator(arena).AbandonAsync(Owner, "Ada", CancellationToken.None);

    private static async Task<RankedLaunchView> LaunchView(FakeArena arena, bool retry = false)
    {
        var result = await Launch(arena, retry);
        Assert.Null(result.Error);
        return Assert.IsType<RankedLaunchView>(result.Launch);
    }

    private static async Task<RankedLaunchView> ObserveView(FakeArena arena)
    {
        var result = await Orchestrator(arena).ObserveAsync(Owner, CancellationToken.None);
        Assert.Null(result.Error);
        return Assert.IsType<RankedLaunchView>(result.Launch);
    }

    /// <summary>The assertion every pre-activation test ends on: the operator's rating record is
    /// exactly as it was before they pressed the button.</summary>
    private static async Task AssertNothingRated(FakeArena arena)
    {
        Assert.Empty(await arena.Db.RankedAttempts
            .Where(attempt => attempt.Outcome != RankedOutcomes.Void)
            .ToListAsync());
        Assert.Empty(await arena.Db.RatingLedger.ToListAsync());
        Assert.Empty(await arena.Db.OperatorRatings.ToListAsync());
        Assert.Empty(await arena.Db.RankedPerformance.ToListAsync());
    }

    private sealed class TestClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    /// <summary>
    /// An in-memory disposable cluster with a real rated-attempt store behind it.
    ///
    /// The cluster carries a version counter and honours it, because compare-and-set is the
    /// mechanism the launch relies on to survive two replicas — a fake that ignored the version
    /// would quietly pass tests the real thing would fail.
    /// </summary>
    private sealed class FakeArena : IRankedLaunchEnvironment, IAsyncDisposable
    {
        private readonly SqliteConnection _connection;
        private readonly RankedStore _store;
        private readonly SemaphoreSlim _storeGate = new(1, 1);
        private readonly Lock _sync = new();
        private readonly Dictionary<string, Node> _nodes = new(StringComparer.Ordinal);
        private int _runSequence;

        private FakeArena(SqliteConnection connection, HomeOpsDbContext db, RankedStore store)
        {
            _connection = connection;
            Db = db;
            _store = store;
        }

        public HomeOpsDbContext Db { get; }

        public TestClock Clock { get; } =
            new(new DateTimeOffset(2026, 7, 30, 12, 0, 0, TimeSpan.Zero));

        // What the substrate looks like right now; the tests drive it.
        public IReadOnlyList<RankedLaunchWorkload> Workloads { get; private set; } = [];
        public int SampledPods { get; private set; }
        public bool GatewayReporting { get; private set; }
        public int ServedRequestsPerSec { get; private set; }

        // Counters that turn "exactly once" into an assertion.
        public int Provisions { get; private set; }
        public int Draws { get; private set; }
        public int Activations { get; private set; }
        public int AttemptOpens { get; private set; }
        public int Discards { get; private set; }
        public int TrafficStarts { get; private set; }
        public int Clusters { get { lock (_sync) return _nodes.Count; } }

        // Races a single process cannot stage on its own.
        public Func<RankedLaunchActivation, Task<bool>>? BeforeActivate { get; set; }
        public Func<string, string, Task<bool>>? BeforeOpenAttempt { get; set; }

        private int _provisionStatus = 201;
        private string? _provisionError;

        public static async Task<FakeArena> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var db = new HomeOpsDbContext(
                new DbContextOptionsBuilder<HomeOpsDbContext>().UseSqlite(connection).Options);
            await db.EnsureSchemaAsync();
            return new FakeArena(
                connection, db, new RankedStore(db, NullLogger<RankedStore>.Instance));
        }

        public void RefuseProvisioning(int status, string error)
        {
            _provisionStatus = status;
            _provisionError = error;
        }

        // Platform-level state, so a cluster provisioned after the test set it comes up the same way
        // one provisioned before it did.
        private bool _provisioned;
        private bool _deleting;

        public void MarkProvisioned() => _provisioned = true;

        /// <summary>Every required tier is present. The load generator comes up scaled to nothing,
        /// exactly as the open sandbox provisions it, so the launch has to start it.</summary>
        public void MarkWorkloadsReady() =>
            Workloads = RankedLaunchGate.RequiredWorkloads
                .Select(name => name == RankedLaunchGate.TrafficWorkload
                    ? new RankedLaunchWorkload(name, 0, 0)
                    : new RankedLaunchWorkload(name, 1, 1))
                .ToArray();

        public void MarkTelemetryFlowing()
        {
            SampledPods = 6;
            GatewayReporting = true;
            ServedRequestsPerSec = 400;
        }

        /// <summary>The load generator, once something has scaled it up.</summary>
        private void RunTraffic() =>
            Workloads = Workloads
                .Select(workload => workload.Name == RankedLaunchGate.TrafficWorkload
                    ? new RankedLaunchWorkload(workload.Name, 1, 1)
                    : workload)
                .ToArray();

        public void MarkDeleting() => _deleting = true;

        /// <summary>An arena that is already serving — the state a launch has to reach before it may
        /// activate, and the state a reused cluster is already in.</summary>
        public void MarkPlayable()
        {
            MarkProvisioned();
            MarkWorkloadsReady();
            RunTraffic();
            MarkTelemetryFlowing();
        }

        /// <summary>A cluster the operator provisioned through the run endpoints, with no ranked
        /// launch anywhere near it.</summary>
        public void ProvisionSandboxFor(string owner)
        {
            lock (_sync)
            {
                var node = new Node { RunId = $"run-hl-{++_runSequence:x8}", Owner = owner };
                _nodes[node.RunId] = node;
            }
        }

        /// <summary>A practice drill running on that sandbox.</summary>
        public void StartPracticeDrill(string owner)
        {
            lock (_sync)
            {
                var node = _nodes.Values.First(candidate =>
                    string.Equals(candidate.Owner, owner, StringComparison.Ordinal));
                node.DrillId = "checkout-traffic-spike";
                node.DrillMode = "practice";
                node.ClockStartedAt = Clock.GetUtcNow().UtcDateTime;
                node.Version++;
            }
        }

        public string RunIdOf(string owner) => Owned(owner)?.RunId ?? "";

        public DateTime? ClockOf(string owner) => Owned(owner)?.ClockStartedAt;

        public string DrillModeOf(string owner) => Owned(owner)?.DrillMode ?? "";

        public string IncidentOf(string owner) =>
            Annotation(Owned(owner), RankedLaunchOrchestrator.LaunchIncidentAnnotation);

        public string LaunchAttemptOf(string owner) =>
            Annotation(Owned(owner), RankedLaunchOrchestrator.LaunchAttemptAnnotation);

        /// <summary>Commit an activation as if a different replica had done it.</summary>
        public void ActivateOutOfBand(RankedLaunchActivation activation)
        {
            lock (_sync)
            {
                if (!_nodes.TryGetValue(activation.RunId, out var node)) return;
                node.DrillId = activation.DrillId;
                node.DrillMode = "ranked";
                node.ClockStartedAt = activation.ActivatedUtc;
                node.Annotations[RankedLaunchOrchestrator.LaunchAttemptAnnotation] =
                    activation.AttemptId;
                node.Annotations[RankedLaunchOrchestrator.LaunchPhaseAnnotation] =
                    RankedLaunchPhases.Active;
                node.Version++;
            }
        }

        /// <summary>Open an attempt as if a different replica had won the race for it.</summary>
        public async Task<RankedAttemptView> OpenAttemptOutOfBandAsync(
            string runId, string drillId, string owner)
        {
            await _storeGate.WaitAsync();
            try
            {
                return await _store.BeginAsync(
                    runId,
                    drillId,
                    owner,
                    "Ada",
                    Clock.GetUtcNow().UtcDateTime,
                    CancellationToken.None);
            }
            finally
            {
                _storeGate.Release();
            }
        }

        // ── IRankedLaunchEnvironment ─────────────────────────────────────────────────────────

        public Task<RankedLaunchCluster?> FindClusterAsync(string owner, CancellationToken ct)
        {
            lock (_sync)
            {
                var node = Owned(owner);
                return Task.FromResult(node is null ? null : Snapshot(node));
            }
        }

        public Task<RankedLaunchCluster?> ReadClusterAsync(
            string runId, string owner, CancellationToken ct)
        {
            lock (_sync)
            {
                var found = _nodes.TryGetValue(runId, out var node) &&
                    string.Equals(node!.Owner, owner, StringComparison.Ordinal)
                    ? node
                    : null;
                return Task.FromResult(found is null ? null : Snapshot(found));
            }
        }

        public Task<RankedLaunchProvision> ProvisionClusterAsync(
            string owner, CancellationToken ct)
        {
            lock (_sync)
            {
                var existing = Owned(owner);
                if (existing is not null)
                    return Task.FromResult(
                        new RankedLaunchProvision(Snapshot(existing), 200, null));
                if (_provisionError is not null)
                    return Task.FromResult(
                        new RankedLaunchProvision(null, _provisionStatus, _provisionError));

                Provisions++;
                var node = new Node
                {
                    RunId = $"run-hl-{++_runSequence:x8}",
                    Owner = owner,
                };
                _nodes[node.RunId] = node;
                return Task.FromResult(new RankedLaunchProvision(Snapshot(node), 201, null));
            }
        }

        public Task<RankedLaunchReadiness> ReadReadinessAsync(
            RankedLaunchCluster cluster, CancellationToken ct) =>
            Task.FromResult(new RankedLaunchReadiness(
                Workloads, SampledPods, GatewayReporting, ServedRequestsPerSec, 400));

        public Task<RankedLaunchCluster?> AnnotateAsync(
            string runId,
            string owner,
            string expectedVersion,
            IReadOnlyDictionary<string, string?> annotations,
            CancellationToken ct)
        {
            lock (_sync)
            {
                if (!_nodes.TryGetValue(runId, out var node) ||
                    !string.Equals(node.Owner, owner, StringComparison.Ordinal) ||
                    !string.Equals(node.Version.ToString(CultureInfo.InvariantCulture),
                        expectedVersion, StringComparison.Ordinal))
                    return Task.FromResult<RankedLaunchCluster?>(null);

                foreach (var (key, value) in annotations)
                {
                    if (value is null) node.Annotations.Remove(key);
                    else node.Annotations[key] = value;
                }
                node.Version++;
                return Task.FromResult<RankedLaunchCluster?>(Snapshot(node));
            }
        }

        public Task<RankedLaunchCluster?> StartTrafficAsync(
            string runId, string owner, string expectedVersion, CancellationToken ct)
        {
            lock (_sync)
            {
                if (!_nodes.TryGetValue(runId, out var node) ||
                    !string.Equals(node.Owner, owner, StringComparison.Ordinal) ||
                    !string.Equals(node.Version.ToString(CultureInfo.InvariantCulture),
                        expectedVersion, StringComparison.Ordinal))
                    return Task.FromResult<RankedLaunchCluster?>(null);

                TrafficStarts++;
                RunTraffic();
                node.Version++;
                return Task.FromResult<RankedLaunchCluster?>(Snapshot(node));
            }
        }

        public async Task<RankedLaunchCluster?> ActivateAsync(
            RankedLaunchActivation activation, CancellationToken ct)
        {
            if (BeforeActivate is { } hook && !await hook(activation)) return null;

            lock (_sync)
            {
                if (!_nodes.TryGetValue(activation.RunId, out var node) ||
                    !string.Equals(node.Owner, activation.Owner, StringComparison.Ordinal) ||
                    !string.Equals(node.Version.ToString(CultureInfo.InvariantCulture),
                        activation.ExpectedVersion, StringComparison.Ordinal))
                    return null;

                Activations++;
                node.DrillId = activation.DrillId;
                node.DrillMode = "ranked";
                node.ClockStartedAt = activation.ActivatedUtc;
                node.Annotations[RankedLaunchOrchestrator.LaunchAttemptAnnotation] =
                    activation.AttemptId;
                node.Annotations[RankedLaunchOrchestrator.LaunchPhaseAnnotation] =
                    RankedLaunchPhases.Active;
                node.Version++;
                return Snapshot(node);
            }
        }

        public Task<bool> DiscardClusterAsync(string runId, string owner, CancellationToken ct)
        {
            lock (_sync)
            {
                if (!_nodes.TryGetValue(runId, out var node) ||
                    !string.Equals(node.Owner, owner, StringComparison.Ordinal))
                    return Task.FromResult(false);
                Discards++;
                _nodes.Remove(runId);
                return Task.FromResult(true);
            }
        }

        public Task<RankedDraw?> DrawIncidentAsync(string owner, CancellationToken ct)
        {
            lock (_sync) Draws++;
            for (var attempt = 0; attempt < 8; attempt++)
            {
                try
                {
                    var plan = RankedScenarioGenerator.Generate(
                        RankedScenarioGenerator.NewSeed(RankedRules.InitialRating));
                    return Task.FromResult<RankedDraw?>(new RankedDraw(plan, 1, false));
                }
                catch (ArgumentException)
                {
                    // A seed that parses but does not generate is not a match; draw again.
                }
            }
            return Task.FromResult<RankedDraw?>(null);
        }

        public Task<RankedAttemptView?> ReadAttemptAsync(
            string attemptId, string owner, CancellationToken ct) =>
            Guarded(() => _store.GetAttemptAsync(attemptId, owner, ct));

        public Task<RankedAttemptView?> ActiveAttemptAsync(string owner, CancellationToken ct) =>
            Guarded(() => _store.ActiveForOwnerAsync(owner, ct));

        public async Task<RankedAttemptView?> OpenAttemptAsync(
            string runId,
            string drillId,
            string owner,
            string displayName,
            DateTime startedUtc,
            CancellationToken ct)
        {
            if (BeforeOpenAttempt is { } hook && !await hook(runId, drillId)) return null;

            await _storeGate.WaitAsync(ct);
            try
            {
                lock (_sync) AttemptOpens++;
                return await _store.BeginAsync(
                    runId, drillId, owner, displayName, startedUtc, ct);
            }
            catch (InvalidOperationException)
            {
                // The store's own active-attempt guard. Null names the refusal, not a fault.
                return null;
            }
            finally
            {
                _storeGate.Release();
            }
        }

        public async Task VoidAttemptAsync(
            string attemptId, string owner, string displayName, CancellationToken ct) =>
            await Guarded(() => _store.FinalizeAsync(
                attemptId, owner, RankedOutcomes.Void, 0, 0, "", displayName, ct));

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            await _connection.DisposeAsync();
        }

        // ── internals ────────────────────────────────────────────────────────────────────────

        /// <summary>One EF context is not thread-safe; the real service resolves a scoped one per
        /// request. Serializing here keeps the fake honest about the store's own guarantees while
        /// letting the concurrency tests use real threads for everything else.</summary>
        private async Task<T> Guarded<T>(Func<Task<T>> work)
        {
            await _storeGate.WaitAsync();
            try
            {
                return await work();
            }
            finally
            {
                _storeGate.Release();
            }
        }

        private Node? Owned(string owner)
        {
            lock (_sync)
                return _nodes.Values.FirstOrDefault(node =>
                    string.Equals(node.Owner, owner, StringComparison.Ordinal));
        }

        private RankedLaunchCluster Snapshot(Node node) =>
            new(
                node.RunId,
                node.Version.ToString(CultureInfo.InvariantCulture),
                node.Owner,
                Reconciled: true,
                Provisioned: _provisioned,
                NamespaceAssigned: _provisioned,
                Deleting: _deleting,
                Annotation(node, RankedLaunchOrchestrator.LaunchIdAnnotation),
                ParseTime(Annotation(node, RankedLaunchOrchestrator.LaunchStartedAnnotation)),
                Annotation(node, RankedLaunchOrchestrator.LaunchPhaseAnnotation),
                Annotation(node, RankedLaunchOrchestrator.LaunchFailureAnnotation),
                Annotation(node, RankedLaunchOrchestrator.LaunchFailurePhaseAnnotation),
                Annotation(node, RankedLaunchOrchestrator.LaunchIncidentAnnotation),
                Annotation(node, RankedLaunchOrchestrator.LaunchAttemptAnnotation),
                node.ClockStartedAt is not null,
                node.DrillId,
                node.DrillMode,
                node.ClockStartedAt is null
                    ? 0
                    : (long)Math.Max(
                        0,
                        (Clock.GetUtcNow().UtcDateTime - node.ClockStartedAt.Value)
                            .TotalMilliseconds));

        private static string Annotation(Node? node, string key) =>
            node?.Annotations.GetValueOrDefault(key) ?? "";

        private static DateTime? ParseTime(string value) =>
            value.Length > 0 &&
            DateTime.TryParse(
                value,
                null,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var parsed)
                ? parsed
                : null;

        private sealed class Node
        {
            public string RunId = "";
            public string Owner = "";
            public long Version = 1;
            public Dictionary<string, string> Annotations { get; } = new(StringComparer.Ordinal);
            public string DrillId = "";
            public string DrillMode = "";
            public DateTime? ClockStartedAt;
        }
    }
}
