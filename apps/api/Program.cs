using IsaacWallace.Api.Auth;
using IsaacWallace.Api.Runs;
using k8s;
using Microsoft.AspNetCore.HttpOverrides;
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

var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? [];

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

// API-key authentication, scope authorization, and per-caller rate limiting.
builder.Services.AddHomelabApiAuth(config);

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

var app = builder.Build();

app.UseForwardedHeaders();
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

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "isaacwallace-api" }));

// Whoami — lets an integrator confirm their key, name, and granted scopes. Requires any valid key.
app.MapGet("/v1/me", (HttpContext ctx) =>
{
    var record = (ApiKeyRecord)ctx.Items[ApiKeyAuthenticationHandler.RecordItemKey]!;
    return Results.Ok(new { keyId = record.Id, name = record.Name, scopes = record.Scopes });
})
.RequireApiKey();

// HomeOps run-broker: /v1/scenarios + /v1/runs (create/list/get/delete), gated by runs:* scopes.
app.MapRunEndpoints();

app.Run();
