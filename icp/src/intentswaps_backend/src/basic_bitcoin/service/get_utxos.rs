use crate::basic_bitcoin::BTC_CONTEXT;
use ic_cdk::{
    bitcoin_canister::{bitcoin_get_utxos, GetUtxosRequest, GetUtxosResponse, UtxosFilter},
    update,
};

/// Returns the UTXOs of the given Bitcoin address.
/// By default, includes pending (unconfirmed) transactions for faster swap verification.
#[update]
pub async fn get_utxos(address: String) -> GetUtxosResponse {
    let ctx = BTC_CONTEXT.with(|ctx| ctx.get());

    bitcoin_get_utxos(&GetUtxosRequest {
        address,
        network: ctx.network,
        filter: Some(UtxosFilter::MinConfirmations(0)),
    })
    .await
    .unwrap()
}
