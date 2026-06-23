/*
 * TrollPay — Phantom / Solana pay-per-action for the arcade.
 * Depends on troll-pay-config.js (loaded before this).
 *
 * Each revive/continue is a single SPL token transfer to the treasury, signed
 * in Phantom and confirmed on-chain. There is no backend: the confirmed
 * transaction IS the authorization (the action costs the house nothing, so a
 * client-side flow is sufficient — we only need the money to actually move).
 *
 * Builds the SPL transfer manually (no @solana/spl-token), same approach used
 * on the stickers site.
 */
(function () {
  'use strict';

  var CFG = window.TROLL_PAY_CONFIG;

  // Well-known program IDs (shared across mainnet + devnet).
  var TOKEN_PROGRAM_ID_STR  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var ATA_PROGRAM_ID_STR    = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bsU';
  var SYSTEM_PROGRAM_ID_STR = '11111111111111111111111111111111';
  var WEB3_CDN = 'https://unpkg.com/@solana/web3.js@1.95.8/lib/index.iife.min.js';

  var _web3 = null;       // loaded @solana/web3.js namespace
  var _wallet = null;     // { address }
  var _token = 'USDC';    // current pay token

  // ── web3.js loader ──────────────────────────────────────────────────────────
  function loadWeb3() {
    if (_web3) return Promise.resolve(_web3);
    if (window.solanaWeb3) { _web3 = window.solanaWeb3; return Promise.resolve(_web3); }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = WEB3_CDN;
      s.onload = function () {
        if (window.solanaWeb3) { _web3 = window.solanaWeb3; resolve(_web3); }
        else reject(new Error('web3.js failed to initialise'));
      };
      s.onerror = function () { reject(new Error('Could not load Solana library')); };
      document.head.appendChild(s);
    });
  }

  function getPhantom() {
    return (window.phantom && window.phantom.solana) || window.solana || null;
  }

  // ── Wallet connection ────────────────────────────────────────────────────────
  async function connect() {
    var phantom = getPhantom();
    if (!phantom || !phantom.isPhantom) throw new Error('Phantom not installed');
    var resp = await phantom.connect();
    _wallet = { address: resp.publicKey.toString() };
    return _wallet;
  }

  function isConnected() { return !!_wallet; }
  function getWallet()   { return _wallet; }

  // ── Token availability + selection ────────────────────────────────────────────
  function trollAvailable() {
    return !CFG.DEVNET_MODE && CFG.TROLL_MINT && CFG.TROLL_MINT !== 'FILL_ME_IN';
  }
  function setToken(t)  { _token = (t === 'TROLL' && trollAvailable()) ? 'TROLL' : 'USDC'; return _token; }
  function getToken()   { return _token; }

  // ── Pricing ──────────────────────────────────────────────────────────────────
  function pricing() {
    var base  = CFG.REVIVE_PRICE_USD;
    var tax   = base * CFG.TAX_RATE;
    return { base: base, tax: tax, total: base + tax };
  }

  // USD label for buttons. USDC is deterministic; $TROLL amount is computed at
  // pay time from the live price, so we label it in USD terms.
  function costLabel(token) {
    var t = pricing().total;
    if ((token || _token) === 'TROLL') return '$' + t.toFixed(2) + ' in $TROLL';
    return t.toFixed(2) + ' USDC';
  }

  async function fetchTrollPrice() {
    if (!trollAvailable()) throw new Error('$TROLL not configured');
    var resp = await fetch(CFG.PRICE_FEED_URL + CFG.TROLL_MINT);
    if (!resp.ok) throw new Error('Price feed unavailable');
    var data  = await resp.json();
    var price = data && data.data && data.data[CFG.TROLL_MINT] && data.data[CFG.TROLL_MINT].price;
    if (!price || Number(price) <= 0) throw new Error('Could not get $TROLL price');
    return Number(price);
  }

  function toRawUnits(usdTotal, pricePerToken, decimals) {
    var amount = usdTotal / pricePerToken;
    return BigInt(Math.ceil(amount * Math.pow(10, decimals)));
  }

  // ── SPL transfer construction ──────────────────────────────────────────────────
  function programKeys(web3) {
    return {
      TOKEN:  new web3.PublicKey(TOKEN_PROGRAM_ID_STR),
      ATA:    new web3.PublicKey(ATA_PROGRAM_ID_STR),
      SYSTEM: new web3.PublicKey(SYSTEM_PROGRAM_ID_STR),
    };
  }

  function findATA(web3, owner, mint) {
    var pk = programKeys(web3);
    return web3.PublicKey.findProgramAddressSync(
      [owner.toBuffer(), pk.TOKEN.toBuffer(), mint.toBuffer()],
      pk.ATA
    )[0];
  }

  function encodeTransferData(amountBigInt) {
    // SPL Token instruction 3 = Transfer; layout [u8 ix, u64 amount LE]
    var data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, amountBigInt, true);
    return data;
  }

  async function maybeCreateAtaInstruction(web3, connection, payer, owner, mint) {
    var pk  = programKeys(web3);
    var ata = findATA(web3, owner, mint);
    var info = await connection.getAccountInfo(ata);
    if (info) return null;
    // CreateAssociatedTokenAccountIdempotent (variant 1)
    return new web3.TransactionInstruction({
      programId: pk.ATA,
      keys: [
        { pubkey: payer,     isSigner: true,  isWritable: true  },
        { pubkey: ata,       isSigner: false, isWritable: true  },
        { pubkey: owner,     isSigner: false, isWritable: false },
        { pubkey: mint,      isSigner: false, isWritable: false },
        { pubkey: pk.SYSTEM, isSigner: false, isWritable: false },
        { pubkey: pk.TOKEN,  isSigner: false, isWritable: false },
      ],
      data: new Uint8Array([1]),
    });
  }

  async function buildTransferTx(web3, senderAddress, mintStr, rawAmount) {
    var connection = new web3.Connection(CFG.SOLANA_RPC, 'confirmed');
    var sender     = new web3.PublicKey(senderAddress);
    var treasury   = new web3.PublicKey(CFG.TREASURY_WALLET);
    var mint       = new web3.PublicKey(mintStr);
    var pk         = programKeys(web3);

    var sourceATA = findATA(web3, sender, mint);
    var destATA   = findATA(web3, treasury, mint);

    var latest = await connection.getLatestBlockhash('confirmed');
    var tx = new web3.Transaction({ recentBlockhash: latest.blockhash, feePayer: sender });

    // Create treasury's ATA if it doesn't exist yet (sender pays ~0.002 SOL rent, once).
    var createIx = await maybeCreateAtaInstruction(web3, connection, sender, treasury, mint);
    if (createIx) tx.add(createIx);

    tx.add(new web3.TransactionInstruction({
      programId: pk.TOKEN,
      keys: [
        { pubkey: sourceATA, isSigner: false, isWritable: true  },
        { pubkey: destATA,   isSigner: false, isWritable: true  },
        { pubkey: sender,    isSigner: true,  isWritable: false },
      ],
      data: encodeTransferData(rawAmount),
    }));

    return { tx: tx, connection: connection, blockhashInfo: latest };
  }

  async function sendAndConfirm(connection, phantom, tx, blockhashInfo, onProgress) {
    var result = await phantom.signAndSendTransaction(tx);
    var sig    = result.signature;
    if (onProgress) onProgress({ stage: 'sent', sig: sig });

    // Poll getSignatureStatus with searchTransactionHistory:true so we search
    // across all nodes — not just the local RPC node's memory cache, which is
    // what caused "confirmed" to hang forever on the public devnet RPC.
    var deadline = Date.now() + 90000; // 90s — devnet can be slow
    while (Date.now() < deadline) {
      try {
        var resp = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        if (resp && resp.value) {
          if (resp.value.err) {
            throw new Error('Transaction failed on-chain: ' + JSON.stringify(resp.value.err));
          }
          var conf = resp.value.confirmationStatus;
          if (conf === 'confirmed' || conf === 'finalized') return sig;
        }
      } catch (e) {
        // Only re-throw real failures — ignore transient RPC errors and retry.
        if (e.message && e.message.indexOf('Transaction failed') === 0) throw e;
      }
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
    throw new Error('Timed out waiting for confirmation. Check the explorer for sig: ' + sig);
  }

  function explorerUrl(sig) {
    return CFG.EXPLORER_BASE + sig + (CFG.EXPLORER_SUFFIX || '');
  }

  // ── Public: pay for a revive / continue ────────────────────────────────────────
  // Returns { ok:true, txSig } on success, or { ok:false, reason } on any failure.
  // onProgress receives { stage: 'connecting'|'building'|'awaiting'|'sent'|'confirming', sig? }
  async function payForRevive(onProgress) {
    try {
      if (onProgress) onProgress({ stage: 'connecting' });
      var web3 = await loadWeb3();
      if (!isConnected()) await connect();
      var phantom = getPhantom();

      var token = getToken();
      var price = pricing();

      var mintStr, decimals, pricePerToken;
      if (token === 'TROLL') {
        mintStr       = CFG.TROLL_MINT;
        decimals      = CFG.TROLL_DECIMALS;
        pricePerToken = await fetchTrollPrice();
      } else {
        mintStr       = CFG.USDC_MINT;
        decimals      = CFG.USDC_DECIMALS;
        pricePerToken = 1; // 1 USDC = $1.00
      }

      if (onProgress) onProgress({ stage: 'building' });
      var rawAmount = toRawUnits(price.total, pricePerToken, decimals);
      var built     = await buildTransferTx(web3, _wallet.address, mintStr, rawAmount);

      if (onProgress) onProgress({ stage: 'awaiting' });
      var sig = await sendAndConfirm(built.connection, phantom, built.tx, built.blockhashInfo, function (ev) {
        if (ev.stage === 'sent' && onProgress) onProgress({ stage: 'confirming', sig: ev.sig });
      });

      return { ok: true, txSig: sig };
    } catch (err) {
      return { ok: false, reason: friendlyError(err) };
    }
  }

  function friendlyError(err) {
    var msg = (err && err.message) || String(err);
    if (/reject|cancel|user denied/i.test(msg)) return 'Payment cancelled';
    if (/not installed/i.test(msg))             return 'Phantom not found';
    if (/insufficient|0x1\b/i.test(msg))         return 'Insufficient funds';
    if (/price feed|TROLL/i.test(msg))           return '$TROLL price unavailable';
    if (/timed out|expired/i.test(msg))          return 'Timed out — try again';
    return 'Payment failed';
  }

  // ── Optional UI helper: token picker ───────────────────────────────────────────
  // Renders into `el` a tiny USDC / $TROLL selector. When only USDC is available
  // (devnet, or $TROLL mint unset) it renders a static "Paying in USDC" label.
  function mountTokenPicker(el) {
    if (!el) return;
    el.innerHTML = '';
    if (!trollAvailable()) {
      var span = document.createElement('span');
      span.className = 'pay-token-static';
      span.textContent = 'Paying in USDC';
      el.appendChild(span);
      setToken('USDC');
      return;
    }
    ['USDC', 'TROLL'].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pay-token-btn' + (t === _token ? ' is-active' : '');
      b.textContent = t === 'TROLL' ? '$TROLL' : 'USDC';
      b.addEventListener('click', function () {
        setToken(t);
        el.querySelectorAll('.pay-token-btn').forEach(function (n) { n.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
      el.appendChild(b);
    });
  }

  window.TrollPay = {
    loadWeb3:        loadWeb3,
    connect:         connect,
    isConnected:     isConnected,
    getWallet:       getWallet,
    trollAvailable:  trollAvailable,
    setToken:        setToken,
    getToken:        getToken,
    pricing:         pricing,
    costLabel:       costLabel,
    payForRevive:    payForRevive,
    explorerUrl:     explorerUrl,
    mountTokenPicker: mountTokenPicker,
    config:          CFG,
  };
})();
