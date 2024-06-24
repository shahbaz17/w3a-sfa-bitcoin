import ecc from "@bitcoinerlab/secp256k1";
import ECPairFactory from "ecpair";
import { networks, payments } from "bitcoinjs-lib";
import * as bitcoin from "bitcoinjs-lib";
import { IProvider } from "@web3auth/base";
import { useEffect, useState } from "react";
import axios from "axios";

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

interface BitcoinComponentParams {
  provider: IProvider;
}

export const BitcoinComponent = (props: BitcoinComponentParams) => {
  const network = networks.testnet;
  const [pk, setPk] = useState<any>("");
  const [, setOutput] = useState<any>("");

  useEffect(() => {
    const getPrivateKey = async () => {
      try {
        const privateKey = await props.provider.request({
          method: "eth_private_key",
        });
        setPk(privateKey);
      } catch (error: unknown) {
        setPk("");
      }
    };
    getPrivateKey();
  }, [props.provider]);

  function getAddress(mode: string, network: networks.Network): any {
    // const privateKey =
    //   "141398f8c214a542a4b00e94832b1968a1f0f1fd1abe81190a01d066faf8f965";
    const keyPair = ECPair.fromPrivateKey(Buffer.from(pk, "hex"));
    let bufPubKey = keyPair.publicKey;
    if (mode === "btc") {
      return payments.p2pkh({ pubkey: bufPubKey, network }).address;
    } else if (mode === "segwit") {
      return payments.p2wpkh({ pubkey: bufPubKey, network }).address;
    } else if (mode === "tapRoot") {
      const xOnlyPubKey = bufPubKey.slice(1, 33);
      const tweakedChildNode = keyPair.tweak(
        bitcoin.crypto.taggedHash("TapTweak", xOnlyPubKey)
      );
      return payments.p2tr({
        pubkey: Buffer.from(tweakedChildNode.publicKey.slice(1, 33)),
        network: networks.testnet,
      });
    } else {
      return undefined;
    }
  }

  function uiConsole(...args: any[]): void {
    const el = document.querySelector("#bit-console>p");
    if (el) {
      el.innerHTML = JSON.stringify(args || {}, null, 2);
    }
  }

  async function fetchUtxos(address: string) {
    const response = await axios.get(
      `https://blockstream.info/testnet/api/address/${address}/utxo`
    );
    return response.data;
  }

  async function sendTaprootTransaction() {
    const keyPair = ECPair.fromPrivateKey(Buffer.from(pk, "hex"), {
      network,
      compressed: true,
    });
    const bufPubKey = keyPair.publicKey;
    const xOnlyPubKey = bufPubKey.slice(1, 33);
    const tweakedChildNode = keyPair.tweak(
      bitcoin.crypto.taggedHash("TapTweak", xOnlyPubKey)
    );
    const account = payments.p2tr({
      pubkey: Buffer.from(tweakedChildNode.publicKey.slice(1, 33)),
      network: networks.testnet,
    });
    const utxos = await fetchUtxos(account.address as string);
    const utxo = utxos[0];
    console.log("utxos: ", utxos);
    const amount = utxo.value;
    const sendAmount = amount - 1400;

    const psbt = new bitcoin.Psbt({ network })
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
    console.log("Inputs count", psbt.inputCount);
    psbt.signInput(0, tweakedChildNode);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();
    console.log("txHex: ", txHex);
    const response = await axios.post(
      `https://blockstream.info/testnet/api/tx`,
      txHex
    );
    return response.data;
  }

  return (
    <>
      <h1>Bitcoin Component</h1>
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
              const { address, output } = getAddress("tapRoot", network);
              setOutput(output);
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
              // const hash = sendTransaction();
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
