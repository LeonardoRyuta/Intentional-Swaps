use crate::basic_bitcoin::BTC_CONTEXT;
use ic_cdk::{
    bitcoin_canister::{bitcoin_get_balance, GetBalanceRequest},
    update,
};

/// Returns the balance of the given bitcoin address.
/// Includes pending (unconfirmed) transactions for faster swap verification.
#[update]
pub async fn get_balance(address: String) -> u64 {
    let ctx = BTC_CONTEXT.with(|ctx| ctx.get());

    bitcoin_get_balance(&GetBalanceRequest {
        address,
        network: ctx.network,
        min_confirmations: Some(0), // Include pending transactions
    })
    .await
    .unwrap()
}
