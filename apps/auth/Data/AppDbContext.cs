using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Auth.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole, string>(options)
{
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<UserSession>(e =>
        {
            e.HasIndex(s => s.UserId);
            e.Property(s => s.UserAgent).HasMaxLength(256);
            e.Property(s => s.Ip).HasMaxLength(64);
        });
        builder.Entity<ApiKey>(e =>
        {
            e.HasIndex(k => k.Hash).IsUnique();
            e.Property(k => k.Name).HasMaxLength(128);
            e.Property(k => k.Hash).HasMaxLength(64);
        });
    }
}
