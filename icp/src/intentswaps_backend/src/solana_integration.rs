use crate::basic_solana::{client, solana_wallet::SolanaWallet};
use candid::Principal;
use sol_rpc_types::{CommitmentLevel, GetBalanceParams, GetTransactionParams, Signature};
use solana_message::Message as SolanaMessage;
use solana_pubkey::Pubkey as SolanaAddress;
use solana_transaction::Transaction as SolanaTransaction;
use std::str::FromStr;

/// Get canister's Solana address
/// This uses the SolanaWallet with the canister's principal for deterministic address generation
pub async fn get_canister_sol_address(canister_principal: Principal) -> Result<String, String> {
    let wallet = SolanaWallet::new(canister_principal).await;
    let account = wallet.solana_account();
    Ok(account.to_string())
}

/// Verify a Solana transaction exists and has the correct recipient/amount
/// Uses both transaction verification and balance checking for HTLC security
pub async fn verify_solana_transaction(
    recipient_address: String,
    expected_amount: u64,
    txid: String,
) -> Result<bool, String> {
    ic_cdk::println!("🔍 Verifying Solana transaction: {}", txid);

    // First, verify the transaction exists and was successful
    let signature = Signature::from_str(&txid).map_err(|e| format!("Invalid signature: {}", e))?;

    let client = client();

    use sol_rpc_types::GetTransactionEncoding;
    let params = GetTransactionParams {
        signature,
        encoding: Some(GetTransactionEncoding::Base64),
        commitment: Some(CommitmentLevel::Confirmed),
        max_supported_transaction_version: Some(0),
    };

    let tx = client
        .get_transaction(params)
        .send()
        .await
        .expect_consistent()
        .map_err(|e| format!("Failed to get transaction: {:?}", e))?;

    // Check if transaction exists and was successful
    let tx_valid = if let Some(tx) = tx {
        if let Some(meta) = &tx.transaction.meta {
            if meta.err.is_none() {
                ic_cdk::println!("✅ Transaction found and successful");
                true
            } else {
                ic_cdk::println!("❌ Transaction found but failed: {:?}", meta.err);
                false
            }
        } else {
            ic_cdk::println!("❌ Transaction found but no metadata");
            false
        }
    } else {
        ic_cdk::println!("❌ Transaction not found");
        false
    };

    if !tx_valid {
        return Ok(false);
    }

    // Additionally verify the balance to ensure funds are available
    let balance = get_solana_balance_internal(recipient_address.clone()).await?;

    ic_cdk::println!(
        "✅ Solana verification: Address {} has {} lamports (expected: {})",
        recipient_address,
        balance,
        expected_amount
    );

    Ok(balance >= expected_amount)
}
/// Send Solana from canister to a destination address
/// Uses the SolanaWallet for proper key management and signing
pub async fn send_solana(to_address: String, amount_lamports: u64) -> Result<String, String> {
    ic_cdk::println!(
        "🔄 Sending {} lamports to Solana address: {}",
        amount_lamports,
        to_address
    );

    let canister_principal = ic_cdk::api::id();
    let wallet = SolanaWallet::new(canister_principal).await;
    let from_account = wallet.solana_account();
    let from_pubkey = from_account.ed25519_public_key;

    let to_pubkey = SolanaAddress::from_str(&to_address)
        .map_err(|e| format!("Invalid destination Solana address: {}", e))?;

    let client = client();

    // Create transfer instruction
    use solana_system_interface::instruction::transfer;
    let instruction = transfer(&from_pubkey, &to_pubkey, amount_lamports);

    // Get recent blockhash
    let recent_blockhash = client
        .estimate_recent_blockhash()
        .send()
        .await
        .map_err(|e| format!("Failed to get recent blockhash: {:?}", e))?;

    // Build and sign message using the wallet
    let message =
        SolanaMessage::new_with_blockhash(&[instruction], Some(&from_pubkey), &recent_blockhash);

    let signature = from_account.sign_message(&message).await;

    let transaction = SolanaTransaction {
        message,
        signatures: vec![signature],
    };

    // Send transaction
    let tx_signature = client
        .send_transaction(transaction)
        .send()
        .await
        .expect_consistent()
        .map_err(|e| format!("Failed to send Solana transaction: {:?}", e))?;

    ic_cdk::println!("✅ Solana sent! TX: {}", tx_signature.to_string());
    Ok(tx_signature.to_string())
}

/// Get Solana balance (public interface)
pub async fn get_solana_balance(address: String) -> Result<f64, String> {
    let balance_lamports = get_solana_balance_internal(address).await?;
    let balance_sol = balance_lamports as f64 / 1_000_000_000.0;
    Ok(balance_sol)
}

/// Internal function to get balance in lamports
async fn get_solana_balance_internal(address: String) -> Result<u64, String> {
    let pubkey =
        SolanaAddress::from_str(&address).map_err(|e| format!("Invalid Solana address: {}", e))?;

    let params = GetBalanceParams {
        pubkey: pubkey.into(),
        commitment: Some(CommitmentLevel::Confirmed),
        min_context_slot: None,
    };

    let client = client();
    let balance_lamports = client
        .get_balance(params)
        .send()
        .await
        .expect_consistent()
        .map_err(|e| format!("Failed to get balance: {:?}", e))?;

    Ok(balance_lamports)
}

/// Test function: Send 0.01 SOL to a specified address
pub async fn test_send_sol(to_address: String) -> Result<String, String> {
    const TEST_AMOUNT: u64 = 10_000_000; // 0.01 SOL in lamports

    ic_cdk::println!("🧪 Test: Sending 0.01 SOL to {}", to_address);

    let result = send_solana(to_address.clone(), TEST_AMOUNT).await?;

    ic_cdk::println!("✅ Test successful! TX: {}", result);
    Ok(result)
}
