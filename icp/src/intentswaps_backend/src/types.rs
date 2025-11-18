use candid::{CandidType, Deserialize, Principal};

// Type definitions
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum OrderStatus {
    AwaitingDeposit,   // Order created, waiting for user to deposit
    DepositReceived,   // User deposited, waiting for resolver
    ResolverDeposited, // Resolver deposited, ready for swap
    Completed,         // Swap completed successfully
    Cancelled,         // Order cancelled
    Expired,           // Order expired
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub enum Chain {
    Bitcoin,
    Solana,
}

// Represents an asset on a blockchain
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum Asset {
    Bitcoin, // Native BTC
    Solana,  // Native SOL
    SplToken {
        mint_address: String, // SPL token mint address
        decimals: u8,         // Token decimals (e.g., 6 for USDC, 9 for most tokens)
    },
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct OrderRequest {
    pub from_asset: Asset,
    pub to_asset: Asset,
    pub from_amount: u64, // Amount in smallest unit (satoshis/lamports/token atoms)
    pub to_amount: u64,   // Amount in smallest unit
    pub secret_hash: String, // MD5 hash of the secret
    pub timeout_seconds: u64, // Time before order expires
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Order {
    pub id: u64,
    pub creator: Principal,
    pub creator_btc_address: Option<String>, // User's Bitcoin address for refunds
    pub creator_sol_address: Option<String>, // User's Solana address for refunds/receives
    pub from_asset: Asset,
    pub to_asset: Asset,
    pub from_amount: u64,
    pub to_amount: u64,
    pub secret_hash: String,
    pub secret: Option<String>,
    pub status: OrderStatus,
    pub resolver: Option<Principal>,
    pub resolver_btc_address: Option<String>,
    pub resolver_sol_address: Option<String>,
    pub created_at: u64,
    pub expires_at: u64,
    // Transaction tracking
    pub creator_txid: Option<String>, // Bitcoin/Solana transaction ID from creator
    pub resolver_txid: Option<String>, // Bitcoin/Solana transaction ID from resolver
    pub creator_deposited: bool,
    pub resolver_deposited: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct OrderInfo {
    pub id: u64,
    pub creator: Principal,
    pub creator_btc_address: Option<String>,
    pub creator_sol_address: Option<String>,
    pub from_asset: Asset,
    pub to_asset: Asset,
    pub from_amount: u64,
    pub to_amount: u64,
    pub secret_hash: String,
    pub status: OrderStatus,
    pub resolver: Option<Principal>,
    pub resolver_btc_address: Option<String>,
    pub resolver_sol_address: Option<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub canister_btc_address: String,
    pub canister_sol_address: String,
    pub creator_deposited: bool,
    pub resolver_deposited: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct CanisterAddresses {
    pub bitcoin_address: String,
    pub solana_address: String,
}
