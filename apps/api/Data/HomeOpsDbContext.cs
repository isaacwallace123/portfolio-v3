using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Api.Data;

// The api's own store. Identity lives in the auth service; this holds what the HomeOps arena
// produces — drill results, and the averages and leaderboards computed from them.
public sealed class HomeOpsDbContext(DbContextOptions<HomeOpsDbContext> options) : DbContext(options)
{
    public DbSet<DrillResult> DrillResults => Set<DrillResult>();
    public DbSet<RankedAttempt> RankedAttempts => Set<RankedAttempt>();
    public DbSet<OperatorRating> OperatorRatings => Set<OperatorRating>();
    public DbSet<RatingLedgerEntry> RatingLedger => Set<RatingLedgerEntry>();
    public DbSet<RankedActionEntry> RankedActions => Set<RankedActionEntry>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<DrillResult>(e =>
        {
            e.Property(r => r.Id).HasMaxLength(64);
            e.Property(r => r.RunId).HasMaxLength(64);
            e.Property(r => r.DrillId).HasMaxLength(64);
            e.Property(r => r.Mode).HasMaxLength(16);
            e.Property(r => r.OwnerKey).HasMaxLength(64);
            e.Property(r => r.DisplayName).HasMaxLength(128);
            // Solving is judged on every poll by every api replica, so two of them can conclude
            // "solved" from the same measurement before either has written the annotation that
            // stops the other. The attempt — this cluster, this drill, this start time — is the
            // thing that must appear once, and the database is the only place that can promise it.
            e.HasIndex(r => new { r.RunId, r.DrillId, r.StartedUtc }).IsUnique();
            e.HasIndex(r => r.DrillId);
            e.HasIndex(r => r.OwnerKey);
            // The leaderboard reads ranked rows for a set of drills; the stats endpoint groups by
            // drill. Both start with this pair, so one composite index serves the two hot reads.
            e.HasIndex(r => new { r.Mode, r.DrillId });
        });

        builder.Entity<RankedAttempt>(e =>
        {
            e.ToTable("RankedAttempts");
            e.Property(a => a.Id).HasMaxLength(64);
            e.Property(a => a.RunId).HasMaxLength(64);
            e.Property(a => a.DrillId).HasMaxLength(64);
            e.Property(a => a.OwnerKey).HasMaxLength(64);
            e.Property(a => a.DisplayName).HasMaxLength(128);
            e.Property(a => a.Outcome).HasMaxLength(24);
            e.Property(a => a.FailedMove).HasMaxLength(64);
            e.HasIndex(a => new { a.RunId, a.StartedUtc }).IsUnique();
            e.HasIndex(a => new { a.OwnerKey, a.Outcome });
            e.HasIndex(a => new { a.DrillId, a.Outcome });
            // The application checks before inserting for a friendly message; this partial unique
            // index is the authority when two API replicas receive the same start concurrently.
            e.HasIndex(a => a.OwnerKey)
                .IsUnique()
                .HasFilter("\"Outcome\" = 'active'");
        });

        builder.Entity<OperatorRating>(e =>
        {
            e.ToTable("OperatorRatings");
            e.HasKey(r => r.OwnerKey);
            e.Property(r => r.OwnerKey).HasMaxLength(64);
            e.Property(r => r.DisplayName).HasMaxLength(128);
            e.HasIndex(r => r.Rating);
        });

        builder.Entity<RatingLedgerEntry>(e =>
        {
            e.ToTable("RatingLedger");
            e.Property(r => r.Id).HasMaxLength(64);
            e.Property(r => r.AttemptId).HasMaxLength(64);
            e.Property(r => r.OwnerKey).HasMaxLength(64);
            e.Property(r => r.Outcome).HasMaxLength(24);
            e.HasIndex(r => r.AttemptId).IsUnique();
            e.HasIndex(r => r.OwnerKey);
        });

