import ecc from "@bitcoinerlab/secp256k1";
import ECPairFactory from "ecpair";
import { Psbt, networks, payments, crypto, initEccLib } from "bitcoinjs-lib";
import { IProvider } from "@web3auth/base";
import { useEffect, useState } from "react";
import axios from "axios";

const ECPair = ECPairFactory(ecc);
initEccLib(ecc);

interface BitcoinComponentParams {
  provider: IProvider;
}

export const BitcoinComponent = ({ provider }: BitcoinComponentParams) => {
  const network = networks.testnet;
  const [pk, setPk] = useState<string>("");

  useEffect(() => {
    const getPrivateKey = async () => {
      try {
        const privateKey = await provider.request({
          method: "eth_private_key",
        });
        setPk(privateKey as string);
      } catch (error) {
        console.error("Error getting private key:", error);
        setPk("");
      }
    };
    getPrivateKey();
  }, [provider]);

  const getAddress = (
    mode: string,
    network: networks.Network
  ): string | undefined => {
    const keyPair = ECPair.fromPrivateKey(Buffer.from(pk, "hex"));
    const bufPubKey = keyPair.publicKey;

    switch (mode) {
      case "btc":
        return payments.p2pkh({ pubkey: bufPubKey, network }).address;
      case "segwit":
        return payments.p2wpkh({ pubkey: bufPubKey, network }).address;
      case "tapRoot":
        const xOnlyPubKey = bufPubKey.subarray(1, 33);
        const tweakedChildNode = keyPair.tweak(
          crypto.taggedHash("TapTweak", xOnlyPubKey)
        );
        return payments.p2tr({
          pubkey: Buffer.from(tweakedChildNode.publicKey.subarray(1, 33)),
          network,
        }).address;
      default:
        return undefined;
    }
  };

  const uiConsole = (...args: any[]): void => {
    const el = document.querySelector("#bit-console>p");
    if (el) {
      el.innerHTML = JSON.stringify(args || {}, null, 2);
    }
  };

  const fetchUtxos = async (address: string) => {
    try {
      const response = await axios.get(
        `https://blockstream.info/testnet/api/address/${address}/utxo`
      );
      return response.data.filter(
        (utxo: { status: { confirmed: boolean } }) => utxo.status.confirmed
      );
    } catch (error) {
      console.error("Error fetching UTXOs:", error);
      return [];
    }
  };

  const sendTaprootTransaction = async () => {
    const keyPair = ECPair.fromPrivateKey(Buffer.from(pk, "hex"), {
      network,
      compressed: true,
    });
    const bufPubKey = keyPair.publicKey;
    const xOnlyPubKey = bufPubKey.subarray(1, 33);
    const tweakedChildNode = keyPair.tweak(
      crypto.taggedHash("TapTweak", xOnlyPubKey)
    );
    const account = payments.p2tr({
      pubkey: Buffer.from(tweakedChildNode.publicKey.subarray(1, 33)),
      network,
    });

    const utxos = await fetchUtxos(account.address as string);
    console.log("utxos: ", utxos);

    if (utxos.length === 0) {
      uiConsole("No confirmed UTXOs found");
      return;
    }

    const utxo = utxos[0];
    const amount = utxo.value;

    const feeResponse = await axios.get(
      "https://blockstream.info/testnet/api/fee-estimates"
    );
    const maxFee = Math.max(...(Object.values(feeResponse.data) as number[]));
    const fee = maxFee * 1.2;

    if (amount <= fee) {
      const errorMsg = `Insufficient funds: ${amount} <= ${fee}`;
      uiConsole(errorMsg);
      throw new Error(errorMsg);
    }

    const sendAmount = amount - fee;

    const psbt = new Psbt({ network })
      .addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          value: utxo.value,
          script: account.output!,
        },
        tapInternalKey: xOnlyPubKey,
      })
      .addOutput({
        value: sendAmount,
        address:
          "tb1p8e2gdm52a8rljvsc6zdaja37srtp7wtsmsn73mmusfu2r8zh232sa8cyfl",
      });

    psbt.signInput(0, tweakedChildNode);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    try {
      const response = await axios.post(
        `https://blockstream.info/testnet/api/tx`,
        txHex
      );
      return response.data;
    } catch (error) {
      console.error("Error sending transaction:", error);
      uiConsole("Error sending transaction", error);
      throw error;
    }
  };

  return (
    <>
      <h1>Bitcoin Functions</h1>
      <div className="flex-container">
        <div>
          <button
            onClick={() => {
              const btcAddress = getAddress("btc", network);
              uiConsole("BTC Address: ", btcAddress);
            }}
            className="card"
          >
            Get Legacy BTC Address
          </button>
        </div>
        <div>
          <button
            onClick={() => {
              const segwitAddress = getAddress("segwit", network);
              uiConsole("Segwit Address: ", segwitAddress);
            }}
            className="card"
          >
            Get Segwit Address
          </button>
        </div>
        <div>
          <button
            onClick={async () => {
              const address = getAddress("tapRoot", network);
              uiConsole("Taproot Address: ", address);
            }}
            className="card"
          >
            Get Taproot Address
          </button>
        </div>
        <div>
          <button
            onClick={async () => {
              const data = await sendTaprootTransaction();
              uiConsole("Response Data: ", data);
            }}
            className="card"
          >
            Send TapRoot Transaction
          </button>
        </div>
      </div>
      <div id="bit-console" style={{ whiteSpace: "pre-line" }}>
        <p style={{ whiteSpace: "pre-line" }}></p>
      </div>
    </>
  );
};
