import logo from './ProxyQuarry.png';
import './App.css';
import { useState } from 'react';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, Token, AccountLayout } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js'
import {
  BN, Program, Provider, web3, utils
} from '@project-serum/anchor';
import idl from './idl.json';

import { getPhantomWallet } from '@solana/wallet-adapter-wallets';
import { useWallet, WalletProvider, ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { sign } from 'tweetnacl';

require ("@solana/wallet-adapter-react-ui/styles.css");


const wallets = [
  getPhantomWallet()
]

const { Keypair } = web3;

const opts = {
  preflightCommitment: "processed"
}
const programID = new PublicKey(idl.metadata.address);
const quarry_mine_program = new PublicKey('QMNeHCGYnLVDn1icRAfQZpjPLBNkfGbSKRB83G5d8KB');


async function createATAModified(mintKey, ownerKey, associatedAddress, provider, wallet) {
  const recentBlockHash = await provider.connection.getRecentBlockhash();
  const tx = new web3.Transaction({
    recentBlockhash: recentBlockHash.blockhash,
    feePayer: wallet.publicKey
  });
  tx.add(Token.createAssociatedTokenAccountInstruction(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mintKey, // mint
    associatedAddress, // generated address
    ownerKey, // authority
    wallet.publicKey, // payer.. does owner have to be payer
  ));
  const signature = await wallet.signTransaction(tx);
  tx.addSignature(wallet.publicKey, signature.signatures[0].signature);
  return web3.sendAndConfirmRawTransaction(provider.connection, tx.serialize());
}

function App() {
  const [values, setValues] = useState({
    quarry: '',
    rewarder: '',
    token_mint: '',
    quarry_mine: '',
    token_account: '',
    amt: '',
  })

  const [statusMsg, setStatusMsg] = useState('');

  const [submitted, setSubmitted] = useState(false);
  const [valid, setValid] = useState(false);
  
  const wallet = useWallet();

  const handleQuarryInputChange = (e) => {
    e.persist();
    setValues((values) => ({
      ...values,
      quarry: e.target.value,
    }));
  };

  const handleRewarderInputChange = (e) => {
    e.persist();
    setValues((values) => ({
      ...values,
      rewarder: e.target.value,
    }));
  };

  const handleTokenMintInputChange = (e) => {
    e.persist();
    setValues((values) => ({
      ...values,
      token_mint: e.target.value,
    }));
  };

  const handleQuarryMineInputChange = (e) => {
    e.persist();
    setValues((values) => ({
      ...values,
      quarry_mine: e.target.value,
    }));
  };

  const handleTokenAccountInputChange = (e) => {
    e.persist();
    setValues((values) => ({
      ...values,
      token_account: e.target.value,
    }));
  };

  const handleAmtInputChange = (e) => {
    e.persist();
    setValues((values) => ({
      ...values,
      amt: e.target.value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log(wallet);
    if (
      values.quarry !== '' && 
      values.rewarder !== '' && 
      values.token_mint !== '' && 
      values.token_account !== '' &&
      values.quarry_mine !== '' &&
      values.amt !== '' && 
      wallet.connected) {
      
      setStatusMsg('Running command..');
      // set State stuff here
      setValid(true);
      setSubmitted(true);

      const provider = await getProvider();
      const quarry = new PublicKey(values.quarry);
      const rewarder = new PublicKey(values.rewarder);
      const token_mint = new PublicKey(values.token_mint);
      const token_account = new PublicKey(values.token_account);
      const quarry_mine = new PublicKey(values.quarry_mine);

      const tokenMint = new Token(
        provider.connection,
        token_mint,
        TOKEN_PROGRAM_ID,
        wallet.publicKey,
      );

      // run transactions
      const miner_addresses = await generateMinerAddresses(provider, quarry, tokenMint.publicKey);
      const stakeProgram = new Program(idl, programID, provider);
      
      if (!await provider.connection.getAccountInfo(miner_addresses.miner)) {
        setStatusMsg("No miner found for the specific token... generating proxy miner account now..");

        await createProxyMiner(
          stakeProgram, 
          miner_addresses.miner, 
          miner_addresses.miner_authority, 
          quarry, 
          rewarder, 
          tokenMint.publicKey, 
          miner_addresses.miner_vault
        );
      }

      setStatusMsg("Creating temp token account to transfer to proxy miner");
      const tempToken = await createTempToken(
        values.amt, 
        token_mint, 
        token_account
      );
      
      setStatusMsg("Staking tokens to miner account");
      await stakeToken(
        miner_addresses.miner_authority, 
        quarry, 
        tempToken, 
        miner_addresses.miner_vault, 
        miner_addresses.miner, 
        rewarder, 
        stakeProgram,
        values.amt,
        miner_addresses.nonce
      );
    }
  }

  async function stakeToken(miner_authority, quarry, tempTokenAcct, miner_vault, miner, rewarder_key, stakeProgram, amt, nonce) {
      const accts = {
        minerAuthority: miner_authority,
        quarry,
        user: wallet.publicKey,
        tempToken: tempTokenAcct.publicKey,
        minerVault: miner_vault,
        miner,
        rewarder: rewarder_key,
        tokenProgram: TOKEN_PROGRAM_ID,
        quarryMineProgram: quarry_mine_program,
    };

    const provider = await getProvider();

    try {
      let recentBlockHash = await provider.connection.getRecentBlockhash();
      let stakeTx = new web3.Transaction({
        recentBlockhash: recentBlockHash.blockhash,
        feePayer: wallet.publicKey
      });
      const stakeCoinInstruction = await stakeProgram.instruction.stakeCoin(new BN(amt), nonce,{
        accounts: accts,
      });
      stakeTx.add(stakeCoinInstruction);
      const signature = await wallet.signTransaction(stakeTx);
      stakeTx.addSignature(wallet.publicKey, signature.signatures[0].signature);
      const transactionId = await web3.sendAndConfirmRawTransaction(provider.connection, stakeTx.serialize()); 
      setStatusMsg("Token staked to the miner account w/ transaction: " + transactionId + "!");
    } catch (err) {
        return err;
    }
  }

  async function createProxyMiner(stakeProgram, miner, miner_authority, quarry, rewarder_key, tokenMintKey, miner_vault) {
    const accts = {
      user: wallet.publicKey,    // user -- me (account info)
      miner,    // miner -- pda (ProgramAccount :-/)
      minerAuthority: miner_authority,    // miner_authority -- AccountInfo pda ()
      quarry, // quarry -- ProgramAccount(Quarry)
      rewarder: rewarder_key,   // rewarder_key -- ProgramAccount(Rewarder)
      systemProgram: web3.SystemProgram.programId,   // system_program -- AccountInfo('info)
      tokenProgram: TOKEN_PROGRAM_ID,   // token_program -- AcountInfo('info)
      tokenMint: tokenMintKey,   // token_mint -- CpiAccfount(mint)
      quarryMineProgram: quarry_mine_program,  // quarry_mine_program -- AccountInfo('info)
      minerVault: miner_vault,    // miner_vault -- AccountInfo
    };

    const provider = await getProvider();

    try {
      let recentBlockHash = await provider.connection.getRecentBlockhash();
      let createTx = new web3.Transaction({
        recentBlockhash: recentBlockHash.blockhash,
        feePayer: wallet.publicKey
      });
      const createProxyMinerInstruction = await stakeProgram.instruction.createProxyMiner({
        accounts: accts,
      });
      createTx.add(createProxyMinerInstruction);
      const signature = await wallet.signTransaction(createTx);
      createTx.addSignature(wallet.publicKey, signature.signatures[0].signature);
      await web3.sendAndConfirmRawTransaction(provider.connection, createTx.serialize()); 

      setStatusMsg("Proxy Miner generated!");

    } catch (err) {
        console.log(err);
    }
  }

  async function generateMinerAddresses(provider, quarry, tokenMintKey) {
    const [miner_authority, nonce] = await PublicKey.findProgramAddress(
      [utils.bytes.utf8.encode("MinerAuthority"), quarry.toBuffer()],
      programID
    );
    console.log("Miner Authority: " + miner_authority.toBase58());
    
    const [miner, _m_bs] = await PublicKey.findProgramAddress(
        [utils.bytes.utf8.encode("Miner"), quarry.toBuffer(), miner_authority.toBuffer()],
        quarry_mine_program
    );
    console.log("Miner: " + miner.toBase58());

    const [miner_vault, _bs_] = await PublicKey.findProgramAddress(
        [miner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), tokenMintKey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
    );

    if (!await provider.connection.getAccountInfo(miner_vault)) {
        setStatusMsg("No miner vault, creating!");
        console.log(await createATAModified(tokenMintKey, miner, miner_vault, provider, wallet));
    }

    return {
      miner_authority,
      miner,
      miner_vault,
      nonce,
      _bs_
    };
  }

  async function getProvider() {
    const network = "https://api.devnet.solana.com";
    const connection = new Connection(network, opts.preflightCommitment);

    const provider = new Provider(
      connection, wallet, opts.preflightCommitment
    );
    return provider;
  }

  // creates transactions to generate a temporary token for x amount to stake into the wallet
  async function createTempToken(amt, tokenMintKey, token_acct) {
    const tempTokenAcct = Keypair.generate();
    const provider = await getProvider();
  
    let recentBlockHash = await provider.connection.getRecentBlockhash();
    let manualTransaction = new web3.Transaction({
      recentBlockhash: recentBlockHash.blockhash,
      feePayer: wallet.publicKey
    });
    // end manual 1st

    const createTempTokenAcctIx = web3.SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: tempTokenAcct.publicKey,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(AccountLayout.span),
        space: AccountLayout.span,
        programId: TOKEN_PROGRAM_ID,
    });
    const initTempAccountIx = Token.createInitAccountInstruction(
        TOKEN_PROGRAM_ID, 
        tokenMintKey, 
        tempTokenAcct.publicKey, 
        wallet.publicKey
    );
    const transferXTokensToTempAccIx = Token.createTransferInstruction(
        TOKEN_PROGRAM_ID,
        token_acct,
        tempTokenAcct.publicKey,
        wallet.publicKey,
        [],
        amt
    );

    manualTransaction.add(createTempTokenAcctIx, initTempAccountIx, transferXTokensToTempAccIx);
    let transactionBuffer = manualTransaction.serializeMessage();
    
    if (!wallet.connected) throw new Error("Wallet not connected");
    if (!wallet.signMessage) throw new Error("Wallet doesn't support message signing!");
    
    const signature = await wallet.signTransaction(manualTransaction);
    const signature2 = sign.detached(transactionBuffer, tempTokenAcct.secretKey);
    
    // look into signAllTransactions
    manualTransaction.addSignature(wallet.publicKey, signature.signatures[0].signature);
    manualTransaction.addSignature(tempTokenAcct.publicKey, signature2);
    if (manualTransaction.verifySignatures()) { console.log("2nd sign verified"); } else { console.log("Sigs NOT verified"); }

    const rawTransaction = manualTransaction.serialize();
    await web3.sendAndConfirmRawTransaction(provider.connection, rawTransaction);
    
    setStatusMsg("Temporary Token account created!");
    return tempTokenAcct;
  }

  if (!submitted || !valid || !wallet.connected) {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo smaller-logo" alt="logo" />
          <form className="frm" onSubmit={handleSubmit}>
            <p>
              <a href="https://github.com/QuarryProtocol/quarry" target="_blank" rel="noreferrer">Quarry</a> only allows a user to stake their tokens into a quarry directly. <strong>ProxyQuarry</strong> allows a user to deposit their tokens into a program which stakes their token for them in the program's PDA account. Useful for any intermediary programs to stake into a third-party.
              </p>
            <label>
              <span><strong>Proxy</strong></span>
              <span className="lblSpan"><strong>{idl.metadata.address}</strong></span>
            </label>
            <label>
              <span><strong>Quarry</strong></span>
              <input 
                name="quarry" 
                type="text" 
                value={values.quarry}
                onChange={handleQuarryInputChange}
              />
            </label>
            <label>
              <span><strong>Rewarder</strong></span>
              <input 
                name="rewarder"
                type="text" 
                value={values.rewarder}
                onChange={handleRewarderInputChange}
              />
            </label>
            <label>
              <span><strong>Token Mint</strong></span>
              <input 
                name="token_mint"
                type="text"
                value={values.token_mint}
                onChange={handleTokenMintInputChange}
              />
            </label>
            <label>
              <span><strong>Token Account</strong></span>
              <input 
                name="token_account" 
                type="text" 
                value={values.token_account}
                onChange={handleTokenAccountInputChange}
              />
            </label>
            <label>
              <span><strong>Quarry Protocol</strong></span>
              <input 
                name="quarry_mine" 
                type="text" 
                value={values.quarry_mine}
                onChange={handleQuarryMineInputChange}
                placeholder="QMNeHCGYnLVDn1icRAfQZpjPLBNkfGbSKRB83G5d8KB"
              />
            </label>
            <label>
              <span><strong>Stake Amount</strong></span>
              <input 
                name="amt" 
                type="text" 
                value={values.amt}
                onChange={handleAmtInputChange}
                placeholder="2000000"
              />
            </label>
            <WalletMultiButton className="btn-connect" />
            <input type="submit" value="Stake tokens" />
          </form>
        </header>
      </div>
    );
  } else {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo smaller-logo" alt="logo" />
          <form className="frm" onSubmit={handleSubmit}>
            <p>
              <a href="https://github.com/QuarryProtocol/quarry" target="_blank" rel="noreferrer">Quarry</a> only allows a user to stake their tokens into a quarry directly. <strong>ProxyQuarry</strong> allows a user to deposit their tokens into a program which stakes their token for them in the program's PDA account. Useful for any intermediary programs to stake into a third-party.
            </p>
            <p>
              {statusMsg}
            </p>
          </form>
        </header>
      </div>
    );
  }
}

const AppWithProvider = () => (
  <ConnectionProvider endpoint="http://localhost:8899">
    <WalletProvider wallets={wallets}>
      <WalletModalProvider>
        <App />
      </WalletModalProvider>
    </WalletProvider>
  </ConnectionProvider>
)

export default AppWithProvider;
