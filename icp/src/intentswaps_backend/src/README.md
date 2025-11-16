# Intentional Swaps Backend - Code Organization

## File Structure

```
src/
├── lib.rs           # Main entry point - exports public API and query functions
├── types.rs         # Type definitions (Order, OrderStatus, Chain, etc.)
├── storage.rs       # Storage management and query helper functions
├── bitcoin.rs       # Bitcoin-specific operations (signing, sending, verification)
├── solana.rs        # Solana-specific operations (signing, sending, verification)
└── orders.rs        # Order management (create, accept, deposit, reveal, refund)
```

## Module Responsibilities

### `lib.rs` (Main Entry Point)
- Declares all modules
- Re-exports types for Candid interface
- Exposes public API functions as ic_cdk update/query endpoints
- Minimal logic - mostly delegation to other modules

### `types.rs` (Data Structures)
- **OrderStatus**: Enum for order lifecycle states
- **Chain**: Bitcoin or Solana
- **OrderRequest**: User input for creating orders
- **Order**: Complete order data structure
- **OrderInfo**: Public view of order (returned by queries)
- **CanisterAddresses**: Bitcoin and Solana addresses for deposits

### `storage.rs` (State Management)
- Thread-local storage for orders and canister addresses
- Helper functions for querying orders:
  - `get_pending_orders()` - Orders awaiting resolver
  - `get_expired_orders()` - Orders needing refunds
  - `get_order()` - Single order lookup
  - `get_my_orders()` - User's orders
- ID generation for new orders

### `bitcoin.rs` (Bitcoin Operations)
- **Constants**: `BITCOIN_NETWORK`, `ECDSA_KEY_NAME`
- **Key Management**:
  - `get_canister_public_key()` - Get threshold ECDSA key
  - `public_key_to_p2wpkh_address()` - Convert to SegWit address
- **Transaction Building**:
  - `select_utxos()` - Choose UTXOs for transaction
  - `sign_p2wpkh_transaction()` - Sign with threshold ECDSA
  - `send_bitcoin()` - Build, sign, and broadcast BTC transaction
- **Verification**:
  - `verify_bitcoin_transaction()` - Confirm deposits
  - `get_bitcoin_balance()` - Check address balance

### `solana.rs` (Solana Operations)
- **Constants**: `ED25519_KEY_ID`, `SOLANA_CLUSTER`
- **RPC Client**:
  - `client()` - Configure SOL RPC client with consensus strategy
- **Transaction Operations**:
  - `send_solana()` - Build, sign, and send SOL transaction
  - Uses `get_pubkey()` from sol_rpc_client for Ed25519 keys
  - Uses `sign_message()` for threshold Ed25519 signing
- **Verification**:
  - `verify_solana_transaction()` - Confirm deposits
  - `get_solana_balance()` - Check address balance

### `orders.rs` (Order Lifecycle)
- **Order Creation**: `create_order()` - Initialize new swap
- **Deposit Phase**:
  - `confirm_deposit()` - Creator confirms deposit
  - `accept_order()` - Resolver accepts order
  - `confirm_resolver_deposit()` - Resolver confirms deposit
- **Completion**: `reveal_secret()` - Execute atomic swap
- **Refunds**:
  - `cancel_order()` - Creator cancels before resolver deposits
  - `process_refund()` - Process refunds for expired orders
  - `process_refund_internal()` - Internal refund logic
- **Address Management**: `get_canister_addresses()` - Get/initialize addresses

## Data Flow

### Creating an Order
```
User → create_order() → Order stored → Canister addresses returned
                     ↓
              storage::ORDERS
```

### Deposit Flow
```
User sends BTC/SOL → confirm_deposit() → verify_bitcoin/solana_transaction()
                                      ↓
                               Order status updated
```

### Atomic Swap Execution
```
reveal_secret() → Verify secret hash
               ↓
      Send from_chain to resolver (bitcoin::send_bitcoin or solana::send_solana)
               ↓
      Send to_chain to creator (bitcoin::send_bitcoin or solana::send_solana)
               ↓
      Order marked as Completed
```

### Refund Processing
```
cancel_order() or process_refund() → process_refund_internal()
                                   ↓
                    Send deposits back to original addresses
                                   ↓
                           Order marked as Cancelled
```

## Key Design Patterns

1. **Separation of Concerns**: Each blockchain has its own module
2. **Reusable Components**: Common operations (signing, sending) are separate functions
3. **Type Safety**: Strong typing with enums for order status and chains
4. **Error Handling**: Result types throughout with descriptive error messages
5. **Modularity**: Easy to add new blockchains by creating a new module

## Testing & Development

To add support for a new blockchain:
1. Create a new module (e.g., `ethereum.rs`)
2. Implement: `send_X()`, `verify_X_transaction()`, `get_X_balance()`
3. Add chain variant to `types::Chain` enum
4. Update `orders.rs` match statements for the new chain

## Dependencies

- **Bitcoin**: `bitcoin` crate + ICP ECDSA API
- **Solana**: `sol_rpc_client` + ICP Ed25519 API
- **ICP**: `ic-cdk` for canister APIs
- **Serialization**: `candid`, `serde`
