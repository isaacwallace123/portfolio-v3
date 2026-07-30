using System.Globalization;

namespace IsaacWallace.Api.Ranked;

public sealed record RankedCommand(
    string Canonical,
    string ActionId,
    IReadOnlyDictionary<string, object> SpecPatch)
{
    public static bool TryParse(string input, out RankedCommand? command, out string error)
    {
        command = null;
        error = "";

        var words = input
            .Trim()
            .ToLowerInvariant()
            .Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0)
        {
            error = "Enter an operator command.";
            return false;
        }

        if (words is ["scale", "checkout", var checkout] &&
            Bounded(checkout, 1, 6, out var checkoutReplicas))
        {
            command = Change(
                $"scale checkout {checkoutReplicas}",
                $"scale-{checkoutReplicas}",
                "apiReplicas",
                checkoutReplicas);
            return true;
        }

        if (words is ["scale", "gateway", var gateway] &&
            Bounded(gateway, 1, 3, out var gatewayReplicas))
        {
            command = Change(
                $"scale gateway {gatewayReplicas}",
                $"gateway-{gatewayReplicas}",
                "gatewayReplicas",
                gatewayReplicas);
            return true;
        }

        if (words is ["shift", "canary", var canary] &&
            Bounded(canary, 0, 3, out var canaryReplicas))
        {
            command = Change(
                $"shift canary {canaryReplicas}",
                $"canary-{canaryReplicas}",
                "canaryReplicas",
                canaryReplicas);
            return true;
        }

        if (words is ["enable", "cache"])
        {
            command = Change("enable cache", "cache-on", "cacheReplicas", 1);
            return true;
        }

        if (words is ["disable", "cache"])
        {
            command = Change("disable cache", "cache-off", "cacheReplicas", 0);
            return true;
        }

        if (words is ["rollback", "checkout"])
        {
            command = Change("rollback checkout", "release-stable", "releaseTrack", "stable");
            return true;
        }

        if (words is ["recover", "catalogue"])
        {
            command = Change("recover catalogue", "data-recover", "dataState", "recovered");
            return true;
        }

        if (words is ["drain", "apps"])
        {
            command = Change("drain apps", "move-infra", "targetPool", "infra");
            return true;
        }

        if (words is ["drain", "infra"])
        {
            command = Change("drain infra", "move-apps", "targetPool", "apps");
            return true;
        }

        if (words is ["restart", "checkout"])
        {
            var token = Convert.ToHexStringLower(
                System.Security.Cryptography.RandomNumberGenerator.GetBytes(6));
            command = Change("restart checkout", "restart", "restartToken", token);
            return true;
        }

        error = words switch
        {
            ["scale", "checkout", _] => "Checkout replicas must be between 1 and 6.",
            ["scale", "gateway", _] => "Gateway replicas must be between 1 and 3.",
            ["shift", "canary", _] => "Canary replicas must be between 0 and 3.",
            _ => "Command is not in the ranked operator allowlist.",
        };
        return false;
    }

    private static RankedCommand Change(
        string canonical,
        string actionId,
        string field,
        object value) =>
        new(
            canonical,
            actionId,
            new Dictionary<string, object>(StringComparer.Ordinal)
            {
                [field] = value,
            });

    private static bool Bounded(string text, int min, int max, out int value) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value) &&
        value >= min &&
        value <= max;
}
