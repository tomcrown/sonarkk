// Sonark Policy — Phase 2 implements full logic (keeper capability, revocation, budget cap).
// Scaffold confirms the package compiles with Move edition 2024.
module policy::policy;

public struct KeeperPolicy has key {
    id: UID,
}
