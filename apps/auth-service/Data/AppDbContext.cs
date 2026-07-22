using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace IsaacWallace.Auth.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole, string>(options)
{
    public DbSet<UserSession> UserSessions => Set<UserSession>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<UserSession>(e =>
        {
            e.HasIndex(s => s.UserId);
            e.Property(s => s.UserAgent).HasMaxLength(256);
            e.Property(s => s.Ip).HasMaxLength(64);
        });
    }
}
