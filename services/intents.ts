import { api } from "./api";

export interface IntentsDepositQuote {
  depositAddress: string;
  amountIn: string;
  sourceSymbol: string;
  sourceChain: string;
  deadline: string;
  amountOutEstimate: string | null;
  timeEstimateSeconds: number | null;
}

export async function createIntentsDepositQuote(data: {
  source: string;
  amount: string;
}): Promise<IntentsDepositQuote> {
  const res = await api.post("/intents/deposit/quote", data);
  return res.data;
}
