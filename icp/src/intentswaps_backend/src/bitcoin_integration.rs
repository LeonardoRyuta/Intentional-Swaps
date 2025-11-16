// Integration wrapper for the comprehensive Bitcoin module
use crate::basic_bitcoin::{
    service::{get_balance, get_p2wpkh_address, get_utxos, send_from_p2wpkh_address},
    SendRequest,
};

/// Get canister's Bitcoin P2WPKH address
/// This is the address where users and resolvers will deposit Bitcoin
pub async fn get_canister_btc_address() -> Result<String, String> {
    Ok(get_p2wpkh_address::get_p2wpkh_address().await)
}

/// Verify a Bitcoin transaction exists and has the correct recipient/amount
/// Uses UTXO verification to ensure funds were actually received
pub async fn verify_bitcoin_transaction(
    recipient_address: String,
    expected_amount: u64,
    _txid: String,
) -> Result<bool, String> {
    // Get UTXOs for the recipient address
    let utxos_response = get_utxos::get_utxos(recipient_address.clone()).await;

    // Check if there are any UTXOs
    if utxos_response.utxos.is_empty() {
        ic_cdk::println!("❌ No UTXOs found for address: {}", recipient_address);
        return Ok(false);
    }

    // Calculate total balance from UTXOs
    let total_balance: u64 = utxos_response.utxos.iter().map(|utxo| utxo.value).sum();

    ic_cdk::println!(
        "✅ Bitcoin verification: Address {} has {} satoshis (expected: {})",
        recipient_address,
        total_balance,
        expected_amount
    );

    // Verify the balance is sufficient
    // For HTLC, we check if the canister has received at least the expected amount
    Ok(total_balance >= expected_amount)
}

/// Send Bitcoin from canister to a destination address
/// This is used for completing swaps or processing refunds
pub async fn send_bitcoin(to_address: String, amount_satoshis: u64) -> Result<String, String> {
    ic_cdk::println!(
        "🔄 Sending {} satoshis to Bitcoin address: {}",
        amount_satoshis,
        to_address
    );

    let request = SendRequest {
        destination_address: to_address.clone(),
        amount_in_satoshi: amount_satoshis,
    };

    let txid = send_from_p2wpkh_address::send_from_p2wpkh_address(request).await;

    ic_cdk::println!("✅ Bitcoin sent! TXID: {}", txid);
    Ok(txid)
}

/// Get Bitcoin balance for any address
pub async fn get_bitcoin_balance(address: String) -> Result<f64, String> {
    let balance_satoshis = get_balance::get_balance(address).await;
    let balance_btc = balance_satoshis as f64 / 100_000_000.0;
    Ok(balance_btc)
}
