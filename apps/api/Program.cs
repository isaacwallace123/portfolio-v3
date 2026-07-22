using Microsoft.AspNetCore.HttpOverrides;
using Scalar.AspNetCore;

// api.isaacwallace.dev — the general application API for the portfolio network.
//
// Identity is NOT here: sign-in, sessions, roles, and the SSO cookie live in the dedicated auth
// service (apps/auth → auth.isaacwallace.dev). This project is the home for the network's
// real, non-auth application data as it grows. It ships as its own image so the two concerns scale
// and deploy independently.
//
// It already carries the shared cross-cutting setup — CORS credentialed to the known site origins
// (so cookie-authenticated calls work), forwarded headers (Cloudflare terminates TLS), and the
// Scalar API reference in Development — so the first data endpoint is the only thing left to add.

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? [];

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

builder.Services.AddOpenApi();

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

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "isaacwallace-api" }));

app.Run();
