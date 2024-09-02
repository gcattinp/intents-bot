import { Telegraf } from 'telegraf';
import { createPublicClient, createWalletClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import { base } from 'viem/chains';
import { erc20Abi, maxUint256 } from 'viem';
import { ieBaseAbi } from './ieBaseAbi';

// Load environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const RPC_URL = process.env.RPC_URL;

// Contract address (public information)
const CONTRACT_ADDRESS = '0x1e00cE4800dE0D0000640070006dfc5F93dD0ff9' as `0x${string}`;
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`;

// Check if environment variables are set
if (!BOT_TOKEN || !RPC_URL) {
  console.error('Please set BOT_TOKEN and RPC_URL in your .env file');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// In-memory storage for user private keys (for demo purposes)
const userAccounts: { [key: number]: `0x${string}` } = {};

// Create Viem clients
const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

// Helper function to convert BigInt values in an object to strings
function convertBigIntToString(obj: any): any {
  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  } else if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, convertBigIntToString(value)])
    );
  }
  return obj;
}

// Function to interact with the Intents Engine
async function interactWithIntentsEngine(privateKey: `0x${string}`, intentString: string): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

  try {
    // Step 1: Preview the command
    const preview = await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: ieBaseAbi,
      functionName: 'previewCommand',
      args: [intentString],
    });

    let value = 0n;
    const token = (preview as any)[3]; // Assuming token is at index 3 in the preview response

    if (token === ETH_ADDRESS) {
      // Sending ETH directly
      value = (preview as any)[1]; // Assuming amount is at index 1 in the preview response
    } else {
      // Step 2: Handle token approval if necessary
      const allowance = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account.address, CONTRACT_ADDRESS],
      });

      if (allowance < (preview as any)[1]) {
        // If allowance is less than the amount to be transferred, approve the contract to spend tokens
        const approveTxHash = await walletClient.writeContract({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [CONTRACT_ADDRESS, maxUint256],
        });

        // Wait for the approval transaction to be confirmed
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      }
    }

    // Step 3: Execute the command
    const commandTxHash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: ieBaseAbi,
      functionName: 'command',
      value,
      args: [intentString],
    });

    // Step 4: Wait for the transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: commandTxHash,
    });

    // Convert BigInt values to strings before serializing
    const previewString = JSON.stringify(convertBigIntToString(preview));

    // Generate a BaseScan link for the transaction
    const baseScanLink = `https://basescan.org/tx/${receipt.transactionHash}`;

    return `Preview: ${previewString}\nTransaction successful: ${receipt.transactionHash}\nView on BaseScan: ${baseScanLink}`;
  } catch (error) {
    if (error instanceof Error) {
      return `Error: ${error.message}`;
    }
    return 'An unknown error occurred';
  }
}

// Function to create a new Ethereum account
function createEOA(): { address: `0x${string}`; privateKey: `0x${string}` } {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAddress(privateKey);
  return { address, privateKey };
}

// Handle /start command
bot.command('start', (ctx) => {
  ctx.reply('Welcome! Use /createaccount to generate a new Ethereum account.');
});

// Handle /createaccount command
bot.command('createaccount', (ctx) => {
  const chatId = ctx.chat.id;
  const account = createEOA();
  userAccounts[chatId] = account.privateKey;
  ctx.reply(`New account created!\nAddress: ${account.address}\n`);
});

// Handle natural language intents
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  // Ignore commands
  if (text.startsWith('/')) return;

  if (!userAccounts[chatId]) {
    ctx.reply('Please create an account first using /createaccount');
    return;
  }

  await ctx.reply('Processing your request...');
  const result = await interactWithIntentsEngine(userAccounts[chatId], text);
  await ctx.reply(result);
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply('An error occurred while processing your request.');
});

// Start the bot
bot.launch().then(() => {
  console.log('Bot is running...');
}).catch((error) => {
  console.error('Failed to start the bot:', error);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
