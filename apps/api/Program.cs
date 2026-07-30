using IsaacWallace.Api.Auth;
using IsaacWallace.Api.Data;
using IsaacWallace.Api.Learning;
using IsaacWallace.Api.Ranked;
using IsaacWallace.Api.Runs;
using k8s;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

// api.isaacwallace.dev — the general application API for the portfolio network, and the public,
// key-authenticated front door to the homelab. Other projects (hosted here or anywhere) integrate
// through this one surface.
//
// Two auth lanes share the service: browser calls from the known site origins are CORS-credentialed
// (cookie SSO lives in apps/auth), while machine-to-machine callers present an API key — hashed,
// scoped, and rate-limited (see Auth/). The first key-gated capability, the HomeOps run-broker, is
// added in the next slice; this layer is the foundation it sits on.

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.WebHost.ConfigureKestrel(options =>
    options.Limits.MaxRequestBodySize = 16 * 1024);

var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? [];

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

// API-key authentication, scope authorization, and per-caller rate limiting.
builder.Services.AddHomelabApiAuth(config);

// The api's own store: drill results, and the averages and leaderboards computed from them. Postgres
// in the cluster (the same instance the auth service uses, a separate set of tables); SQLite on a dev
// box so the arena works without one.
builder.Services.AddDbContext<HomeOpsDbContext>(o =>
{
    var postgres = config.GetConnectionString("Postgres");
    if (!string.IsNullOrWhiteSpace(postgres)) o.UseNpgsql(postgres);
    else o.UseSqlite(config.GetConnectionString("Default") ?? "Data Source=app.db");
});
builder.Services.AddScoped<DrillResultStore>();
builder.Services.AddScoped<RankedStore>();

// HomeOps Academy progress, in its own context on the same database. Separate from the arena's
// store because a course outlives every cluster a learner ever provisioned — see LearningDbContext.
builder.Services.AddDbContext<LearningDbContext>(o =>
{
    var postgres = config.GetConnectionString("Postgres");
    if (!string.IsNullOrWhiteSpace(postgres)) o.UseNpgsql(postgres);
    else o.UseSqlite(config.GetConnectionString("Default") ?? "Data Source=app.db");
});
builder.Services.AddScoped<LearningProgressStore>();

// HomeOps run-broker: creates Crossplane LabRun objects on the cluster. In a pod it uses the
// mounted ServiceAccount (scoped to LabRuns only); on a dev box it uses the local kubeconfig.
builder.Services.Configure<RunBrokerOptions>(config.GetSection(RunBrokerOptions.SectionName));
builder.Services.AddSingleton<IKubernetes>(_ =>
{
    var kube = KubernetesClientConfiguration.IsInCluster()
        ? KubernetesClientConfiguration.InClusterConfig()
        : KubernetesClientConfiguration.BuildConfigFromConfigFile();
    return new Kubernetes(kube);
});
builder.Services.AddSingleton<EnvoyScraper>();
builder.Services.AddSingleton<TraceScraper>();
builder.Services.AddSingleton<PlatformInventory>();
builder.Services.AddScoped<RunBroker>();
// Enforces run TTLs (deletes runs whose tab was closed without teardown), freeing capacity slots.
builder.Services.AddHostedService<RunReaper>();

builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer<ApiKeySecuritySchemeTransformer>();
});

// Behind cloudflared + Cloudflare: honour X-Forwarded-Proto/For so the app sees the real client
// scheme and IP. The in-cluster proxy chain is trusted; the network boundary is enforced upstream.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear();
    o.KnownProxies.Clear();
});

// The drill catalog has rules a compiler cannot check: every stage needs an objective, a correct
// move, and no trap it cannot be recovered from. Refusing to start is the right response to breaking
// one — a drill nobody can finish is worse than an outage, because it looks like it is working.
var catalogProblems = DrillKit.Problems(ScenarioDefinitions.Drills)
    .Concat(ScenarioDefinitions.RankedDrills
        .Where(scenario => !RankedRules.IsCalibratedScenario(scenario.Id))
        .Select(scenario =>
            $"{scenario.Id}: ranked scenario has no explicit rating calibration."))
    .ToArray();
if (catalogProblems.Length > 0)
    throw new InvalidOperationException(
        "The drill catalog is invalid:" + Environment.NewLine +
        string.Join(Environment.NewLine, catalogProblems));

var app = builder.Build();

// Drill results live beside the auth service's tables in an existing database, so EnsureCreated
// would never build them — the schema is applied as idempotent DDL instead. Failing to reach the
// database must not take the arena down: a run that cannot record its time is still a run, and the
// endpoints that read results degrade to empty rather than erroring.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<HomeOpsDbContext>();
    try
    {
        await db.EnsureSchemaAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Could not prepare the drill-results schema; results will not record.");
    }
}

// Academy tables, same idempotent-DDL approach and the same tolerance: a database the Academy
// cannot reach means progress does not persist, which is a bad day. It must not mean the arena
// refuses to start.
using (var scope = app.Services.CreateScope())
{
    var learning = scope.ServiceProvider.GetRequiredService<LearningDbContext>();
    try
    {
        await learning.EnsureSchemaAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Could not prepare the Academy schema; progress will not persist.");
    }
}

app.UseForwardedHeaders();

// Baseline response hardening. This service answers JSON to machines, so the browser-facing surface
// is small — but a sniffed content type is still the cheapest way to turn an API response into
// something a browser will execute, and none of this is ever a document worth framing.
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["X-Frame-Options"] = "DENY";
    ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
    await next();
});

app.UseCors();

// Interactive API reference in dev: /scalar (spec at /openapi/v1.json).
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// Auth resolves the key (populating HttpContext.Items) before the rate limiter partitions by it.
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

// Exempt from the rate limiter on purpose: this is the kubelet's liveness and readiness target, and
// a probe that 429s is a probe that fails, which restarts a pod that was healthy. Liveness must
// never depend on how much traffic strangers are sending.
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "isaacwallace-api" }))
    .DisableRateLimiting();

// Whoami — lets an integrator confirm their key, name, and granted scopes. Requires any valid key.
app.MapGet("/v1/me", (HttpContext ctx) =>
{
    var record = (ApiKeyRecord)ctx.Items[ApiKeyAuthenticationHandler.RecordItemKey]!;
    return Results.Ok(new { keyId = record.Id, name = record.Name, scopes = record.Scopes });
})
.RequireApiKey();

// HomeOps run-broker: /v1/scenarios + /v1/runs (create/list/get/delete), gated by runs:* scopes.
app.MapRunEndpoints();
app.MapRankedEndpoints();

// HomeOps Academy: /v1/learning/* — curriculum progress and the certificate. Records what a
// learner has done; never touches a cluster.
app.MapLearningEndpoints();

app.Run();
