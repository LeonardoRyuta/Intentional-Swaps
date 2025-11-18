use crate::basic_bitcoin::{
    common::{get_fee_per_byte, DerivationPath},
    ecdsa::{get_ecdsa_public_key, sign_with_ecdsa},
    p2wpkh, SendRequest, BTC_CONTEXT,
};
use bitcoin::{consensus::serialize, Address, CompressedPublicKey, PublicKey};
use ic_cdk::{
    bitcoin_canister::{
        bitcoin_get_utxos, bitcoin_send_transaction, GetUtxosRequest, SendTransactionRequest,
        UtxosFilter,
    },
    trap, update,
};
use std::str::FromStr;

/// Sends the given amount of bitcoin from this smart contract's P2PKH address to the given address.
/// Returns the transaction ID.
#[update]
pub async fn send_from_p2wpkh_address(request: SendRequest) -> String {
    let ctx = BTC_CONTEXT.with(|ctx| ctx.get());

    if request.amount_in_satoshi == 0 {
        trap("Amount must be greater than 0");
    }

    // Parse and validate the destination address. The address type needs to be
    // valid for the Bitcoin network we are on.
    let dst_address = Address::from_str(&request.destination_address)
        .unwrap()
        .require_network(ctx.bitcoin_network)
        .unwrap();

    // Unique derivation paths are used for every address type generated, to ensure
    // each address has its own unique key pair. To generate a user-specific address,
    // you would typically use a derivation path based on the user's identity or some other unique identifier.
    let derivation_path = DerivationPath::p2wpkh(0, 0);

    // Get the ECDSA public key of this smart contract at the given derivation path
    let own_public_key = get_ecdsa_public_key(&ctx, derivation_path.to_vec_u8_path()).await;

    // Create a CompressedPublicKey from the raw public key bytes
    let own_compressed_public_key = CompressedPublicKey::from_slice(&own_public_key).unwrap();

    // Convert the public key to the format used by the Bitcoin library
    let own_public_key = PublicKey::from_slice(&own_public_key).unwrap();

    // Generate a P2WPKH address from the public key
    let own_address = Address::p2wpkh(&own_compressed_public_key, ctx.bitcoin_network);

    ic_cdk::println!("📦 Fetching UTXOs for canister address: {}", own_address);

    // Note that pagination may have to be used to get all UTXOs for the given address.
    // For the sake of simplicity, it is assumed here that the `utxo` field in the response
    // contains all UTXOs.
    // Using MinConfirmations(0) to include pending UTXOs for faster transaction processing.
    let utxo_response = bitcoin_get_utxos(&GetUtxosRequest {
        address: own_address.to_string(),
        network: ctx.network,
        filter: Some(UtxosFilter::MinConfirmations(0)),
    })
    .await
    .unwrap();

    let own_utxos = utxo_response.utxos;
    let total_balance: u64 = own_utxos.iter().map(|u| u.value).sum();

    ic_cdk::println!("📦 Found {} UTXOs with total balance: {} satoshis", own_utxos.len(), total_balance);
    ic_cdk::println!("💰 Attempting to send: {} satoshis to {}", request.amount_in_satoshi, dst_address);

    if own_utxos.is_empty() {
        ic_cdk::println!("❌ ERROR: No UTXOs available!");
        trap("No UTXOs available for spending");
    }

    if total_balance < request.amount_in_satoshi {
        ic_cdk::println!("❌ ERROR: Insufficient balance! Have {} satoshis, need {} satoshis", total_balance, request.amount_in_satoshi);
        trap(&format!("Insufficient balance: have {} sats, need {} sats", total_balance, request.amount_in_satoshi));
    }

    // Build the transaction that sends `amount` to the destination address.
    ic_cdk::println!("🔨 Building transaction...");
    let fee_per_byte = get_fee_per_byte(&ctx).await;
    ic_cdk::println!("💵 Fee per byte: {} millisatoshi", fee_per_byte);
    let (transaction, prevouts) = p2wpkh::build_transaction(
        &ctx,
        &own_public_key,
        &own_address,
        &own_utxos,
        &dst_address,
        request.amount_in_satoshi,
        fee_per_byte,
    )
    .await;

    ic_cdk::println!("✍️ Signing transaction...");

    // Sign the transaction.
    let signed_transaction = p2wpkh::sign_transaction(
        &ctx,
        &own_public_key,
        &own_address,
        transaction,
        &prevouts,
        derivation_path.to_vec_u8_path(),
        sign_with_ecdsa,
    )
    .await;

    let txid = signed_transaction.compute_txid().to_string();
    let serialized_tx = serialize(&signed_transaction);
    
    ic_cdk::println!("📤 Broadcasting transaction {} to Bitcoin network...", txid);
    ic_cdk::println!("📊 Transaction size: {} bytes", serialized_tx.len());

    // Send the transaction to the Bitcoin API.
    let send_result = bitcoin_send_transaction(&SendTransactionRequest {
        network: ctx.network,
        transaction: serialized_tx,
    })
    .await;

    match send_result {
        Ok(_) => {
            ic_cdk::println!("✅ Transaction {} broadcast successfully!", txid);
        }
        Err(e) => {
            ic_cdk::println!("❌ Failed to broadcast transaction {}: {:?}", txid, e);
            trap(&format!("Failed to broadcast transaction: {:?}", e));
        }
    }

    // Return the transaction ID.
    txid
}
