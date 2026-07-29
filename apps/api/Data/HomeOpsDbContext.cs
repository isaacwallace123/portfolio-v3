using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Api.Data;

// The api's own store. Identity lives in the auth service; this holds what the HomeOps arena
// produces — drill results, and the averages and leaderboards computed from them.
public sealed class HomeOpsDbContext(DbContextOptions<HomeOpsDbContext> options) : DbContext(options)
{
    public DbSet<DrillResult> DrillResults => Set<DrillResult>();

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
              """, ct);
    }
}
