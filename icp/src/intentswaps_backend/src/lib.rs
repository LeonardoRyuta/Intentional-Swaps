// Module declarations
mod basic_bitcoin;
mod basic_solana;
mod bitcoin_integration;
mod orders;
mod solana_integration;
mod storage;
mod types;

// Re-export types for Candid interface
pub use types::*;

// Re-export public API functions
use orders::*;

// Initialization
use basic_bitcoin::{init_bitcoin, upgrade_bitcoin};
use basic_solana::{state::init_state, Ed25519KeyName, InitArg as SolanaInitArg, SolanaNetwork};
use ic_cdk::bitcoin_canister::Network as BtcNetwork;
use ic_cdk::{init, post_upgrade};
use sol_rpc_types::CommitmentLevel;

#[init]
fn init() {
    // Initialize Bitcoin module with Testnet (change to Mainnet for production)
    init_bitcoin(BtcNetwork::Testnet);

    // Initialize Solana module with Devnet (change to Mainnet for production)
    let solana_init = SolanaInitArg {
        sol_rpc_canister_id: None, // Uses default RPC
        solana_network: Some(SolanaNetwork::Devnet),
        ed25519_key_name: Some(Ed25519KeyName::MainnetTestKey1),
        solana_commitment_level: Some(CommitmentLevel::Confirmed),
    };
    init_state(solana_init);

    ic_cdk::println!("🚀 Intentional Swaps Canister initialized!");
    ic_cdk::println!("   - Bitcoin Network: Testnet");
    ic_cdk::println!("   - Solana Network: Devnet");
}

#[post_upgrade]
fn post_upgrade() {
    // Reinitialize Bitcoin module
    upgrade_bitcoin(BtcNetwork::Testnet);

    // Reinitialize Solana module
    let solana_init = SolanaInitArg {
        sol_rpc_canister_id: None,
        solana_network: Some(SolanaNetwork::Devnet),
        ed25519_key_name: Some(Ed25519KeyName::MainnetTestKey1),
        solana_commitment_level: Some(CommitmentLevel::Confirmed),
    };
    init_state(solana_init);

    ic_cdk::println!("♻️ Intentional Swaps Canister upgraded!");
}

// Query functions from storage
#[ic_cdk::query]
fn get_pending_orders() -> Vec<OrderInfo> {
    storage::get_pending_orders()
}

#[ic_cdk::query]
fn get_expired_orders() -> Vec<OrderInfo> {
    storage::get_expired_orders()
}

#[ic_cdk::query]
fn get_order(order_id: u64) -> Option<OrderInfo> {
    storage::get_order(order_id)
}

#[ic_cdk::query]
fn get_my_orders() -> Vec<OrderInfo> {
    let caller = ic_cdk::api::caller();
    storage::get_my_orders(caller)
}

// Direct API exports for blockchain operations
#[ic_cdk::update]
async fn get_canister_addresses() -> Result<CanisterAddresses, String> {
    orders::get_canister_addresses().await
}

#[ic_cdk::update]
async fn send_bitcoin(to_address: String, amount_satoshis: u64) -> Result<String, String> {
    bitcoin_integration::send_bitcoin(to_address, amount_satoshis).await
}

#[ic_cdk::update]
async fn send_solana(to_address: String, amount_lamports: u64) -> Result<String, String> {
    solana_integration::send_solana(to_address, amount_lamports).await
}

#[ic_cdk::update]
async fn verify_bitcoin_transaction(
    recipient_address: String,
    expected_amount: u64,
    txid: String,
) -> Result<bool, String> {
    bitcoin_integration::verify_bitcoin_transaction(recipient_address, expected_amount, txid).await
}

#[ic_cdk::update]
async fn verify_solana_transaction(
    recipient_address: String,
    expected_amount: u64,
    txid: String,
) -> Result<bool, String> {
    solana_integration::verify_solana_transaction(recipient_address, expected_amount, txid).await
}

#[ic_cdk::update]
async fn get_bitcoin_balance(address: String) -> Result<f64, String> {
    bitcoin_integration::get_bitcoin_balance(address).await
}

#[ic_cdk::update]
async fn get_solana_balance(address: String) -> Result<f64, String> {
    solana_integration::get_solana_balance(address).await
}

#[ic_cdk::update]
async fn test_send_sol(to_address: String) -> Result<String, String> {
    solana_integration::test_send_sol(to_address).await
}

// Legacy compatibility functions (deprecated)
#[ic_cdk::update]
fn deposit_funds(_chain: Chain, _amount: u64) -> Result<String, String> {
    Err("Deprecated: Use your own Bitcoin/Solana wallet to send funds".to_string())
}
