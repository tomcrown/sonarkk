// Sonark Vault — Phase 2 implements full logic (deposit, NAV, share token, withdrawal).
// Scaffold confirms the package compiles with Move edition 2024.
module vault::vault;

public struct Vault has key {
    id: UID,
}
