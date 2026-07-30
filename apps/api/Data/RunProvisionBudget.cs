namespace IsaacWallace.Api.Data;

/// <summary>
/// Cross-replica provisioning budget for one verified owner. This is intentionally durable: an API
/// restart or a second replica must not turn cluster creation into an unlimited operation.
/// </summary>
public sealed class RunProvisionBudget
{
    public string OwnerKey { get; set; } = "";
    public DateTime WindowStartedUtc { get; set; }
    public DateTime LastProvisionedUtc { get; set; }
    public int Count { get; set; }
}
