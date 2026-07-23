using System.Security.Cryptography;
using System.Text;

namespace IsaacWallace.Auth;

// Key generation, hashing, and scope helpers for the API-key authority. auth is the only place these
// live — resource servers only ever see the sanitized introspection result.
public static class ApiKeyOps
{
    // The scope catalog. A key is issued a subset; `admin` satisfies every requirement downstream.
    public static readonly string[] KnownScopes = ["admin", "runs:read", "runs:write"];

    // A key looks like `iw_<48 hex chars>`. Only the plaintext returned here can ever authenticate;
    // it is shown once and only its hash is persisted.
    public static string Generate()
        => $"iw_{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24))}";

    public static string Hash(string key)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    public static string[] ParseScopes(string csv)
        => csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    public static string NormalizeScopes(IEnumerable<string> scopes)
        => string.Join(',', scopes.Select(s => s.Trim()).Where(s => s.Length > 0).Distinct());

    public static bool AreScopesKnown(IEnumerable<string> scopes)
        => scopes.All(s => KnownScopes.Contains(s));

    // Constant-time compare for the internal introspection token.
    public static bool ConstantTimeEquals(string a, string b)
        => CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}
