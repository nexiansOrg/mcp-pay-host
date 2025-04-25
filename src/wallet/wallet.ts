import { mnemonicToAccount, HDAccount } from 'viem/accounts';
import { Address } from 'viem';
import * as dotenv from 'dotenv';

// Load .env file if present
dotenv.config();

const USER_MNEMONIC = process.env.USER_MNEMONIC;

let payerAccount: HDAccount | undefined;
let payerAddress: Address | undefined;

if (!USER_MNEMONIC) {
    console.warn(
        '⚠️ USER_MNEMONIC environment variable not set. Cannot determine payer address. \n' +
        'Payment-required MCP calls will fail. Please set a valid mnemonic.'
    );
} else {
    try {
        payerAccount = mnemonicToAccount(USER_MNEMONIC);
        if (payerAccount) {
            payerAddress = payerAccount.address;
            console.log(`👤 Using payer wallet address: ${payerAddress}`);
        } else {
            console.error('❌ Failed to derive account from USER_MNEMONIC. mnemonicToAccount returned undefined.');
        }
    } catch (error) {
        console.error(
            '❌ Failed to derive account from USER_MNEMONIC. Please check if it is valid:', 
            error
        );
    }
}

/**
 * Gets the derived payer wallet address.
 * @returns The address string (0x...) or undefined if mnemonic was not set or invalid.
 */
export function getPayerAddress(): Address | undefined {
    return payerAddress;
}

/**
 * Signs a given message payload using the derived payer account.
 * Throws an error if the payer account is not available.
 * @param message The message string to sign.
 * @returns A promise that resolves with the signature hex string.
 */
export async function signPayload(message: string): Promise<`0x${string}`> {
    if (!payerAccount) {
        throw new Error('Payer account is not initialized. Cannot sign message.');
    }
    try {
        const signature = await payerAccount.signMessage({ message });
        return signature;
    } catch (error) {
        console.error('Error signing message:', error);
        throw new Error('Failed to sign message with payer account.');
    }
}

// Potentially add functions here later to sign transactions if needed 