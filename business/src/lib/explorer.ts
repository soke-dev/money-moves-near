/**
 * A transaction on its network's explorer, by the network's name as payments
 * carry it ("Monad", "BNB Chain"). The hash may come as "<hash>:<log index>",
 * the way a transfer is recorded: only the hash goes in the link.
 */
const AT: Record<string, string> = {
  Monad: 'https://monadscan.com/tx/',
  Base: 'https://basescan.org/tx/',
  'BNB Chain': 'https://bscscan.com/tx/',
  Arbitrum: 'https://arbiscan.io/tx/',
  Optimism: 'https://optimistic.etherscan.io/tx/',
  Ethereum: 'https://etherscan.io/tx/',
  Solana: 'https://solscan.io/tx/',
  Movement: 'https://explorer.movementnetwork.xyz/txn/',
  Arc: 'https://explorer.arc.io/tx/',
  Stellar: 'https://stellar.expert/explorer/public/tx/',
  TON: 'https://tonviewer.com/transaction/',
}

/** Just the hash, without a log index after it. */
export const bareTx = (hash: string) => hash.split(':')[0] ?? hash

export function explorerTxUrl(network: string | null | undefined, hash: string | null | undefined): string | null {
  if (!network || !hash) return null
  const base = AT[network]
  if (!base) return null
  const h = bareTx(hash)
  return base + h + (network === 'Movement' ? '?network=mainnet' : '')
}