        builder.Entity<RankedActionEntry>(e =>
        {
            e.ToTable("RankedActions");
            e.Property(a => a.Id).HasMaxLength(64);
            e.Property(a => a.AttemptId).HasMaxLength(64);
            e.Property(a => a.RunId).HasMaxLength(64);
            e.Property(a => a.OwnerKey).HasMaxLength(64);
            e.Property(a => a.Command).HasMaxLength(128);
            e.Property(a => a.ActionId).HasMaxLength(64);
            e.HasIndex(a => new { a.AttemptId, a.AcceptedUtc });
            e.HasIndex(a => a.OwnerKey);
        });
    }

    /// <summary>Schema creation, idempotent on both providers.
    ///
    /// EnsureCreated only builds a schema for an EMPTY database and this one already holds the auth
    /// service's tables, so it would never create this one. Raw DDL with IF NOT EXISTS is how the
    /// rest of the network does it (see apps/auth/Program.cs) and it stays honest about the fact
    /// that there is no migration pipeline here yet.</summary>
    public async Task EnsureSchemaAsync(CancellationToken ct = default)
    {
        var isNpgsql = Database.ProviderName?
            .Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true;

        await Database.ExecuteSqlRawAsync(isNpgsql
            ? """
              CREATE TABLE IF NOT EXISTS "DrillResults" (
                  "Id" character varying(64) NOT NULL CONSTRAINT "PK_DrillResults" PRIMARY KEY,
                  "RunId" character varying(64) NOT NULL,
                  "DrillId" character varying(64) NOT NULL,
                  "Mode" character varying(16) NOT NULL,
                  "OwnerKey" character varying(64) NOT NULL,
                  "DisplayName" character varying(128) NOT NULL,
                  "StageCount" integer NOT NULL,
                  "ElapsedMs" bigint NOT NULL,
                  "Missteps" integer NOT NULL,
                  "CorrectChosen" integer NOT NULL,
                  "CorrectTotal" integer NOT NULL,
                  "StartedUtc" timestamp with time zone NOT NULL,
                  "CompletedUtc" timestamp with time zone NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_DrillResults_Attempt"
                  ON "DrillResults" ("RunId", "DrillId", "StartedUtc");
              CREATE INDEX IF NOT EXISTS "IX_DrillResults_DrillId" ON "DrillResults" ("DrillId");
              CREATE INDEX IF NOT EXISTS "IX_DrillResults_OwnerKey" ON "DrillResults" ("OwnerKey");
              CREATE INDEX IF NOT EXISTS "IX_DrillResults_Mode_DrillId" ON "DrillResults" ("Mode", "DrillId");

              CREATE TABLE IF NOT EXISTS "RankedAttempts" (
                  "Id" character varying(64) NOT NULL CONSTRAINT "PK_RankedAttempts" PRIMARY KEY,
                  "RunId" character varying(64) NOT NULL,
                  "DrillId" character varying(64) NOT NULL,
                  "ScenarioVersion" integer NOT NULL,
                  "ScenarioRating" integer NOT NULL,
                  "OwnerKey" character varying(64) NOT NULL,
                  "DisplayName" character varying(128) NOT NULL,
                  "Outcome" character varying(24) NOT NULL,
                  "StartedUtc" timestamp with time zone NOT NULL,
                  "CompletedUtc" timestamp with time zone NULL,
                  "ElapsedMs" bigint NOT NULL,
                  "StageReached" integer NOT NULL,
                  "FailedMove" character varying(64) NOT NULL,
                  "PreRating" integer NOT NULL,
                  "ExpectedScore" double precision NOT NULL,
                  "RatingDelta" integer NOT NULL,
                  "PostRating" integer NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_RankedAttempts_Run_Started"
                  ON "RankedAttempts" ("RunId", "StartedUtc");
              CREATE INDEX IF NOT EXISTS "IX_RankedAttempts_Owner_Outcome"
                  ON "RankedAttempts" ("OwnerKey", "Outcome");
              CREATE INDEX IF NOT EXISTS "IX_RankedAttempts_Drill_Outcome"
                  ON "RankedAttempts" ("DrillId", "Outcome");
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_RankedAttempts_OneActiveOwner"
                  ON "RankedAttempts" ("OwnerKey") WHERE "Outcome" = 'active';

              CREATE TABLE IF NOT EXISTS "OperatorRatings" (
                  "OwnerKey" character varying(64) NOT NULL CONSTRAINT "PK_OperatorRatings" PRIMARY KEY,
                  "DisplayName" character varying(128) NOT NULL,
                  "Rating" integer NOT NULL,
                  "PeakRating" integer NOT NULL,
                  "GamesPlayed" integer NOT NULL,
                  "Wins" integer NOT NULL,
                  "Losses" integer NOT NULL,
                  "CurrentStreak" integer NOT NULL,
                  "BestStreak" integer NOT NULL,
                  "UpdatedUtc" timestamp with time zone NOT NULL
              );
              CREATE INDEX IF NOT EXISTS "IX_OperatorRatings_Rating" ON "OperatorRatings" ("Rating");

              CREATE TABLE IF NOT EXISTS "RatingLedger" (
                  "Id" character varying(64) NOT NULL CONSTRAINT "PK_RatingLedger" PRIMARY KEY,
                  "AttemptId" character varying(64) NOT NULL,
                  "OwnerKey" character varying(64) NOT NULL,
                  "Outcome" character varying(24) NOT NULL,
                  "BeforeRating" integer NOT NULL,
                  "Delta" integer NOT NULL,
                  "AfterRating" integer NOT NULL,
                  "CreatedUtc" timestamp with time zone NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_RatingLedger_AttemptId"
                  ON "RatingLedger" ("AttemptId");
              CREATE INDEX IF NOT EXISTS "IX_RatingLedger_OwnerKey" ON "RatingLedger" ("OwnerKey");

              CREATE TABLE IF NOT EXISTS "RankedActions" (
                  "Id" character varying(64) NOT NULL CONSTRAINT "PK_RankedActions" PRIMARY KEY,
                  "AttemptId" character varying(64) NOT NULL,
                  "RunId" character varying(64) NOT NULL,
                  "OwnerKey" character varying(64) NOT NULL,
                  "Command" character varying(128) NOT NULL,
                  "ActionId" character varying(64) NOT NULL,
                  "Stage" integer NOT NULL,
                  "AcceptedUtc" timestamp with time zone NOT NULL
              );
              CREATE INDEX IF NOT EXISTS "IX_RankedActions_Attempt_Accepted"
                  ON "RankedActions" ("AttemptId", "AcceptedUtc");
              CREATE INDEX IF NOT EXISTS "IX_RankedActions_OwnerKey"
                  ON "RankedActions" ("OwnerKey");
              """
            : """
              CREATE TABLE IF NOT EXISTS "DrillResults" (
                  "Id" TEXT NOT NULL CONSTRAINT "PK_DrillResults" PRIMARY KEY,
                  "RunId" TEXT NOT NULL,
                  "DrillId" TEXT NOT NULL,
                  "Mode" TEXT NOT NULL,
                  "OwnerKey" TEXT NOT NULL,
                  "DisplayName" TEXT NOT NULL,
                  "StageCount" INTEGER NOT NULL,
                  "ElapsedMs" INTEGER NOT NULL,
                  "Missteps" INTEGER NOT NULL,
                  "CorrectChosen" INTEGER NOT NULL,
                  "CorrectTotal" INTEGER NOT NULL,
                  "StartedUtc" TEXT NOT NULL,
                  "CompletedUtc" TEXT NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_DrillResults_Attempt"
                  ON "DrillResults" ("RunId", "DrillId", "StartedUtc");
              CREATE INDEX IF NOT EXISTS "IX_DrillResults_DrillId" ON "DrillResults" ("DrillId");
              CREATE INDEX IF NOT EXISTS "IX_DrillResults_OwnerKey" ON "DrillResults" ("OwnerKey");
              CREATE INDEX IF NOT EXISTS "IX_DrillResults_Mode_DrillId" ON "DrillResults" ("Mode", "DrillId");

              CREATE TABLE IF NOT EXISTS "RankedAttempts" (
                  "Id" TEXT NOT NULL CONSTRAINT "PK_RankedAttempts" PRIMARY KEY,
                  "RunId" TEXT NOT NULL,
                  "DrillId" TEXT NOT NULL,
                  "ScenarioVersion" INTEGER NOT NULL,
                  "ScenarioRating" INTEGER NOT NULL,
                  "OwnerKey" TEXT NOT NULL,
                  "DisplayName" TEXT NOT NULL,
                  "Outcome" TEXT NOT NULL,
                  "StartedUtc" TEXT NOT NULL,
                  "CompletedUtc" TEXT NULL,
                  "ElapsedMs" INTEGER NOT NULL,
                  "StageReached" INTEGER NOT NULL,
                  "FailedMove" TEXT NOT NULL,
                  "PreRating" INTEGER NOT NULL,
                  "ExpectedScore" REAL NOT NULL,
                  "RatingDelta" INTEGER NOT NULL,
                  "PostRating" INTEGER NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_RankedAttempts_Run_Started"
                  ON "RankedAttempts" ("RunId", "StartedUtc");
              CREATE INDEX IF NOT EXISTS "IX_RankedAttempts_Owner_Outcome"
                  ON "RankedAttempts" ("OwnerKey", "Outcome");
              CREATE INDEX IF NOT EXISTS "IX_RankedAttempts_Drill_Outcome"
                  ON "RankedAttempts" ("DrillId", "Outcome");
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_RankedAttempts_OneActiveOwner"
                  ON "RankedAttempts" ("OwnerKey") WHERE "Outcome" = 'active';

              CREATE TABLE IF NOT EXISTS "OperatorRatings" (
                  "OwnerKey" TEXT NOT NULL CONSTRAINT "PK_OperatorRatings" PRIMARY KEY,
                  "DisplayName" TEXT NOT NULL,
                  "Rating" INTEGER NOT NULL,
                  "PeakRating" INTEGER NOT NULL,
                  "GamesPlayed" INTEGER NOT NULL,
                  "Wins" INTEGER NOT NULL,
                  "Losses" INTEGER NOT NULL,
                  "CurrentStreak" INTEGER NOT NULL,
                  "BestStreak" INTEGER NOT NULL,
                  "UpdatedUtc" TEXT NOT NULL
              );
              CREATE INDEX IF NOT EXISTS "IX_OperatorRatings_Rating" ON "OperatorRatings" ("Rating");

              CREATE TABLE IF NOT EXISTS "RatingLedger" (
                  "Id" TEXT NOT NULL CONSTRAINT "PK_RatingLedger" PRIMARY KEY,
                  "AttemptId" TEXT NOT NULL,
                  "OwnerKey" TEXT NOT NULL,
                  "Outcome" TEXT NOT NULL,
                  "BeforeRating" INTEGER NOT NULL,
                  "Delta" INTEGER NOT NULL,
                  "AfterRating" INTEGER NOT NULL,
                  "CreatedUtc" TEXT NOT NULL
              );
              CREATE UNIQUE INDEX IF NOT EXISTS "IX_RatingLedger_AttemptId"
                  ON "RatingLedger" ("AttemptId");
              CREATE INDEX IF NOT EXISTS "IX_RatingLedger_OwnerKey" ON "RatingLedger" ("OwnerKey");

              CREATE TABLE IF NOT EXISTS "RankedActions" (
                  "Id" TEXT NOT NULL CONSTRAINT "PK_RankedActions" PRIMARY KEY,
                  "AttemptId" TEXT NOT NULL,
                  "RunId" TEXT NOT NULL,
                  "OwnerKey" TEXT NOT NULL,
                  "Command" TEXT NOT NULL,
                  "ActionId" TEXT NOT NULL,
                  "Stage" INTEGER NOT NULL,
                  "AcceptedUtc" TEXT NOT NULL
              );
              CREATE INDEX IF NOT EXISTS "IX_RankedActions_Attempt_Accepted"
                  ON "RankedActions" ("AttemptId", "AcceptedUtc");
              CREATE INDEX IF NOT EXISTS "IX_RankedActions_OwnerKey"
                  ON "RankedActions" ("OwnerKey");
              """, ct);
    }
}
