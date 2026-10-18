module move2_ledger::savings_vault {
    use std::signer;
    use std::vector;
    use aptos_framework::account;
    use aptos_framework::timestamp;
    use aptos_framework::event;
    use aptos_framework::object;
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::primary_fungible_store;

    const ENOT_ADMIN: u64 = 1;
    const EALREADY_INITIALIZED: u64 = 2;
    const ENOT_INITIALIZED: u64 = 3;
    const EFEE_TOO_HIGH: u64 = 4;
    const ELOCK_TOO_FAR: u64 = 5;
    const ELOCK_IN_PAST: u64 = 6;
    const ELOCK_NOT_FOUND: u64 = 7;
    const ENOT_LOCK_OWNER: u64 = 8;
    const ELOCK_NOT_EXPIRED: u64 = 9;
    const ELOCK_EXPIRED: u64 = 10;
    const EZERO_AMOUNT: u64 = 11;
    const EUNSUPPORTED_TOKEN: u64 = 12;

    const MAX_FEE_BPS: u64 = 500;
    const SIX_MONTHS_SECS: u64 = 15552000;
    const BPS_DENOMINATOR: u64 = 10000;

    const USDC_ADDRESS: address = @0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39;
    const USDT_ADDRESS: address = @0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d;

    struct VaultConfig has key {
        admin: address,
        fee_wallet: address,
        fee_bps: u64,
        vault_signer_cap: account::SignerCapability,
        vault_address: address,
    }

    struct LockRecord has store, copy, drop {
        lock_id: u64,
        owner: address,
        fa_address: address,
        amount: u64,
        unlock_timestamp: u64,
        created_at: u64,
    }

    struct UserLockStore has key {
        locks: vector<LockRecord>,
        lock_count: u64,
    }

    #[event]
    struct VaultInitialized has drop, store {
        admin: address,
        fee_wallet: address,
        fee_bps: u64,
        vault_address: address,
    }

    #[event]
    struct FeeUpdated has drop, store {
        new_fee_wallet: address,
        new_fee_bps: u64,
    }

    #[event]
    struct LockCreated has drop, store {
        owner: address,
        lock_id: u64,
        fa_address: address,
        amount: u64,
        fee_amount: u64,
        unlock_timestamp: u64,
    }

    #[event]
    struct LockAdded has drop, store {
        owner: address,
        lock_id: u64,
        added_amount: u64,
        fee_amount: u64,
        new_total: u64,
    }

    #[event]
    struct LockWithdrawn has drop, store {
        owner: address,
        lock_id: u64,
        amount: u64,
    }

    public entry fun initialize(
        admin: &signer,
        fee_wallet: address,
        fee_bps: u64,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(admin_addr == @move2_ledger, ENOT_ADMIN);
        assert!(!exists<VaultConfig>(@move2_ledger), EALREADY_INITIALIZED);
        assert!(fee_bps <= MAX_FEE_BPS, EFEE_TOO_HIGH);

        let (vault_signer, vault_signer_cap) = account::create_resource_account(admin, b"savings_vault_v1");
        let vault_addr = signer::address_of(&vault_signer);

        move_to(admin, VaultConfig {
            admin: admin_addr,
            fee_wallet,
            fee_bps,
            vault_signer_cap,
            vault_address: vault_addr,
        });

        event::emit(VaultInitialized {
            admin: admin_addr,
            fee_wallet,
            fee_bps,
            vault_address: vault_addr,
        });
    }

    public entry fun update_fee(
        admin: &signer,
        new_fee_wallet: address,
        new_fee_bps: u64,
    ) acquires VaultConfig {
        assert!(exists<VaultConfig>(@move2_ledger), ENOT_INITIALIZED);
        let config = borrow_global_mut<VaultConfig>(@move2_ledger);
        assert!(signer::address_of(admin) == config.admin, ENOT_ADMIN);
        assert!(new_fee_bps <= MAX_FEE_BPS, EFEE_TOO_HIGH);

        config.fee_wallet = new_fee_wallet;
        config.fee_bps = new_fee_bps;

        event::emit(FeeUpdated {
            new_fee_wallet,
            new_fee_bps,
        });
    }

    public entry fun create_lock(
        user: &signer,
        fa_address: address,
        amount: u64,
        unlock_timestamp: u64,
    ) acquires VaultConfig, UserLockStore {
        assert!(exists<VaultConfig>(@move2_ledger), ENOT_INITIALIZED);
        assert!(amount > 0, EZERO_AMOUNT);
        assert!(fa_address == USDC_ADDRESS || fa_address == USDT_ADDRESS, EUNSUPPORTED_TOKEN);

        let now = timestamp::now_seconds();
        assert!(unlock_timestamp > now, ELOCK_IN_PAST);
        assert!(unlock_timestamp <= now + SIX_MONTHS_SECS, ELOCK_TOO_FAR);

        let fee_amount;
        let deposit_amount;
        let fee_wallet;
        let vault_addr;
        {
            let config = borrow_global<VaultConfig>(@move2_ledger);
            fee_amount = (amount * config.fee_bps) / BPS_DENOMINATOR;
            deposit_amount = amount - fee_amount;
            fee_wallet = config.fee_wallet;
            vault_addr = config.vault_address;
        };

        let fa_metadata = object::address_to_object<Metadata>(fa_address);

        if (fee_amount > 0) {
            primary_fungible_store::transfer(user, fa_metadata, fee_wallet, fee_amount);
        };
        primary_fungible_store::transfer(user, fa_metadata, vault_addr, deposit_amount);

        let user_addr = signer::address_of(user);

        if (!exists<UserLockStore>(user_addr)) {
            move_to(user, UserLockStore {
                locks: vector::empty<LockRecord>(),
                lock_count: 0,
            });
        };

        let store = borrow_global_mut<UserLockStore>(user_addr);
        store.lock_count = store.lock_count + 1;
        let lock_id = store.lock_count;

        vector::push_back(&mut store.locks, LockRecord {
            lock_id,
            owner: user_addr,
            fa_address,
            amount: deposit_amount,
            unlock_timestamp,
            created_at: now,
        });

        event::emit(LockCreated {
            owner: user_addr,
            lock_id,
            fa_address,
            amount: deposit_amount,
            fee_amount,
            unlock_timestamp,
        });
    }

    public entry fun add_to_lock(
        user: &signer,
        lock_id: u64,
        amount: u64,
    ) acquires VaultConfig, UserLockStore {
        assert!(exists<VaultConfig>(@move2_ledger), ENOT_INITIALIZED);
        assert!(amount > 0, EZERO_AMOUNT);

        let user_addr = signer::address_of(user);
        assert!(exists<UserLockStore>(user_addr), ELOCK_NOT_FOUND);

        let now = timestamp::now_seconds();

        // Phase 1: find lock, validate, extract needed data
        let lock_index;
        let fa_address;
        {
            let store = borrow_global<UserLockStore>(user_addr);
            let i = 0u64;
            let len = vector::length(&store.locks);
            let found_index = len;
            while (i < len) {
                let lock = vector::borrow(&store.locks, i);
                if (lock.lock_id == lock_id) {
                    found_index = i;
                };
                i = i + 1;
            };
            assert!(found_index < len, ELOCK_NOT_FOUND);
            let lock = vector::borrow(&store.locks, found_index);
            assert!(lock.owner == user_addr, ENOT_LOCK_OWNER);
            assert!(lock.unlock_timestamp > now, ELOCK_EXPIRED);
            lock_index = found_index;
            fa_address = lock.fa_address;
        };

        // Phase 2: compute fee and vault address from config
        let fee_amount;
        let deposit_amount;
        let fee_wallet;
        let vault_addr;
        {
            let config = borrow_global<VaultConfig>(@move2_ledger);
            fee_amount = (amount * config.fee_bps) / BPS_DENOMINATOR;
            deposit_amount = amount - fee_amount;
            fee_wallet = config.fee_wallet;
            vault_addr = config.vault_address;
        };

        // Phase 3: transfer funds
        let fa_metadata = object::address_to_object<Metadata>(fa_address);
        if (fee_amount > 0) {
            primary_fungible_store::transfer(user, fa_metadata, fee_wallet, fee_amount);
        };
        primary_fungible_store::transfer(user, fa_metadata, vault_addr, deposit_amount);

        // Phase 4: update lock record
        let store_mut = borrow_global_mut<UserLockStore>(user_addr);
        let lock_mut = vector::borrow_mut(&mut store_mut.locks, lock_index);
        lock_mut.amount = lock_mut.amount + deposit_amount;

        event::emit(LockAdded {
            owner: user_addr,
            lock_id,
            added_amount: deposit_amount,
            fee_amount,
            new_total: lock_mut.amount,
        });
    }

    public entry fun withdraw(
        user: &signer,
        lock_id: u64,
    ) acquires VaultConfig, UserLockStore {
        assert!(exists<VaultConfig>(@move2_ledger), ENOT_INITIALIZED);

        let user_addr = signer::address_of(user);
        assert!(exists<UserLockStore>(user_addr), ELOCK_NOT_FOUND);

        let now = timestamp::now_seconds();

        // Phase 1: find and validate lock, extract data
        let lock_index;
        let withdrawn_amount;
        let lock_fa_address;
        {
            let store = borrow_global<UserLockStore>(user_addr);
            let i = 0u64;
            let len = vector::length(&store.locks);
            let found_index = len;
            while (i < len) {
                let lock = vector::borrow(&store.locks, i);
                if (lock.lock_id == lock_id) {
                    found_index = i;
                };
                i = i + 1;
            };
            assert!(found_index < len, ELOCK_NOT_FOUND);
            let lock = vector::borrow(&store.locks, found_index);
            assert!(lock.owner == user_addr, ENOT_LOCK_OWNER);
            assert!(now >= lock.unlock_timestamp, ELOCK_NOT_EXPIRED);
            lock_index = found_index;
            withdrawn_amount = lock.amount;
            lock_fa_address = lock.fa_address;
        };

        // Phase 2: remove the lock record
        {
            let store_mut = borrow_global_mut<UserLockStore>(user_addr);
            vector::remove(&mut store_mut.locks, lock_index);
        };

        // Phase 3: transfer funds from vault to user
        let vault_signer;
        {
            let config = borrow_global<VaultConfig>(@move2_ledger);
            vault_signer = account::create_signer_with_capability(&config.vault_signer_cap);
        };

        let fa_metadata = object::address_to_object<Metadata>(lock_fa_address);
        primary_fungible_store::transfer(&vault_signer, fa_metadata, user_addr, withdrawn_amount);

        event::emit(LockWithdrawn {
            owner: user_addr,
            lock_id,
            amount: withdrawn_amount,
        });
    }

    // View functions

    #[view]
    public fun get_config(): (address, address, u64, address) acquires VaultConfig {
        if (!exists<VaultConfig>(@move2_ledger)) {
            return (@0x0, @0x0, 0, @0x0)
        };
        let c = borrow_global<VaultConfig>(@move2_ledger);
        (c.admin, c.fee_wallet, c.fee_bps, c.vault_address)
    }

    #[view]
    public fun get_user_locks(user: address): vector<LockRecord> acquires UserLockStore {
        if (!exists<UserLockStore>(user)) {
            return vector::empty<LockRecord>()
        };
        borrow_global<UserLockStore>(user).locks
    }

    #[view]
    public fun get_lock(user: address, lock_id: u64): (bool, u64, address, u64, u64, u64) acquires UserLockStore {
        if (!exists<UserLockStore>(user)) {
            return (false, 0, @0x0, 0, 0, 0)
        };
        let store = borrow_global<UserLockStore>(user);
        let i = 0u64;
        let len = vector::length(&store.locks);
        while (i < len) {
            let lock = vector::borrow(&store.locks, i);
            if (lock.lock_id == lock_id) {
                return (true, lock.lock_id, lock.fa_address, lock.amount, lock.unlock_timestamp, lock.created_at)
            };
            i = i + 1;
        };
        (false, 0, @0x0, 0, 0, 0)
    }

    #[view]
    public fun get_user_lock_count(user: address): u64 acquires UserLockStore {
        if (!exists<UserLockStore>(user)) { return 0 };
        borrow_global<UserLockStore>(user).lock_count
    }
}
