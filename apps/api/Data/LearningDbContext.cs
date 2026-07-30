using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Api.Data;

// Academy progress, in its own context on the same database.
//
// A separate DbContext rather than more DbSets on HomeOpsDbContext, for two reasons. The domains
// are genuinely different — one records what a cluster did, the other what a person learned — and
// keeping them apart means the Academy's schema can change without touching the file the arena and
// the leaderboard depend on. It costs one extra registration in Program.cs and buys a clean seam.
public sealed class LearningDbContext(DbContextOptions<LearningDbContext> options) : DbContext(options)
{
    public DbSet<LearningCourseProgress> CourseProgress => Set<LearningCourseProgress>();
    public DbSet<LearningUnitProgress> UnitProgress => Set<LearningUnitProgress>();
    public DbSet<LearningAttempt> Attempts => Set<LearningAttempt>();
    public DbSet<LearningCertificate> Certificates => Set<LearningCertificate>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<LearningCourseProgress>(e =>
        {
            e.ToTable("LearningCourseProgress");
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.OwnerKey).HasMaxLength(64);
            e.Property(x => x.CourseId).HasMaxLength(64);
            // One enrolment per person per course version. Two tabs completing the first lesson at
            // the same moment must not produce two enrolments with two different start dates.
            e.HasIndex(x => new { x.OwnerKey, x.CourseId, x.CourseVersion }).IsUnique();
        });

        builder.Entity<LearningUnitProgress>(e =>
        {
            e.ToTable("LearningUnitProgress");
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.OwnerKey).HasMaxLength(64);
            e.Property(x => x.CourseId).HasMaxLength(64);
            e.Property(x => x.UnitId).HasMaxLength(128);
            e.Property(x => x.UnitType).HasMaxLength(16);
            e.Property(x => x.Status).HasMaxLength(16);
            // The row IS the unit's state, so it has to be unique — otherwise "completed" is
            // whichever duplicate the query happened to read first.
            e.HasIndex(x => new { x.OwnerKey, x.CourseId, x.CourseVersion, x.UnitId }).IsUnique();
        });

        builder.Entity<LearningAttempt>(e =>
        {
            e.ToTable("LearningAttempts");
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.OwnerKey).HasMaxLength(64);
            e.Property(x => x.CourseId).HasMaxLength(64);
            e.Property(x => x.UnitId).HasMaxLength(128);
            e.Property(x => x.RunId).HasMaxLength(64);
            e.Property(x => x.Presentation).HasMaxLength(16);
            e.Property(x => x.Outcome).HasMaxLength(16);
            e.HasIndex(x => new { x.OwnerKey, x.CourseId, x.UnitId });
            // A solved cluster may be observed by several API polls (and several API replicas).
            // The run is the idempotency key for recording that capstone.
            e.HasIndex(x => new { x.OwnerKey, x.CourseId, x.UnitId, x.RunId })
                .IsUnique()
                .HasFilter("\"RunId\" <> ''");
        });

        builder.Entity<LearningCertificate>(e =>
        {
            e.ToTable("LearningCertificates");
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.OwnerKey).HasMaxLength(64);
            e.Property(x => x.CourseId).HasMaxLength(64);
            e.Property(x => x.LearnerName).HasMaxLength(128);
            e.Property(x => x.Skills).HasMaxLength(512);
            // Issued exactly once per person per course version. The database is the only place
            // that can promise that when two requests arrive together.
            e.HasIndex(x => new { x.OwnerKey, x.CourseId, x.CourseVersion }).IsUnique();
        });
    }

    /// <summary>Idempotent DDL, both providers. Same approach as HomeOpsDbContext and for the same
    /// reason: these tables live beside the auth service's in an existing database, so EnsureCreated
    /// would never build them.</summary>
    public async Task EnsureSchemaAsync(CancellationToken ct = default)
    {
        var isNpgsql = Database.ProviderName?
            .Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true;

        var text = isNpgsql ? "text" : "TEXT";
        var varchar = isNpgsql ? "character varying" : "TEXT";
        var integer = isNpgsql ? "integer" : "INTEGER";
        var bigint = isNpgsql ? "bigint" : "INTEGER";
        var boolean = isNpgsql ? "boolean" : "INTEGER";
        var stamp = isNpgsql ? "timestamp with time zone" : "TEXT";

        // SQLite ignores the length on a varchar; Postgres wants it. One string builds both.
        string V(int n) => isNpgsql ? $"{varchar}({n})" : text;

        // Every interpolated fragment above is a closed provider constant, never request data.
        // Parameters cannot represent SQL type names, so raw DDL is intentional here.
#pragma warning disable EF1002
        await Database.ExecuteSqlRawAsync($"""
            CREATE TABLE IF NOT EXISTS "LearningCourseProgress" (
                "Id" {V(64)} NOT NULL CONSTRAINT "PK_LearningCourseProgress" PRIMARY KEY,
                "OwnerKey" {V(64)} NOT NULL,
                "CourseId" {V(64)} NOT NULL,
                "CourseVersion" {integer} NOT NULL,
                "StartedUtc" {stamp} NOT NULL,
                "CompletedUtc" {stamp} NULL,
                "LastActivityUtc" {stamp} NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_LearningCourseProgress_Owner"
                ON "LearningCourseProgress" ("OwnerKey", "CourseId", "CourseVersion");

            CREATE TABLE IF NOT EXISTS "LearningUnitProgress" (
                "Id" {V(64)} NOT NULL CONSTRAINT "PK_LearningUnitProgress" PRIMARY KEY,
                "OwnerKey" {V(64)} NOT NULL,
                "CourseId" {V(64)} NOT NULL,
                "CourseVersion" {integer} NOT NULL,
                "UnitId" {V(128)} NOT NULL,
                "UnitType" {V(16)} NOT NULL,
                "Status" {V(16)} NOT NULL,
                "Score" {integer} NULL,
                "Attempts" {integer} NOT NULL,
                "BestElapsedMs" {bigint} NULL,
                "Clean" {boolean} NOT NULL,
                "CompletedUtc" {stamp} NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_LearningUnitProgress_Unit"
                ON "LearningUnitProgress" ("OwnerKey", "CourseId", "CourseVersion", "UnitId");

            CREATE TABLE IF NOT EXISTS "LearningAttempts" (
                "Id" {V(64)} NOT NULL CONSTRAINT "PK_LearningAttempts" PRIMARY KEY,
                "OwnerKey" {V(64)} NOT NULL,
                "CourseId" {V(64)} NOT NULL,
                "UnitId" {V(128)} NOT NULL,
                "RunId" {V(64)} NOT NULL,
                "Presentation" {V(16)} NOT NULL,
                "StartedUtc" {stamp} NOT NULL,
                "CompletedUtc" {stamp} NULL,
                "Outcome" {V(16)} NOT NULL,
                "Missteps" {integer} NOT NULL,
                "ElapsedMs" {bigint} NOT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_LearningAttempts_Unit"
                ON "LearningAttempts" ("OwnerKey", "CourseId", "UnitId");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_LearningAttempts_Run"
                ON "LearningAttempts" ("OwnerKey", "CourseId", "UnitId", "RunId")
                WHERE "RunId" <> '';

            CREATE TABLE IF NOT EXISTS "LearningCertificates" (
                "Id" {V(64)} NOT NULL CONSTRAINT "PK_LearningCertificates" PRIMARY KEY,
                "OwnerKey" {V(64)} NOT NULL,
                "CourseId" {V(64)} NOT NULL,
                "CourseVersion" {integer} NOT NULL,
                "LearnerName" {V(128)} NOT NULL,
                "IssuedUtc" {stamp} NOT NULL,
                "Skills" {V(512)} NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_LearningCertificates_Owner"
                ON "LearningCertificates" ("OwnerKey", "CourseId", "CourseVersion");
            """, ct);
#pragma warning restore EF1002
    }
}
